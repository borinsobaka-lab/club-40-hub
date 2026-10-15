import { useQuery } from "@tanstack/react-query";

import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useActiveStudio } from "@/hooks/use-studios";
import { supabase } from "@/integrations/supabase/client";
import { canOpenClubSection } from "@/lib/admin-access";

/**
 * Заявки клиентов из приложения пакетных клубов (client_requests,
 * db/migrations/2026-10-15_zz_diagnostics_client_requests.sql): на
 * персональные занятия и на диагностику. «Обратная связь» → «Заявки».
 */

export type ClientRequestKind = "personal" | "diagnostic";

export const REQUEST_KIND_LABEL: Record<ClientRequestKind, string> = {
  personal: "Персональные занятия",
  diagnostic: "Диагностика",
};

/** Ключ счётчика — его же обновляет страница после «Отработано». */
export const OPEN_REQUESTS_KEY = "client_requests_open";

/**
 * Неотработанные заявки клуба — бейдж на «Клубе» в рейке и на «Заявках» в
 * меню. Раз в минуту и при возвращении на вкладку: новые заявки приходят из
 * приложения, страницу никто не обновляет.
 */
export function useOpenRequestsCount(studioId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [OPEN_REQUESTS_KEY, studioId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("client_requests")
        .select("id", { count: "exact", head: true })
        .eq("studio_id", studioId as string)
        .is("processed_at", null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    enabled: enabled && !!studioId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  }).data;
}

/**
 * Счётчик для меню и рейки: только в пакетном клубе и только если раздел
 * «Заявки» открыт сотруднику в этом клубе; иначе 0.
 */
export function useClubRequestsBadge() {
  const studioId = useActiveStudioId();
  const studio = useActiveStudio();
  const access = useAdminAccess();
  const enabled =
    studio?.format === "packages" && !!access && canOpenClubSection(access, studioId, "requests");
  const count = useOpenRequestsCount(studioId, enabled);
  return enabled ? (count ?? 0) : 0;
}
