import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Роли сотрудников. Каждый новый пользователь получает роль `member`
 * (auth_trigger.sql), поэтому «просто авторизован» ≠ «сотрудник» — роль
 * проверяем явно.
 */
export const STAFF_ROLES = ["owner", "admin", "trainer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Есть ли у пользователя роль сотрудника хоть в одной студии. Работает с
 * любым клиентом (браузерным или серверным от имени пользователя): строки
 * user_roles своего пользователя RLS отдаёт всегда.
 *
 * Ошибка запроса — исключение, а не false: сбой сети или рестарт PostgREST
 * не должен выглядеть как «не сотрудник» и выкидывать из админки.
 */
export async function hasStaffRole(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", STAFF_ROLES)
    .limit(1);
  if (error) throw new Error(`Не удалось проверить роль: ${error.message}`);
  return !!data?.length;
}
