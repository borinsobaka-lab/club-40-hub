import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { unwrap } from "@/lib/query";
import { catalogStudioIds, type CatalogStudio } from "@/lib/studio-catalog";

/**
 * Все клубы базы с форматом (studios читается публично). Нужен, чтобы
 * собрать общий каталог пакетных клубов и там, где сотрудник работает не во
 * всех из них: тренировка могла быть заведена в чужом клубе. Ключ — под
 * ["studios"]: правка клубов инвалидирует и его.
 */
export const catalogStudiosQuery = queryOptions({
  queryKey: ["studios", "catalog"],
  queryFn: () =>
    unwrap<CatalogStudio[]>(supabase.from("studios").select("id, format").order("created_at")),
  staleTime: Infinity,
  meta: { errorMessage: "Не удалось загрузить клубы" },
});

/**
 * Клубы каталога клуба (lib/studio-catalog.ts; по умолчанию — активного):
 * у пакетного — все пакетные клубы, у подписочного — он сам. null — ещё
 * грузится или клуб не выбран: запросы каталога ждут (`enabled: !!ids`).
 */
export function useCatalogStudioIds(forStudioId?: string | null): string[] | null {
  const activeId = useActiveStudioId();
  const studioId = forStudioId === undefined ? activeId : forStudioId;
  const { data } = useQuery(catalogStudiosQuery);
  return useMemo(
    () => (studioId && data ? catalogStudioIds(data, studioId) : null),
    [studioId, data],
  );
}
