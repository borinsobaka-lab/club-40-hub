import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminAccess, AdminSectionKey, ClubSectionKey } from "@/lib/admin-access";
import type { StaffRole } from "@/lib/roles";

/**
 * Права сотрудника для Kate — как их читает меню (`useAdminAccess`), но на
 * сервере и только для открытого клуба. Свои строки прав RLS отдаёт всегда.
 * Ошибка чтения — исключение: открыть всё при сбое было бы утечкой.
 */
export async function loadAdminAccess(
  supabase: SupabaseClient,
  userId: string,
  studioId: string,
  roles: StaffRole[],
): Promise<AdminAccess> {
  const [rail, club, owner] = await Promise.all([
    supabase.from("admin_permissions").select("sections").eq("user_id", userId),
    supabase
      .from("admin_studio_permissions")
      .select("sections")
      .eq("user_id", userId)
      .eq("studio_id", studioId),
    supabase
      .from("user_roles")
      .select("studio_id")
      .eq("user_id", userId)
      .eq("role", "owner")
      .limit(1),
  ]);
  const error = rail.error ?? club.error ?? owner.error;
  if (error) throw new Error(error.message);
  const railRow = (rail.data ?? [])[0] as { sections: AdminSectionKey[] } | undefined;
  const clubRow = (club.data ?? [])[0] as { sections: ClubSectionKey[] } | undefined;
  return {
    isOwner: (owner.data ?? []).length > 0,
    rail: railRow?.sections ?? null,
    studios: {
      [studioId]: { owner: roles.includes("owner"), sections: clubRow?.sections ?? null },
    },
  };
}
