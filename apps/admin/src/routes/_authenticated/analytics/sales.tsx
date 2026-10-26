import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AnalyticsShell, type AnalyticsView } from "@/components/analytics/analytics-shell";
import { KpiGrid, KpiTile, TableCard } from "@/components/analytics/parts";
import { NomenclatureTable } from "@/components/analytics/nomenclature";
import { ChartArea, ChartPanel, DailyPlot } from "@/components/dashboard/chart-panel";
import {
  AnalyticsSalesBodySkeleton,
  AnalyticsSalesPageSkeleton,
} from "@/components/page-skeletons";
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
import { useTableSort } from "@/hooks/use-table-sort";
import { salesQuery } from "@/lib/analytics/data";
import { ANALYTICS_TITLES, NOMENCLATURE_OPTIONS, SALES_TILES } from "@/lib/analytics/labels";
import {
  change,
  monthStarts,
  salesByMonth,
  salesSummary,
  shiftPeriod,
  type NomenclatureFilter,
  type SalesSummary,
} from "@/lib/analytics/logic";
import { formatMoney, formatNumber } from "@/lib/format";
import { sortRows } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/analytics/sales")({
  head: () => ({ meta: [{ title: "Продажи абонементов — Аналитика — Base40 Admin" }] }),
  pendingComponent: AnalyticsSalesPageSkeleton,
  component: SalesPage,
});

/** Месяцев на графиках (как у Lady Stretch). */
const CHART_MONTHS = 9;
const CHART_HEIGHT = 240;

function SalesPage() {
  return (
    <AnalyticsShell title={ANALYTICS_TITLES.sales} skeleton={<AnalyticsSalesBodySkeleton />}>
      {(view) => <SalesBody {...view} />}
    </AnalyticsShell>
  );
}

const money = (v: number | null) => (v === null ? "—" : formatMoney(v));

