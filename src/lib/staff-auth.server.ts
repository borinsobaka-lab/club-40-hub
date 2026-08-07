import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STAFF_ROLES = ["owner", "admin", "trainer"];

export type StaffContext = {
  supabase: SupabaseClient;
  userId: string;
  studioId: string | undefined;
};

/**
 * Проверяет Bearer-токен запроса И роль пользователя. Возвращает контекст
 * ТОЛЬКО для сотрудников (owner/admin/trainer в user_roles); для анонимов,
 * клиентов мобильного приложения и любых не-сотрудников — null.
 *
 * Нужен серверным эндпоинтам админки (AI-ассистент, диктовка): они ходят во
 * внешние платные API и/или в данные студии, поэтому не должны быть доступны
 * клиентам, даже если те знают домен админки. Одной авторизации мало —
 * клиент приложения тоже авторизованный пользователь этого же проекта Supabase.
 */
export async function getStaffContext(request: Request): Promise<StaffContext | null> {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, "");

  const url =
    (import.meta as any).env?.VITE_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";
  const anon =
    (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    "";
  if (!url || !anon) {
    console.error("[staff-auth] Supabase env is not configured");
    return null;
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .in("role", STAFF_ROLES)
    .limit(1);
  if (rolesError || !roles?.length) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("studio_id")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    supabase,
    userId: data.user.id,
    studioId: (prof?.studio_id as string | undefined) ?? undefined,
  };
}
