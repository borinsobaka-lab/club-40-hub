import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireAccessManager } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CLUB_SECTION_KEYS,
  ADMIN_SECTION_KEYS,
  type ClubSectionKey,
  type AdminSectionKey,
} from "@/lib/admin-access";
import { STAFF_ROLES, type StaffRole } from "@/lib/roles";

/**
 * Раздел «Доступы»: учётные записи админки и их права — студии (роль в
 * user_roles), разделы рейки (admin_permissions) и разделы клуба в каждой
 * студии (admin_studio_permissions); схема — db/migrations/…_admin_permissions.sql.
 * Создание/удаление auth-пользователей и запись прав возможны только
 * service-ключом, поэтому это серверные функции; вызывать их может владелец
 * (requireAccessManager), и только в своих студиях.
 */

export type EmployeeStudioAccess = {
  studio_id: string;
  role: StaffRole;
  /** Разделы клуба в студии; null — все. */
  sections: ClubSectionKey[] | null;
};

export type EmployeeRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  /** Старшая роль в студиях владельца. */
  role: StaffRole;
  /** Доступ в студиях владельца (вызывающего). */
  studios: EmployeeStudioAccess[];
  /** Студий вне управления владельца, где у человека тоже есть доступ. */
  otherStudios: number;
  /** Разделы рейки; null — все. */
  rail: AdminSectionKey[] | null;
};

const ROLE_PRIORITY: Record<StaffRole, number> = { owner: 3, admin: 2, trainer: 1 };

export const getEmployeesContext = createServerFn({ method: "GET" })
  .middleware([requireAccessManager])
  .handler(async ({ context }) => {
    const { ownedStudioIds } = context;
    const admin = getSupabaseAdmin();

    const { data: studios, error: studiosErr } = await admin
      .from("studios")
      .select("id, name")
      .in("id", ownedStudioIds)
      .order("created_at");
    if (studiosErr) throw new Error(studiosErr.message);

    const { data: managedRoles, error: rolesErr } = await admin
      .from("user_roles")
      .select("user_id")
      .in("studio_id", ownedStudioIds)
      .in("role", STAFF_ROLES);
    if (rolesErr) throw new Error(rolesErr.message);
    const userIds = [...new Set((managedRoles ?? []).map((r) => r.user_id as string))];
    if (userIds.length === 0) {
      return { employees: [], studios: studios ?? [], currentUserId: context.userId };
    }

    const [roles, profiles, rail, perStudio] = await Promise.all([
      admin
        .from("user_roles")
        .select("user_id, studio_id, role")
        .in("user_id", userIds)
        .in("role", STAFF_ROLES),
      admin.from("profiles").select("id, email, full_name").in("id", userIds),
      admin.from("admin_permissions").select("user_id, sections").in("user_id", userIds),
      admin
        .from("admin_studio_permissions")
        .select("user_id, studio_id, sections")
        .in("user_id", userIds),
    ]);
    for (const res of [roles, profiles, rail, perStudio]) {
      if (res.error) throw new Error(res.error.message);
    }

    const owned = new Set(ownedStudioIds);
    const profileOf = new Map(
      (
        (profiles.data ?? []) as { id: string; email: string | null; full_name: string | null }[]
      ).map((p) => [p.id, p]),
    );
    const railOf = new Map(
      ((rail.data ?? []) as { user_id: string; sections: AdminSectionKey[] }[]).map((r) => [
        r.user_id,
        r.sections,
      ]),
    );
    const sectionsOf = new Map(
      (
        (perStudio.data ?? []) as {
          user_id: string;
          studio_id: string;
          sections: ClubSectionKey[];
        }[]
      ).map((r) => [`${r.user_id}:${r.studio_id}`, r.sections]),
    );

    const byUser = new Map<string, EmployeeRow>();
    for (const r of (roles.data ?? []) as {
      user_id: string;
      studio_id: string;
      role: StaffRole;
    }[]) {
      let row = byUser.get(r.user_id);
      if (!row) {
        const p = profileOf.get(r.user_id);
        row = {
          user_id: r.user_id,
          email: p?.email ?? null,
          full_name: p?.full_name ?? null,
          role: r.role,
          studios: [],
          otherStudios: 0,
          rail: railOf.get(r.user_id) ?? null,
        };
        byUser.set(r.user_id, row);
      }
      if (!owned.has(r.studio_id)) continue;
      // В студии может быть несколько ролей — берём старшую.
      const existing = row.studios.find((s) => s.studio_id === r.studio_id);
      if (existing) {
        if (ROLE_PRIORITY[r.role] > ROLE_PRIORITY[existing.role]) existing.role = r.role;
      } else {
        row.studios.push({
          studio_id: r.studio_id,
          role: r.role,
          sections: sectionsOf.get(`${r.user_id}:${r.studio_id}`) ?? null,
        });
      }
    }
    for (const row of byUser.values()) {
      row.otherStudios = new Set(
        ((roles.data ?? []) as { user_id: string; studio_id: string }[])
          .filter((r) => r.user_id === row.user_id && !owned.has(r.studio_id))
          .map((r) => r.studio_id),
      ).size;
      row.role = row.studios.reduce<StaffRole>(
        (best, s) => (ROLE_PRIORITY[s.role] > ROLE_PRIORITY[best] ? s.role : best),
        "trainer",
      );
    }

    const employees = [...byUser.values()].sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
    );

    return { employees, studios: studios ?? [], currentUserId: context.userId };
  });

