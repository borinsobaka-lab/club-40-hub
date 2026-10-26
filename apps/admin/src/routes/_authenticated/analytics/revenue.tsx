import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { addDays, addMonths, format, parseISO } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";

import { AnalyticsShell, type AnalyticsView } from "@/components/analytics/analytics-shell";
import { KpiGrid, KpiTile, TableCard } from "@/components/analytics/parts";
import {
  AnalyticsRevenueBodySkeleton,
  AnalyticsRevenuePageSkeleton,
} from "@/components/page-skeletons";
import { TableSkeletonRows } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { revenueQuery } from "@/lib/analytics/data";
import { ANALYTICS_TITLES, REVENUE_TILES } from "@/lib/analytics/labels";
import {
  formatRate,
  isClosed,
  monthLabel,
  revenueTable,
  sumRevenue,
  type RevenueLine,
} from "@/lib/analytics/logic";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analytics/revenue")({
  head: () => ({ meta: [{ title: "Выручка — Аналитика — Base40 Admin" }] }),
  pendingComponent: AnalyticsRevenuePageSkeleton,
  component: RevenuePage,
});

/** Сколько прошлых месяцев справа от выбранного (как у Lady Stretch — полгода). */
const HISTORY = 6;

const TIPS = {
  week: "Выручка за календарную неделю (пн–вс) внутри месяца.",
  month: "Выручка выбранного месяца, с сегодняшним днём.",
  forecast: REVENUE_TILES.forecast.tip,
  pointZero:
    "Месячная выручка «в ноль». У города — сумма точек 0 открытых клубов, если задана у всех.",
  rate: "Прогноз (у прошлого месяца — факт) к точке 0.",
  history: "Выручка прошлого месяца целиком.",
};

function RevenuePage() {
  return (
    <AnalyticsShell
      title={ANALYTICS_TITLES.revenue}
      mode="month"
      skeleton={<AnalyticsRevenueBodySkeleton />}
    >
      {(view) => <RevenueBody {...view} />}
    </AnalyticsShell>
  );
}

