import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";

import { AnalyticsShell, type AnalyticsView } from "@/components/analytics/analytics-shell";
import { NomenclatureTable } from "@/components/analytics/nomenclature";
import { KpiGrid, KpiTile, TableCard } from "@/components/analytics/parts";
import { ChartArea, ChartPanel, DailyPlot } from "@/components/dashboard/chart-panel";
import { AnalyticsCityBodySkeleton, AnalyticsCityPageSkeleton } from "@/components/page-skeletons";
import { TableSkeletonRows } from "@/components/skeletons";
import { InfoNote } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTableSort, type TableSortState } from "@/hooks/use-table-sort";
import { classesQuery, revenueQuery, salesQuery, trialsQuery } from "@/lib/analytics/data";
import { ANALYTICS_TITLES, CITY_TILES, NOMENCLATURE_OPTIONS } from "@/lib/analytics/labels";
import {
  classesSummary,
  cityOf,
  forecast,
  formatRate,
  isClosed,
  monthLabel,
  monthPeriod,
  monthStarts,
  rate,
  salesSummary,
  sumRevenue,
  trialsSummary,
  type NomenclatureFilter,
} from "@/lib/analytics/logic";
import type {
  AnStudio,
  ClassesData,
  RevenueRow,
  SalesData,
  TrialsData,
} from "@/lib/analytics/types";
import { formatMoney, formatNumber } from "@/lib/format";
import { sortRows } from "@/lib/table-sort";

/**
 * «Мой город» — как у Lady Stretch: одна сводка по городу (или клубу) за
 * период — выручка с прогнозом и точкой 0, продажи, что покупают, посещения,
 * пробные и таблица клубов (нажатие — отчёт по клубу). Партнёр видит только
 * свои клубы: база отдаёт клубы, где ему открыт раздел «Аналитика».
 */
export const Route = createFileRoute("/_authenticated/analytics/")({
  head: () => ({ meta: [{ title: "Мой город — Аналитика — Base40 Admin" }] }),
  pendingComponent: AnalyticsCityPageSkeleton,
  component: CityPage,
});

const CHART_MONTHS = 6;
const num = "text-right [&>span]:justify-end";

function CityPage() {
  return (
    <AnalyticsShell title={ANALYTICS_TITLES.city} skeleton={<AnalyticsCityBodySkeleton />}>
      {(view) => <CityBody {...view} />}
    </AnalyticsShell>
  );
}

/** Выручка, прогноз и точка 0 набора клубов. */
function revenueOf(
  rows: RevenueRow[],
  list: AnStudio[],
  period: AnalyticsView["period"],
  today: string,
) {
  const ids = new Set(list.map((s) => s.id));
  const fact = sumRevenue(rows, ids, period.from, period.to);
  const month = monthPeriod(period.from);
  // Прогноз — только когда период и есть текущий месяц.
  const whole = period.from === month.from && period.to === month.to;
  const yesterday = format(addDays(parseISO(today), -1), "yyyy-MM-dd");
  const fc = whole
    ? forecast(sumRevenue(rows, ids, month.from, yesterday), month.from, today)
    : null;
  const open = list.filter((s) => !isClosed(s, today));
  const pointZero =
    open.length > 0 && open.every((s) => s.pointZero !== null)
      ? open.reduce((sum, s) => sum + (s.pointZero ?? 0), 0)
      : null;
  return { fact, forecast: fc, pointZero, reach: pointZero ? rate(fc ?? fact, pointZero) : null };
}