/** Правка скриптов без самого раздела не имеет смысла — снимаем. */
function railSections(rail: AdminSectionKey[]): AdminSectionKey[] {
  return [...new Set(rail)].filter((k) => k !== "scripts-edit" || rail.includes("scripts"));
}

const accessSchema = z
  .object({
    role: z.enum(STAFF_ROLES),
    rail: z.array(z.enum(ADMIN_SECTION_KEYS)),
    studios: z
      .array(
        z.object({
          studio_id: z.string().uuid(),
          sections: z.array(z.enum(CLUB_SECTION_KEYS)),
        }),
      )
      .min(1, "Отметьте хотя бы одну студию"),
  })
  .superRefine((v, ctx) => {
    if (v.role === "owner") return;
    if (v.rail.length === 0) {
      ctx.addIssue({ code: "custom", message: "Отметьте хотя бы один раздел админки" });
    }
    if (v.rail.includes("club") && v.studios.some((s) => s.sections.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "Отметьте хотя бы один раздел клуба в каждой студии",
      });
    }
  });
type AccessInput = z.infer<typeof accessSchema>;

/** Первая ошибка zod — текстом для тоста. */
function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const res = schema.safeParse(data);
  if (!res.success) throw new Error(res.error.issues[0]?.message ?? "Неверные данные");
  return res.data;
}

/**
 * Записать права человека в студиях владельца. Роль в отмеченных студиях
 * сначала выдаётся, потом снимаются прочие — доступ не пропадает посреди
 * сохранения. Студии вне управления владельца не трогаем.
 */
