import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EmployeeRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: "owner" | "admin" | "trainer" | "member";
  created_at: string;
};

async function loadAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function getStudioId(supabase: any, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("studio_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.studio_id) throw new Error("Студия не найдена для пользователя");
  return data.studio_id as string;
}

async function isOwner(supabase: any, userId: string, studioId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .eq("role", "owner")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function isStaff(supabase: any, userId: string, studioId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .in("role", ["owner", "admin", "trainer"])
    .limit(1);
  if (error) throw new Error(error.message);
  return !!data?.length;
}

export const getEmployeesContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const studioId = await getStudioId(context.supabase, context.userId);
    // Список сотрудников (с email) — только для сотрудников. Клиент приложения
    // — тоже авторизованный пользователь, но видеть штат клуба не должен.
    if (!(await isStaff(context.supabase, context.userId, studioId))) {
      throw new Error("Доступ только для сотрудников");
    }
    const owner = await isOwner(context.supabase, context.userId, studioId);

    const admin = await loadAdmin();
    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("user_id, role, created_at")
      .eq("studio_id", studioId)
      .in("role", ["owner", "admin", "trainer"]);
    if (rolesErr) throw new Error(rolesErr.message);

    const userIds = Array.from(new Set((roles ?? []).map((r: any) => r.user_id as string)));
    let profiles: Record<string, { email: string | null; full_name: string | null }> = {};
    if (userIds.length > 0) {
      const { data: profs, error: profErr } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      if (profErr) throw new Error(profErr.message);
      profiles = Object.fromEntries(
        (profs ?? []).map((p: any) => [p.id, { email: p.email, full_name: p.full_name }]),
      );
    }

    // Pick highest-priority role per user
    const priority: Record<string, number> = { owner: 4, admin: 3, trainer: 2, member: 1 };
    const byUser = new Map<string, EmployeeRow>();
    for (const r of roles ?? []) {
      const cur = byUser.get(r.user_id);
      const role = r.role as EmployeeRow["role"];
      if (!cur || priority[role] > priority[cur.role]) {
        byUser.set(r.user_id, {
          user_id: r.user_id,
          role,
          created_at: r.created_at,
          email: profiles[r.user_id]?.email ?? null,
          full_name: profiles[r.user_id]?.full_name ?? null,
        });
      }
    }

    const employees = Array.from(byUser.values()).sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
    );

    return { employees, isOwner: owner, studioId, currentUserId: context.userId };
  });

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().min(1),
  role: z.enum(["owner", "admin", "trainer"]),
});

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => createSchema.parse(data))
  .handler(async ({ context, data }) => {
    const studioId = await getStudioId(context.supabase, context.userId);
    if (!(await isOwner(context.supabase, context.userId, studioId))) {
      throw new Error("Только владелец может добавлять сотрудников");
    }
    const admin = await loadAdmin();
    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !created.user)
      throw new Error(error?.message ?? "Не удалось создать пользователя");
    const newId = created.user.id;
    const { error: profErr } = await admin.from("profiles").upsert({
      id: newId,
      studio_id: studioId,
      full_name: data.full_name,
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
    return { ok: true, user_id: newId };
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ user_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const studioId = await getStudioId(context.supabase, context.userId);
    if (!(await isOwner(context.supabase, context.userId, studioId))) {
      throw new Error("Только владелец может удалять сотрудников");
    }
    if (data.user_id === context.userId) {
      throw new Error("Нельзя удалить самого себя");
    }

    const admin = await loadAdmin();

    // Удаление идёт сервис-ключом в обход RLS, поэтому цель обязана быть
    // проверена явно: без этого владелец одной студии мог удалить любого
    // пользователя проекта — сотрудника чужой студии или клиента приложения
    // (auth.users каскадом уносит profiles/clients/записи).
    const { data: targetRoles, error: targetErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id)
      .eq("studio_id", studioId)
      .in("role", ["owner", "admin", "trainer"])
      .limit(1);
    if (targetErr) throw new Error(targetErr.message);
    if (!targetRoles?.length) {
      throw new Error("Этот пользователь не является сотрудником вашей студии");
    }

    // Один человек может быть и сотрудником, и клиентом (или сотрудником
    // другой студии). Удаление auth-пользователя каскадом сносит его записи,
    // анкету и роли во всех студиях, поэтому сначала снимаем только роли
    // сотрудника в этой студии, а аккаунт удаляем, лишь если больше он ни к
    // чему не привязан.
    const { error: revokeErr } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .eq("studio_id", studioId)
      .in("role", ["owner", "admin", "trainer"]);
    if (revokeErr) throw new Error(revokeErr.message);

    // Аккаунт оставляем, если человек — сотрудник другой студии, клиент
    // студии (карточка в clients) или пользователь клиентского приложения
    // (анкета member_profiles, даже без карточки).
    const links = await Promise.all([
      admin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user_id)
        .in("role", ["owner", "admin", "trainer"])
        .limit(1),
      admin.from("clients").select("id").eq("user_id", data.user_id).limit(1),
      admin.from("member_profiles").select("user_id").eq("user_id", data.user_id).limit(1),
    ]);
    for (const { error: linkErr } of links) {
      if (linkErr) throw new Error(linkErr.message);
    }
    if (links.some(({ data: rows }) => rows?.length)) {
      return { ok: true, accountKept: true };
    }

    const { error } = await admin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true, accountKept: false };
  });
