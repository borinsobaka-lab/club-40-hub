import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createUserClient } from "@/integrations/supabase/client.server";
import { STAFF_ROLES, hasStaffRole, type StaffRole } from "@/lib/roles";

/** Токен из заголовка `Authorization: Bearer …`. */
export function bearerToken(header: string | null | undefined): string | null {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

/** Проверяет токен в GoTrue. Возвращает клиент от имени пользователя и его самого. */
export async function authenticate(
  token: string,
): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const supabase = createUserClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

/** Студия сотрудника — profiles.studio_id (null, если профиля нет). */
export async function getProfileStudioId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("studio_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.studio_id as string | null | undefined) ?? null;
}

/** Роли сотрудника в конкретной студии. */
export async function getStudioStaffRoles(
  supabase: SupabaseClient,
  userId: string,
  studioId: string,
): Promise<StaffRole[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .in("role", STAFF_ROLES);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.role as StaffRole);
}

export type StaffContext = {
  supabase: SupabaseClient;
  userId: string;
  studioId: string;
};

export type StaffAuthResult =
  | { ok: true; staff: StaffContext }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Проверка для API-роутов админки (AI-ассистент, диктовка): Bearer-токен И
 * роль сотрудника. Они ходят в платные внешние API и в данные студии, поэтому
 * клиентам приложения — тоже авторизованным пользователям этого же Supabase —
 * недоступны. 401 — нет сессии, 403 — сессия есть, но это не сотрудник.
 */
export async function authenticateStaff(request: Request): Promise<StaffAuthResult> {
  const token = bearerToken(request.headers.get("authorization"));
  const auth = token ? await authenticate(token) : null;
  if (!auth) {
    return {
      ok: false,
      status: 401,
      message: "Сессия истекла. Войдите заново и повторите запрос.",
    };
  }
  const [isStaff, studioId] = await Promise.all([
    hasStaffRole(auth.supabase, auth.user.id),
    getProfileStudioId(auth.supabase, auth.user.id),
  ]);
  if (!isStaff || !studioId) {
    return { ok: false, status: 403, message: "Доступ только для сотрудников студии." };
  }
  return { ok: true, staff: { supabase: auth.supabase, userId: auth.user.id, studioId } };
}
