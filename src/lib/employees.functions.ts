import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireOwner, requireStaff } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/integrations/supabase/client.server";
import { STAFF_ROLES, type StaffRole } from "@/lib/roles";

/**
 * Раздел «Доступы»: учётные записи сотрудников. Создание/удаление auth-
 * пользователей возможно только service-ключом, поэтому это серверные функции;
 * кто вызывает — проверяют middleware requireStaff/requireOwner.
 */

export type EmployeeRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: StaffRole;
  created_at: string;
};

const ROLE_PRIORITY: Record<StaffRole, number> = { owner: 3, admin: 2, trainer: 1 };

export const getEmployeesContext = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { studioId } = context;
    const admin = getSupabaseAdmin();
    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("user_id, role, created_at")
      .eq("studio_id", studioId)
      .in("role", STAFF_ROLES);
    if (rolesErr) throw new Error(rolesErr.message);

    const roleRows = (roles ?? []) as { user_id: string; role: StaffRole; created_at: string }[];
    const userIds = [...new Set(roleRows.map((r) => r.user_id))];
    const profiles = new Map<string, { email: string | null; full_name: string | null }>();
    if (userIds.length > 0) {
      const { data: profs, error: profErr } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      if (profErr) throw new Error(profErr.message);
      for (const p of (profs ?? []) as {
        id: string;
        email: string | null;
        full_name: string | null;
      }[]) {
        profiles.set(p.id, { email: p.email, full_name: p.full_name });
      }
    }

    // У человека может быть несколько ролей в студии — показываем старшую.
    const byUser = new Map<string, EmployeeRow>();
    for (const r of roleRows) {
      const cur = byUser.get(r.user_id);
      if (!cur || ROLE_PRIORITY[r.role] > ROLE_PRIORITY[cur.role]) {
        byUser.set(r.user_id, {
          user_id: r.user_id,
          role: r.role,
          created_at: r.created_at,
          email: profiles.get(r.user_id)?.email ?? null,
          full_name: profiles.get(r.user_id)?.full_name ?? null,
        });
      }
    }

    const employees = [...byUser.values()].sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
    );

    return { employees, isOwner: context.isOwner, studioId, currentUserId: context.userId };
  });

const createSchema = z.object({
  first_name: z.string().trim().min(1, "Укажите имя").max(100),
  last_name: z.string().trim().min(1, "Укажите фамилию").max(100),
  email: z.string().trim().toLowerCase().email("Неверный адрес почты"),
  role: z.enum(STAFF_ROLES),
});

/** Сообщения GoTrue приходят по-английски — частые переводим для тоста. */
function authErrorText(message: string) {
  if (/already (been )?registered|already exists|email_exists/i.test(message)) {
    return "Пользователь с такой почтой уже зарегистрирован";
  }
  return message;
}

/**
 * Добавить сотрудника: имя, фамилия, почта. Пароля нет: вход только по
 * 6-значному коду из письма (паролям сотрудников db/migrations/…_staff_accounts.sql не даёт
 * существовать). Есть учётная запись (клиент приложения, сотрудник другой
 * студии) — только выдаём роль; нет — создаём пользователя.
 */