async function applyAccess(
  admin: SupabaseClient,
  userId: string,
  ownedStudioIds: string[],
  input: AccessInput,
) {
  // Одна студия — одна строка: повтор в запросе уронил бы upsert.
  const studios = [...new Map(input.studios.map((s) => [s.studio_id, s])).values()];
  const selected = studios.map((s) => s.studio_id);
  const foreign = selected.filter((id) => !ownedStudioIds.includes(id));
  if (foreign.length) throw new Error("Выдавать доступ можно только в своих студиях");
  const unselected = ownedStudioIds.filter((id) => !selected.includes(id));
  const isOwnerRole = input.role === "owner";
  const now = new Date().toISOString();
  const check = ({ error }: { error: { message: string } | null }) => {
    if (error) throw new Error(error.message);
  };

  check(
    await admin.from("user_roles").upsert(
      selected.map((studio_id) => ({ user_id: userId, studio_id, role: input.role })),
      { onConflict: "user_id,studio_id,role", ignoreDuplicates: true },
    ),
  );
  check(
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .in("studio_id", selected)
      .in(
        "role",
        STAFF_ROLES.filter((r) => r !== input.role),
      ),
  );
  if (unselected.length) {
    check(
      await admin
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .in("studio_id", unselected)
        .in("role", STAFF_ROLES),
    );
  }

  // Владельцу в его студиях открыто всё — строки прав ему не нужны.
  const dropStudioPerms = isOwnerRole ? ownedStudioIds : unselected;
  if (dropStudioPerms.length) {
    check(
      await admin
        .from("admin_studio_permissions")
        .delete()
        .eq("user_id", userId)
        .in("studio_id", dropStudioPerms),
    );
  }
  if (!isOwnerRole) {
    check(
      await admin.from("admin_studio_permissions").upsert(
        studios.map((s) => ({
          user_id: userId,
          studio_id: s.studio_id,
          sections: [...new Set(s.sections)],
          updated_at: now,
        })),
      ),
    );
  }

  check(
    isOwnerRole
      ? await admin.from("admin_permissions").delete().eq("user_id", userId)
      : await admin
          .from("admin_permissions")
          .upsert({ user_id: userId, sections: railSections(input.rail), updated_at: now }),
  );
}

/** Есть ли у человека доступ хоть в одной студии владельца. */
async function isManagedEmployee(admin: SupabaseClient, userId: string, ownedStudioIds: string[]) {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("studio_id", ownedStudioIds)
    .in("role", STAFF_ROLES)
    .limit(1);
  if (error) throw new Error(error.message);
  return !!data?.length;
}

const createSchema = z
  .object({
    first_name: z.string().trim().min(1, "Укажите имя").max(100),
    last_name: z.string().trim().min(1, "Укажите фамилию").max(100),
    email: z.string().trim().toLowerCase().email("Неверный адрес почты"),
    access: accessSchema,
  })
  .strict();

/** Сообщения GoTrue приходят по-английски — частые переводим для тоста. */
function authErrorText(message: string) {
  if (/already (been )?registered|already exists|email_exists/i.test(message)) {
    return "Пользователь с такой почтой уже зарегистрирован";
  }
  return message;
}

/**
 * Добавить сотрудника: имя, фамилия, почта и права. Пароля нет: вход только
 * по 6-значному коду из письма (паролям сотрудников db/migrations/…_staff_accounts.sql
 * не даёт существовать). Есть учётная запись (клиент приложения, сотрудник
 * другой студии) — только выдаём доступ; нет — создаём пользователя.
 */
export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireAccessManager])
  .inputValidator((data) => parseOrThrow(createSchema, data))
  .handler(async ({ context, data }) => {
    const { ownedStudioIds } = context;
    const admin = getSupabaseAdmin();
    // «Фамилия Имя» — как clientName в остальных разделах.
    const fullName = `${data.last_name} ${data.first_name}`;
    const homeStudioId = data.access.studios[0].studio_id;
    if (!ownedStudioIds.includes(homeStudioId)) {
      throw new Error("Выдавать доступ можно только в своих студиях");
    }

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
      if (await isManagedEmployee(admin, existingId, ownedStudioIds)) {
        throw new Error("У этого человека уже есть доступ — измените его в списке");
      }
      await applyAccess(admin, existingId, ownedStudioIds, data.access);
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
        studio_id: homeStudioId,
        staff_account: true,
      },
    });
    if (error || !created.user) {
      throw new Error(authErrorText(error?.message ?? "Не удалось создать пользователя"));
    }
    const newId = created.user.id;
    try {
      const { error: profErr } = await admin.from("profiles").upsert({
        id: newId,
        studio_id: homeStudioId,
        full_name: fullName,
        email: data.email,
      });
      if (profErr) throw new Error(profErr.message);
      await applyAccess(admin, newId, ownedStudioIds, data.access);
    } catch (e) {
      // Каскад снимет и уже выданные роли и права.
      await admin.auth.admin.deleteUser(newId);
      throw e;
    }
    return { ok: true, user_id: newId, existing: false };
  });