function RevenueBody({ studios, ids, idSet, period, today }: AnalyticsView) {
  const month = period.from;
  const historyFrom = format(addMonths(parseISO(month), -HISTORY), "yyyy-MM-dd");
  const days = useQuery(revenueQuery(ids, period));
  const months = useQuery(
    revenueQuery(
      ids,
      { from: historyFrom, to: format(addDays(parseISO(month), -1), "yyyy-MM-dd") },
      "month",
    ),
  );
  const loading = days.isLoading || months.isLoading;
  const table = useMemo(
    () =>
      days.data && months.data
        ? revenueTable({
            studios,
            days: days.data,
            months: months.data,
            month,
            today,
            history: HISTORY,
          })
        : null,
    [studios, days.data, months.data, month, today],
  );
  const [open, setOpen] = useState<Set<string> | "all" | null>(null);
  // По умолчанию раскрыты все города, если их немного.
  const expanded = (city: string) =>
    open === "all" || (open === null ? (table?.cities.length ?? 0) <= 3 : open.has(city));
  const toggle = (city: string) => {
    const now = new Set(
      table?.cities.filter((c) => expanded(c.line.label)).map((c) => c.line.label),
    );
    if (now.has(city)) now.delete(city);
    else now.add(city);
    setOpen(now);
  };

  if (days.isError || months.isError)
    return <InfoNote variant="warning">Не удалось загрузить выручку. Обновите страницу.</InfoNote>;

  const openIds = new Set(studios.filter((s) => !isClosed(s, today)).map((s) => s.id));
  const closedIds = new Set([...idSet].filter((id) => !openIds.has(id)));
  const end = period.to;
  const currentMonth = today.slice(0, 7) === month.slice(0, 7);

  return (
    <div className="space-y-3">
      <KpiGrid>
        <KpiTile
          {...REVENUE_TILES.fact}
          loading={loading}
          value={table && formatMoney(table.total.fact)}
          note={`${monthLabel(month, true)}${currentMonth ? ", по сегодня" : ""}`}
        />
        <KpiTile
          {...REVENUE_TILES.forecast}
          loading={loading}
          value={table?.total.forecast != null ? formatMoney(table.total.forecast) : "—"}
          note={
            table?.total.pointZeroRate != null
              ? `${formatRate(table.total.pointZeroRate)} точки 0`
              : currentMonth
                ? "по среднему дневному темпу"
                : "только для текущего месяца"
          }
        />
        <KpiTile
          {...REVENUE_TILES.open}
          loading={loading}
          value={days.data && formatMoney(sumRevenue(days.data, openIds, month, end))}
          note={`клубов: ${openIds.size}`}
        />
        <KpiTile
          {...REVENUE_TILES.closed}
          loading={loading}
          value={days.data && formatMoney(sumRevenue(days.data, closedIds, month, end))}
          note={`клубов: ${closedIds.size}`}
        />
      </KpiGrid>

      <TableCard
        title="Города и клубы"
        tip="Сначала города с открытыми клубами, внутри — открытые клубы, затем закрытые. Нажмите на город, чтобы раскрыть его клубы."
        actions={
          table && table.cities.length > 1 ? (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setOpen("all")}>
                Раскрыть все
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(new Set())}>
                Свернуть
              </Button>
            </div>
          ) : undefined
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-48">Город / клуб</TableHead>
              {(table?.weeks ?? []).map((w) => (
                <TableHead key={w.from} tip={TIPS.week} className="text-right [&>span]:justify-end">
                  {w.label}
                </TableHead>
              ))}
              <TableHead tip={TIPS.month} className="bg-emerald-50 text-right [&>span]:justify-end">
                Месяц
              </TableHead>
              <TableHead
                tip={TIPS.forecast}
                className="bg-violet-50 text-right [&>span]:justify-end"
              >
                Прогноз
              </TableHead>
              <TableHead tip={TIPS.pointZero} className="text-right [&>span]:justify-end">
                Точка 0
              </TableHead>
              <TableHead tip={TIPS.rate} className="text-right [&>span]:justify-end">
                % точки 0
              </TableHead>
              {(table?.historyMonths ?? []).map((m) => (
                <TableHead key={m} tip={TIPS.history} className="text-right [&>span]:justify-end">
                  {monthLabel(m)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading || !table ? (
              <TableSkeletonRows columns={5 + 4 + HISTORY} rows={8} />
            ) : (
              <>
                <Line line={table.total} variant="total" />
                {table.cities.map((c) => {
                  const isOpen = expanded(c.line.label);
                  return (
                    <Fragment key={c.line.key}>
                      <Line
                        line={c.line}
                        variant="city"
                        open={isOpen}
                        onToggle={() => toggle(c.line.label)}
                      />
                      {isOpen && c.studios.map((s) => <Line key={s.key} line={s} variant="club" />)}
                    </Fragment>
                  );
                })}
              </>
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

function Line({
  line,
  variant,
  open,
  onToggle,
}: {
  line: RevenueLine;
  variant: "total" | "city" | "club";
  open?: boolean;
  onToggle?: () => void;
}) {
  const money = (v: number | null) => (v === null ? "—" : formatMoney(v));
  return (
    <TableRow
      className={cn(
        variant === "total" && "bg-violet-50/70 font-semibold hover:bg-violet-50",
        variant === "city" && "font-medium",
        line.closed && "text-muted-foreground",
      )}
    >
      <TableCell className={cn("min-w-48", variant === "club" && "pl-9")}>
        {variant === "city" ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {line.label}
            <span className="text-xs font-normal text-muted-foreground">· {line.studios}</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-2">
            {line.label}
            {variant === "club" && line.closed && (
              <StatusChip tone="neutral" size="sm">
                закрыт
              </StatusChip>
            )}
          </span>
        )}
      </TableCell>
      {line.weeks.map((w, i) => (
        <TableCell key={i} className="text-right">
          {formatMoney(w)}
        </TableCell>
      ))}
      <TableCell className="bg-emerald-50/60 text-right">{formatMoney(line.fact)}</TableCell>
      <TableCell className="bg-violet-50/60 text-right text-violet-700">
        {money(line.forecast)}
      </TableCell>
      <TableCell className="text-right">{money(line.pointZero)}</TableCell>
      <TableCell
        className={cn(
          "text-right",
          line.pointZeroRate !== null &&
            (line.pointZeroRate >= 100 ? "text-emerald-700" : "text-rose-600"),
        )}
      >
        {formatRate(line.pointZeroRate)}
      </TableCell>
      {line.history.map((h, i) => (
        <TableCell key={i} className="text-right">
          {formatMoney(h)}
        </TableCell>
      ))}
    </TableRow>
  );
}