export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((data) => createSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { studioId } = context;
    const admin = getSupabaseAdmin();
    // «Фамилия Имя» — как clientName в остальных разделах.
    const fullName = `${data.last_name} ${data.first_name}`;

    const pattern = data.email.replace(/[\\%_]/g, "\\$&");
    const { data: existing, error: findErr } = await admin
      .from("profiles")
      .select("id, full_name")
      .ilike("email", pattern)
      .limit(1);
    if (findErr) throw new Error(findErr.message);
    const existingId = (existing?.[0]?.id as string | undefined) ?? null;
    const existingName = (existing?.[0]?.full_name as string | null | undefined) ?? null;

    if (existingId) {
      const { data: has, error: hasErr } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", existingId)
        .eq("studio_id", studioId)
        .in("role", STAFF_ROLES)
        .limit(1);
      if (hasErr) throw new Error(hasErr.message);
      if (has?.length) throw new Error("Этот человек уже сотрудник студии");
      const { error: roleErr } = await admin
        .from("user_roles")
        .insert({ user_id: existingId, studio_id: studioId, role: data.role });
      if (roleErr) throw new Error(roleErr.message);
      // Имя в профиле не перетираем: его мог задать сам человек в приложении.
      // Заполняем, только если пусто — иначе в «Доступах» была бы одна почта.
      if (!existingName?.trim()) {
        const { error: nameErr } = await admin
          .from("profiles")
          .update({ full_name: fullName })
          .eq("id", existingId);
        if (nameErr) throw new Error(nameErr.message);
      }
      return { ok: true, user_id: existingId, existing: true };
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      email_confirm: true,
      // studio_id читает триггер handle_new_user (без него профиль и роль member
      // создаются в самой старой студии); staff_account — не заводить карточку
      // клиента (db/migrations/…_staff_accounts.sql).
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        full_name: fullName,
        studio_id: studioId,
        staff_account: true,
      },
    });
    if (error || !created.user) {
      throw new Error(authErrorText(error?.message ?? "Не удалось создать пользователя"));
    }
    const newId = created.user.id;
    const { error: profErr } = await admin.from("profiles").upsert({
      id: newId,
      studio_id: studioId,
      full_name: fullName,
      email: data.email,
    });
    if (profErr) {
      await admin.auth.admin.deleteUser(newId);
      throw new Error(profErr.message);
    }
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: newId, studio_id: studioId, role: data.role });
    if (roleErr) {
      await admin.auth.admin.deleteUser(newId);
      throw new Error(roleErr.message);
    }
    return { ok: true, user_id: newId, existing: false };
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((data) => z.object({ user_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { studioId } = context;
    if (data.user_id === context.userId) {
      throw new Error("Нельзя удалить самого себя");
    }

    const admin = getSupabaseAdmin();

    // Удаление идёт сервис-ключом в обход RLS, поэтому цель обязана быть
    // проверена явно: без этого владелец одной студии мог удалить любого
    // пользователя проекта — сотрудника чужой студии или клиента приложения.
    const { data: targetRoles, error: targetErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id)
      .eq("studio_id", studioId)
      .in("role", STAFF_ROLES)
      .limit(1);
    if (targetErr) throw new Error(targetErr.message);
    if (!targetRoles?.length) {
      throw new Error("Этот пользователь не является сотрудником вашей студии");
    }

    // Один человек может быть и сотрудником, и клиентом (или сотрудником
    // другой студии), а удаление auth-пользователя каскадом сносит его
    // записи, анкету и роли во всех студиях. Поэтому аккаунт удаляем, только
    // если он ни к чему больше не привязан: не сотрудник другой студии, не
    // пользователь клиентского приложения (анкета member_profiles, записи на
    // занятия) и без выданных абонементов. Сама карточка clients — не признак:
    // триггер handle_new_user (client_app_fixes.sql) заводит её каждому новому
    // пользователю, сотрудникам тоже; при удалении аккаунта она остаётся, лишь
    // отвязывается (user_id -> null). Проверяем до изменений, чтобы ошибка
    // проверки не оставила сотрудника наполовину удалённым.
    const links = await Promise.all([
      admin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user_id)
        .neq("studio_id", studioId)
        .in("role", STAFF_ROLES)
        .limit(1),
      admin.from("member_profiles").select("user_id").eq("user_id", data.user_id).limit(1),
      admin.from("schedule_bookings").select("id").eq("user_id", data.user_id).limit(1),
      admin
        .from("clients")
        .select("id, client_memberships!inner(id)")
        .eq("user_id", data.user_id)
        .limit(1),
    ]);
    for (const { error: linkErr } of links) {
      if (linkErr) throw new Error(linkErr.message);
    }
    const keepAccount = links.some(({ data: rows }) => rows?.length);

    const { error: revokeErr } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .eq("studio_id", studioId)
      .in("role", STAFF_ROLES);
    if (revokeErr) throw new Error(revokeErr.message);
    if (keepAccount) return { ok: true, accountKept: true };

    const { error } = await admin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true, accountKept: false };
  });