/** Изменить права сотрудника (студии, роль, разделы). */
export const updateEmployeeAccess = createServerFn({ method: "POST" })
  .middleware([requireAccessManager])
  .inputValidator((data) =>
    parseOrThrow(z.object({ user_id: z.string().uuid(), access: accessSchema }).strict(), data),
  )
  .handler(async ({ context, data }) => {
    if (data.user_id === context.userId) {
      throw new Error("Свой доступ изменить нельзя — попросите другого владельца");
    }
    const admin = getSupabaseAdmin();
    // Запись идёт сервис-ключом в обход RLS — цель проверяем явно: иначе
    // владелец мог бы выдать роль любому пользователю проекта по его id.
    if (!(await isManagedEmployee(admin, data.user_id, context.ownedStudioIds))) {
      throw new Error("Этот пользователь не является сотрудником ваших студий");
    }
    await applyAccess(admin, data.user_id, context.ownedStudioIds, data.access);
    return { ok: true };
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireAccessManager])
  .inputValidator((data) => z.object({ user_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { ownedStudioIds } = context;
    if (data.user_id === context.userId) {
      throw new Error("Нельзя удалить самого себя");
    }

    const admin = getSupabaseAdmin();

    // Удаление идёт сервис-ключом в обход RLS, поэтому цель обязана быть
    // проверена явно: без этого владелец одной студии мог удалить любого
    // пользователя проекта — сотрудника чужой студии или клиента приложения.
    if (!(await isManagedEmployee(admin, data.user_id, ownedStudioIds))) {
      throw new Error("Этот пользователь не является сотрудником ваших студий");
    }

    // Один человек может быть и сотрудником, и клиентом (или сотрудником
    // другой студии), а удаление auth-пользователя каскадом сносит его
    // записи, анкету и роли во всех студиях. Поэтому аккаунт удаляем, только
    // если он ни к чему больше не привязан: не сотрудник студии вне управления
    // владельца, не пользователь клиентского приложения (анкета
    // member_profiles, записи на занятия) и без выданных абонементов. Сама
    // карточка clients — не признак: триггер handle_new_user
    // (client_app_fixes.sql) заводит её каждому новому пользователю, сотрудникам
    // тоже; при удалении аккаунта она остаётся, лишь отвязывается
    // (user_id -> null). Проверяем до изменений, чтобы ошибка проверки не
    // оставила сотрудника наполовину удалённым.
    const links = await Promise.all([
      admin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user_id)
        .not("studio_id", "in", `(${ownedStudioIds.join(",")})`)
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
    const otherStudioStaff = !!links[0].data?.length;
    const keepAccount = links.some(({ data: rows }) => rows?.length);

    const { error: revokeErr } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .in("studio_id", ownedStudioIds)
      .in("role", STAFF_ROLES);
    if (revokeErr) throw new Error(revokeErr.message);
    const { error: permsErr } = await admin
      .from("admin_studio_permissions")
      .delete()
      .eq("user_id", data.user_id)
      .in("studio_id", ownedStudioIds);
    if (permsErr) throw new Error(permsErr.message);
    // Разделы рейки общие для студий — нужны, только пока остаётся доступ в
    // других студиях.
    if (!otherStudioStaff) {
      const { error: railErr } = await admin
        .from("admin_permissions")
        .delete()
        .eq("user_id", data.user_id);
      if (railErr) throw new Error(railErr.message);
    }
    if (keepAccount) return { ok: true, accountKept: true };

    const { error } = await admin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true, accountKept: false };
  });