function CityBody({ studios, ids, idSet, period, today, filters, update }: AnalyticsView) {
  const revenue = useQuery(revenueQuery(ids, period));
  const months = monthStarts(period.to, CHART_MONTHS);
  const history = useQuery(revenueQuery(ids, { from: months[0], to: period.to }, "month"));
  const sales = useQuery(salesQuery(ids, period, "month"));
  const classes = useQuery(classesQuery(ids, period, "month"));
  const trials = useQuery(trialsQuery(ids, period, "month"));
  const [nomFilter, setNomFilter] = useState<NomenclatureFilter>("all");
  const sort = useTableSort();

  if (revenue.isError || sales.isError || classes.isError || trials.isError)
    return <InfoNote variant="warning">Не удалось загрузить отчёт. Обновите страницу.</InfoNote>;

  const rev = revenue.data && revenueOf(revenue.data, studios, period, today);
  const s = sales.data && salesSummary(sales.data, idSet);
  const c = classes.data && classesSummary(classes.data.rows, idSet);
  const t = trials.data && trialsSummary(trials.data.rows, idSet);
  const title =
    filters.clubId && studios.length === 1
      ? studios[0].name
      : (filters.city ??
        (new Set(studios.map(cityOf)).size === 1 ? cityOf(studios[0]) : "Все города"));

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <KpiGrid>
        <KpiTile
          {...CITY_TILES.revenue}
          loading={revenue.isLoading}
          value={rev && formatMoney(rev.fact)}
        />
        <KpiTile
          {...CITY_TILES.forecast}
          loading={revenue.isLoading}
          value={rev ? (rev.forecast === null ? "—" : formatMoney(rev.forecast)) : undefined}
          note={rev && rev.forecast === null ? "для периода «текущий месяц»" : undefined}
        />
        <KpiTile
          {...CITY_TILES.pointZero}
          loading={revenue.isLoading}
          value={rev ? (rev.pointZero === null ? "—" : formatMoney(rev.pointZero)) : undefined}
          note={
            rev
              ? rev.pointZero === null
                ? "не задана у всех открытых клубов"
                : `${formatRate(rev.reach)} ${rev.forecast !== null ? "по прогнозу" : "по факту"}`
              : undefined
          }
        />
        <KpiTile
          {...CITY_TILES.sold}
          loading={sales.isLoading}
          value={s && formatNumber(s.sold)}
          note={s && `новых ${formatNumber(s.newSold)} · повторных ${formatNumber(s.repeatSold)}`}
        />
        <KpiTile
          {...CITY_TILES.avgCheck}
          loading={sales.isLoading}
          value={s && (s.avgCheck === null ? "—" : formatMoney(s.avgCheck))}
          note={s && `поступило ${formatMoney(s.paid)}`}
        />
        <KpiTile
          {...CITY_TILES.visits}
          loading={classes.isLoading}
          value={c && formatNumber(c.attended)}
          note={c && `занятий ${formatNumber(c.classes)}`}
        />
        <KpiTile
          {...CITY_TILES.attendance}
          loading={classes.isLoading}
          value={c && formatRate(c.attendance, 1)}
          note={c && `записей ${formatNumber(c.booked)}`}
        />
        <KpiTile
          {...CITY_TILES.trials}
          loading={trials.isLoading}
          value={t && formatRate(t.d14Rate, 1)}
          note={
            t && `в день пробного ${formatRate(t.day0Rate, 1)} · пришли ${formatNumber(t.attended)}`
          }
        />
      </KpiGrid>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartPanel title="Выручка по месяцам" tip={CITY_TILES.revenue.tip}>
          <ChartArea height={240} loading={history.isLoading} error={history.isError}>
            <DailyPlot
              data={months.map((m) => ({
                tick: monthLabel(m),
                label: monthLabel(m, true),
                value: history.data ? sumRevenue(history.data, idSet, m, monthPeriod(m).to) : 0,
              }))}
              color="var(--brand)"
              format={formatMoney}
            />
          </ChartArea>
        </ChartPanel>
        <TableCard
          title="Что покупают"
          tip="Номенклатуры проданных абонементов за период."
          actions={
            <SegmentedControl
              aria-label="Какие продажи"
              value={nomFilter}
              onChange={setNomFilter}
              options={NOMENCLATURE_OPTIONS}
            />
          }
        >
          <NomenclatureTable data={sales.data} ids={idSet} filter={nomFilter} limit={8} />
        </TableCard>
      </div>

      <ClubsTable
        studios={studios}
        today={today}
        period={period}
        revenue={revenue.data}
        sales={sales.data}
        classes={classes.data}
        trials={trials.data}
        sort={sort}
        onPick={(id) => update({ clubId: id })}
        picked={filters.clubId}
      />
    </div>
  );
}

