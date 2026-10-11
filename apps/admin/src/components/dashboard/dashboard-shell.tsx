import { type ReactNode } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { DashboardStudioSkeleton } from "@/components/page-skeletons";
import { TableToolbar } from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { currentMonth, useDashboardPeriod } from "@/hooks/use-dashboard-period";
import { useStudios, type Studio } from "@/hooks/use-studios";
import { dashboardStudioIds } from "@/lib/admin-access";
import { previousPeriod, toISO, type Period } from "@/lib/dashboard-data";

/** Что получает подраздел дашборда для одного клуба. */
export type StudioView = {
  studio: Studio;
  /** Выбранный период; null — даты не выбраны. */
  period: Period | null;
  /** Предыдущий период той же длины — для сравнения. */
  prev: Period | null;
  /** Конец выбранного периода (без периода — сегодня). */
  periodEnd: Date;
};

/**
 * Подраздел дашборда (меню «Дашборд»: общие показатели, продажи, клиенты…).
 * Дашборд — над клубами: показатели всех клубов сотрудника одна под другой,
 * у каждого клуба свой период (общий для всех подразделов). Клуб попадает
 * сюда, только если у сотрудника есть в нём роль и открыт раздел «Дашборд»
 * («Доступы»); данные всё равно ограничивает RLS по клубу.
 */
export function DashboardShell({
  title,
  skeleton,
  children,
}: {
  title: string;
  /** Тело подраздела, пока данных нет (то же, что в скелетоне страницы). */
  skeleton: ReactNode;
  children: (view: StudioView) => ReactNode;
}) {
  const access = useAdminAccess();
  const { data: studios, isLoading } = useStudios();

  const allowed = access ? new Set(dashboardStudioIds(access)) : null;
  const list = allowed ? (studios ?? []).filter((s) => allowed.has(s.id)) : [];

  return (
    <AdminShell title={title}>
      {isLoading || !access ? (
        <DashboardStudioSkeleton>{skeleton}</DashboardStudioSkeleton>
      ) : list.length === 0 ? (
        <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
          Нет клубов, где вам открыт дашборд.
        </div>
      ) : (
        <div className="space-y-8">
          {list.map((studio) => (
            <StudioSection key={studio.id} studio={studio}>
              {children}
            </StudioSection>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function StudioSection({
  studio,
  children,
}: {
  studio: Studio;
  children: (view: StudioView) => ReactNode;
}) {
  const [range, setRange] = useDashboardPeriod(studio.id);
  const fromDate = range?.from;
  const toDate = range?.to ?? range?.from;
  const period = fromDate && toDate ? { from: toISO(fromDate), to: toISO(toDate) } : null;
  // Фоновое обновление любого запроса этого клуба — спиннер в плашке.
  const fetching = useIsFetching({ queryKey: ["dashboard", studio.id] }) > 0;
  const headingId = `dashboard-${studio.id}`;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      {/* Точка — основной цвет клуба, как в переключателе клубов. */}
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: studio.brand_color }}
          aria-hidden
        />
        <span className="min-w-0 truncate">{studio.name}</span>
      </h2>
      <TableToolbar>
        <DateRangeFilter
          placeholder="Выберите период"
          value={range}
          onChange={setRange}
          className="toolbar-full"
        />
        <Button variant="ghost" onClick={() => setRange(currentMonth())}>
          Текущий месяц
        </Button>
        {fetching && (
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            обновляем…
          </div>
        )}
      </TableToolbar>
      {children({
        studio,
        period,
        prev: period && previousPeriod(period),
        periodEnd: toDate ?? new Date(),
      })}
    </section>
  );
}
