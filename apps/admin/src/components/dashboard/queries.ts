import { useQuery } from "@tanstack/react-query";

import type { Studio } from "@/hooks/use-studios";
import { loadSalesHistory } from "@/lib/dashboard-data";

/**
 * История продаж клуба за всё время — одна на «Общие показатели», «Продажи»
 * и «Клиенты» (общий queryKey): смена периода и переход между подразделами
 * считаются по ней в браузере, без новых запросов.
 */
export function useSalesHistory(studio: Studio) {
  return useQuery({
    queryKey: ["dashboard", studio.id, "sales-history"],
    queryFn: () => loadSalesHistory(studio.id),
    meta: { errorMessage: `${studio.name}: не удалось загрузить продажи для дашборда` },
  });
}