function ClubsTable({
  studios,
  today,
  period,
  revenue,
  sales,
  classes,
  trials,
  sort,
  onPick,
  picked,
}: {
  studios: AnStudio[];
  today: string;
  period: AnalyticsView["period"];
  revenue: RevenueRow[] | undefined;
  sales: SalesData | undefined;
  classes: ClassesData | undefined;
  trials: TrialsData | undefined;
  sort: Pick<TableSortState, "sort" | "head">;
  onPick: (id: string) => void;
  picked: string | null;
}) {
  const loading = !revenue || !sales || !classes || !trials;
  const rows = loading
    ? []
    : studios.map((st) => {
        const ids = new Set([st.id]);
        return {
          studio: st,
          rev: revenueOf(revenue, [st], period, today),
          s: salesSummary(sales, ids),
          c: classesSummary(classes.rows, ids),
          t: trialsSummary(trials.rows, ids),
        };
      });
  const sorted = sortRows(rows, sort.sort, {
    name: (r) => r.studio.name,
    revenue: (r) => r.rev.fact,
    forecast: (r) => r.rev.forecast,
    reach: (r) => r.rev.reach,
    sold: (r) => r.s.sold,
    newSold: (r) => r.s.newSold,
    visits: (r) => r.c.attended,
    attendance: (r) => r.c.attendance,
    trials: (r) => r.t.d14Rate,
  });
  return (
    <TableCard title="Клубы" tip="Нажмите на клуб — отчёт покажет только его.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead {...sort.head("name")}>Клуб</TableHead>
            <TableHead className={num} {...sort.head("revenue")}>
              Выручка
            </TableHead>
            <TableHead className={num} {...sort.head("forecast")}>
              Прогноз
            </TableHead>
            <TableHead className={num} tip={CITY_TILES.pointZero.tip} {...sort.head("reach")}>
              % точки 0
            </TableHead>
            <TableHead className={num} {...sort.head("sold")}>
              Продано
            </TableHead>
            <TableHead className={num} {...sort.head("newSold")}>
              Новые
            </TableHead>
            <TableHead className={num} {...sort.head("visits")}>
              Посещения
            </TableHead>
            <TableHead className={num} {...sort.head("attendance")}>
              Доходимость
            </TableHead>
            <TableHead className={num} tip={CITY_TILES.trials.tip} {...sort.head("trials")}>
              Пробные → 14 дн.
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeletonRows columns={9} rows={Math.min(studios.length, 6)} />
          ) : (
            sorted.map(({ studio, rev, s, c, t }) => (
              <TableRow
                key={studio.id}
                className={picked === studio.id ? "bg-muted/50" : "cursor-pointer"}
                onClick={() => onPick(studio.id)}
              >
                <TableCell className="font-medium">
                  {studio.name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {cityOf(studio)}
                    {isClosed(studio, today) ? " · закрыт" : ""}
                  </span>
                </TableCell>
                <TableCell className="text-right">{formatMoney(rev.fact)}</TableCell>
                <TableCell className="text-right">
                  {rev.forecast === null ? "—" : formatMoney(rev.forecast)}
                </TableCell>
                <TableCell className="text-right">{formatRate(rev.reach)}</TableCell>
                <TableCell className="text-right">{formatNumber(s.sold)}</TableCell>
                <TableCell className="text-right">{formatNumber(s.newSold)}</TableCell>
                <TableCell className="text-right">{formatNumber(c.attended)}</TableCell>
                <TableCell className="text-right">{formatRate(c.attendance, 1)}</TableCell>
                <TableCell className="text-right">{formatRate(t.d14Rate, 1)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableCard>
  );
}