function SalesBody({ studios, ids, idSet, period }: AnalyticsView) {
  const cur = useQuery(salesQuery(ids, period, "month"));
  const prevMonth = useQuery(salesQuery(ids, shiftPeriod(period, -1), "month"));
  const prevYear = useQuery(salesQuery(ids, shiftPeriod(period, -12), "month"));
  const months = monthStarts(period.to, CHART_MONTHS);
  const chart = useQuery(salesQuery(ids, { from: months[0], to: period.to }, "month"));
  const [nomFilter, setNomFilter] = useState<NomenclatureFilter>("all");
  const sort = useTableSort();

  if (cur.isError)
    return <InfoNote variant="warning">Не удалось загрузить продажи. Обновите страницу.</InfoNote>;

  const loading = cur.isLoading;
  const s = cur.data && salesSummary(cur.data, idSet);
  const pm = prevMonth.data && salesSummary(prevMonth.data, idSet);
  const py = prevYear.data && salesSummary(prevYear.data, idSet);
  const deltas = (k: keyof SalesSummary) => [
    { label: "к пр. месяцу", value: s && pm ? change(s[k], pm[k]) : null },
    { label: "к пр. году", value: s && py ? change(s[k], py[k]) : null },
  ];
  const tile = (k: keyof typeof SALES_TILES, value: (x: SalesSummary) => string) => (
    <KpiTile
      key={k}
      {...SALES_TILES[k]}
      loading={loading}
      value={s && value(s)}
      deltas={deltas(k as keyof SalesSummary)}
    />
  );
  const points = chart.data ? salesByMonth(chart.data, idSet, months) : [];

  const rows = studios.map((st) => {
    const x = cur.data ? salesSummary(cur.data, new Set([st.id])) : null;
    return { studio: st, x };
  });
  const sorted = sort.sort
    ? sortRows(rows, sort.sort, {
        name: (r) => r.studio.name,
        sold: (r) => r.x?.sold,
        newSold: (r) => r.x?.newSold,
        renewals: (r) => r.x?.renewals,
        returns: (r) => r.x?.returns,
        singles: (r) => r.x?.singles,
        paid: (r) => r.x?.paid,
        avgCheck: (r) => r.x?.avgCheck,
      })
    : rows;
  const num = "text-right [&>span]:justify-end";

  return (
    <div className="space-y-3">
      <KpiGrid cols={6}>
        {tile("sold", (x) => formatNumber(x.sold))}
        {tile("newSold", (x) => formatNumber(x.newSold))}
        {tile("repeatSold", (x) => formatNumber(x.repeatSold))}
        {tile("paid", (x) => formatMoney(x.paid))}
        {tile("newPaid", (x) => formatMoney(x.newPaid))}
        {tile("repeatPaid", (x) => formatMoney(x.repeatPaid))}
      </KpiGrid>
      <KpiGrid cols={3}>
        {tile("avgCheck", (x) => money(x.avgCheck))}
        {tile("avgNew", (x) => money(x.avgNew))}
        {tile("avgRepeat", (x) => money(x.avgRepeat))}
      </KpiGrid>
      <div className="grid gap-3 xl:grid-cols-2">
        <ChartPanel
          title="Продано по месяцам"
          tip="Абонементы (новые, продления, возвраты) по месяцам продажи."
        >
          <ChartArea height={CHART_HEIGHT} loading={chart.isLoading} error={chart.isError}>
            <DailyPlot
              data={points.map((p) => ({
                tick: p.label,
                label: p.label,
                value: p.newSold + p.repeatSold,
              }))}
              color="var(--brand)"
              format={formatNumber}
            />
          </ChartArea>
        </ChartPanel>
        <ChartPanel title="Поступило по месяцам" tip={SALES_TILES.paid.tip}>
          <ChartArea height={CHART_HEIGHT} loading={chart.isLoading} error={chart.isError}>
            <DailyPlot
              data={points.map((p) => ({ tick: p.label, label: p.label, value: p.paid }))}
              color="var(--brand)"
              format={formatMoney}
            />
          </ChartArea>
        </ChartPanel>
      </div>
      <TableCard title="По клубам">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead {...sort.head("name")}>Клуб</TableHead>
              <TableHead className={num} tip={SALES_TILES.sold.tip} {...sort.head("sold")}>
                Продано
              </TableHead>
              <TableHead className={num} tip={SALES_TILES.newSold.tip} {...sort.head("newSold")}>
                Новые
              </TableHead>
              <TableHead className={num} {...sort.head("renewals")}>
                Продления
              </TableHead>
              <TableHead className={num} {...sort.head("returns")}>
                Возвраты
              </TableHead>
              <TableHead
                className={num}
                tip="Разовые посещения пакетных клубов."
                {...sort.head("singles")}
              >
                Разовые
              </TableHead>
              <TableHead className={num} tip={SALES_TILES.paid.tip} {...sort.head("paid")}>
                Поступило
              </TableHead>
              <TableHead className={num} tip={SALES_TILES.avgCheck.tip} {...sort.head("avgCheck")}>
                Средний чек
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={8} rows={Math.min(studios.length, 6)} />
            ) : (
              sorted.map(({ studio, x }) => (
                <TableRow key={studio.id}>
                  <TableCell className="font-medium">{studio.name}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.sold ?? 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.newSold ?? 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.renewals ?? 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.returns ?? 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.singles ?? 0)}</TableCell>
                  <TableCell className="text-right">{formatMoney(x?.paid ?? 0)}</TableCell>
                  <TableCell className="text-right">{money(x?.avgCheck ?? null)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      <TableCard
        title="Что покупают"
        tip="Номенклатуры проданных абонементов: число продаж и сумма продаж (цена в продаже)."
        actions={
          <SegmentedControl
            aria-label="Какие продажи"
            value={nomFilter}
            onChange={setNomFilter}
            options={NOMENCLATURE_OPTIONS}
          />
        }
      >
        <NomenclatureTable data={cur.data} ids={idSet} filter={nomFilter} />
      </TableCard>
    </div>
  );
}
