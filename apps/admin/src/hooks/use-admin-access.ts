import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useStudios } from "@/hooks/use-studios";
import { unwrap } from "@/lib/query";
import type { AdminAccess, ClubSectionKey, RailAccessKey } from "@/lib/admin-access";

type OwnPermissions = {
  rail: RailAccessKey[] | null;
  studios: Record<string, ClubSectionKey[]>;
};

/**
 * Права текущего сотрудника («Доступы»): какие разделы рейки и клуба ему
 * открыты. null — ещё загружаются. Свои строки прав RLS отдаёт всегда.
 *
 * Это только интерфейс: если таблиц прав ещё нет или запрос не удался,
 * считаем, что открыто всё (данные всё равно защищает RLS), а тост об ошибке
 * покажет общий QueryCache.
 */
export function useAdminAccess(): AdminAccess | null {
  const { data: studios, isLoading: studiosLoading } = useStudios();
  const { data: own, isLoading } = useQuery({
    queryKey: ["admin_permissions"],
    queryFn: async (): Promise<OwnPermissions> => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) return { rail: null, studios: {} };
      const [rail, perStudio] = await Promise.all([
        unwrap<{ sections: RailAccessKey[] }[]>(
          supabase.from("admin_permissions").select("sections").eq("user_id", userId),
        ),
        unwrap<{ studio_id: string; sections: ClubSectionKey[] }[]>(
          supabase
            .from("admin_studio_permissions")
            .select("studio_id, sections")
            .eq("user_id", userId),
        ),
      ]);
      return {
        rail: rail[0]?.sections ?? null,
        studios: Object.fromEntries(perStudio.map((r) => [r.studio_id, r.sections])),
      };
    },
    // Права меняет владелец в «Доступах»; свои права он менять не может.
    staleTime: Infinity,
    meta: { errorMessage: "Не удалось загрузить права доступа" },
  });

  if (studiosLoading || isLoading) return null;
  const list = studios ?? [];
  return {
    isOwner: list.some((s) => s.roles.includes("owner")),
    rail: own?.rail ?? null,
    studios: Object.fromEntries(
      list.map((s) => [
        s.id,
        { owner: s.roles.includes("owner"), sections: own?.studios[s.id] ?? null },
      ]),
    ),
  };
}
