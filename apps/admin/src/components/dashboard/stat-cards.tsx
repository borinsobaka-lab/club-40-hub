import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { min } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChartArea,
  ChartColumn,
  ChartLine,
  Minus,
} from "lucide-react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldHint } from "@/components/ui/field-hint";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChartType } from "@/components/metric-chart-plot";
import { DashboardStatsSkeleton } from "@/components/page-skeletons";
import type { Studio } from "@/hooks/use-studios";
import { useIsMobile } from "@/hooks/use-mobile";
import { toISO, type SeriesDef } from "@/lib/dashboard-data";
import { aggregate, buildBuckets, seriesTotal, type Granularity } from "@/lib/dashboard-series";
import { formatStat, type StatFormat, type StatInfo } from "@/lib/dashboard-stats";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Плитки показателей дашборда: подпись с «?» (что значит показатель),
 * значение и пометка «за период» / «сейчас» справа от него, ниже — сравнение
 * с предыдущим периодом. Плитка с графиком открывает окно с разбивкой по
 * месяцам / неделям / дням.
 */

/** Плитка: подпись, подсказка и вид значения (lib/dashboard-stats.ts) и график в окне. */
export type StatDef<K extends string = string> = StatInfo<K> & {
  /** График в окне плитки; без него плитка не нажимается. */
  series?: SeriesDef;
};

function Delta({
  current,
  previous,
  goodWhenUp,
  format,
}: {
  current: number;
  previous: number;
  goodWhenUp: boolean;
  format: StatFormat;
}) {
  if (previous === 0 && current === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> без изменений
      </span>
    );
  }
  const diff = current - previous;
  const pct = previous === 0 ? null : (diff / Math.abs(previous)) * 100;
  const up = diff > 0;
  const flat = diff === 0;
  const good = flat ? null : up === goodWhenUp;
  const color = flat ? "text-muted-foreground" : good ? "text-emerald-600" : "text-rose-600";
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  const diffText = formatStat(format, Math.abs(diff));
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1 text-xs", color)}>
      <Icon className="h-3 w-3" />
      {pct === null
        ? diffText
        : `${flat ? "" : up ? "+" : "−"}${Math.abs(pct).toFixed(0)}% · ${diffText}`}
      <span className="text-muted-foreground max-sm:hidden">vs пред. период</span>
    </span>
  );
}

export function StatGrid<K extends string>({
  studio,
  stats,
  current,
  previous,
  loading,
  periodEnd,
  className,
}: {
  studio: Studio;
  stats: StatDef<K>[];
  current: Partial<Record<K, number>>;
  previous: Partial<Record<K, number>>;
  loading: boolean;
  /** Конец выбранного периода — им заканчивается график в окне плитки. */
  periodEnd: Date;
  /** Сетка плиток — классы колонок под число показателей раздела. */
  className: string;
}) {
  // Показатель держим и после закрытия: иначе окно пустеет, пока гаснет.
  const [chartStat, setChartStat] = useState<StatDef<K> | null>(null);
  const [chartOpen, setChartOpen] = useState(false);

  if (loading)
    return <DashboardStatsSkeleton labels={stats.map((s) => s.label)} className={className} />;

  return (
    <>
      {/* На телефоне — две плитки в ряд: по одной в столбик показатели
          растягивались на несколько экранов. */}
      <div className={cn("grid grid-cols-2 gap-2 sm:gap-3", className)}>
        {stats.map((stat) => {
          const v = current[stat.key];
          const p = previous[stat.key];
          return (
            <StatCard
              key={stat.key}
              stat={stat}
              value={v === undefined ? "—" : formatStat(stat.format, v)}
              delta={
                stat.compare && v !== undefined && p !== undefined ? (
                  <Delta
                    current={v}
                    previous={p}
                    goodWhenUp={stat.goodWhenUp}
                    format={stat.format}
                  />
                ) : null
              }
              onOpenChart={
                stat.series
                  ? () => {
                      setChartStat(stat);
                      setChartOpen(true);
                    }
                  : undefined
              }
            />
          );
        })}
      </div>

      <Dialog open={chartOpen} onOpenChange={setChartOpen}>
        <DialogContent className="sm:max-w-5xl">
          {chartStat?.series && (
            <MetricChart
              key={chartStat.key}
              studio={studio}
              stat={chartStat}
              def={chartStat.series}
              periodEnd={periodEnd}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatCard({
  stat,
  value,
  delta,
  onOpenChart,
}: {
  stat: StatDef;
  value: string;
  delta: ReactNode;
  onOpenChart?: () => void;
}) {
  const chartable = !!onOpenChart;
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col rounded-lg border bg-background px-3 py-2.5 sm:px-4 sm:py-3",
        chartable &&
          "group transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm has-[button[data-card]:focus-visible]:ring-2 has-[button[data-card]:focus-visible]:ring-ring",
      )}
    >
      {/* Вся плитка — кнопка графика, но «?» внутри неё нельзя (кнопка в
          кнопке): кнопка растянута под содержимым, «?» лежит над ней. */}
      {chartable && (
        <button
          type="button"
          data-card
          onClick={onOpenChart}
          className="absolute inset-0 cursor-pointer rounded-lg focus-visible:outline-none"
        >
          <span className="sr-only">{stat.label} — открыть график</span>
        </button>
      )}
      {chartable && (
        <ArrowUpRight
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-2.5 size-4 text-muted-foreground transition-[color,transform] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground sm:right-3 sm:top-3"
        />
      )}
      <span
        className={cn(
          "pointer-events-none block text-xs font-medium text-muted-foreground sm:text-sm",
          chartable && "pr-5",
        )}
      >
        {stat.label}
        <FieldHint className="pointer-events-auto relative z-10 ml-1 align-[-2px]">
          {stat.tip}
        </FieldHint>
      </span>
      <span className="pointer-events-none mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className="text-lg font-semibold tabular-nums sm:text-xl">{value}</span>
        {stat.hint && <span className="text-xs text-muted-foreground">{stat.hint}</span>}
      </span>
      {delta && <span className="pointer-events-none mt-1 block">{delta}</span>}
    </div>
  );
}

const GRANULARITIES: { value: Granularity; label: string; span: string; unit: string }[] = [
  { value: "month", label: "По месяцам", span: "12 месяцев", unit: "месяц" },
  { value: "week", label: "По неделям", span: "12 недель", unit: "неделю" },
  { value: "day", label: "По дням", span: "30 дней", unit: "день" },
];

// График (recharts, ~100 kB gzip) — отдельным чанком: дашборд открывается
// первым после входа, а окно с графиком нужно не каждый раз.
const MetricChartPlot = lazy(() =>
  import("@/components/metric-chart-plot").then((m) => ({ default: m.MetricChartPlot })),
);

const CHART_TYPES: { value: ChartType; label: string; icon: typeof ChartColumn }[] = [
  { value: "bar", label: "Столбцы", icon: ChartColumn },
  { value: "line", label: "Линия", icon: ChartLine },
  { value: "area", label: "Область", icon: ChartArea },
];

/**
 * Окно графика показателя: разбивка (табы) и вид графика. Окно графика
 * заканчивается периодом, выбранным на дашборде (см. SeriesDef.future).
 */
function MetricChart({
  studio,
  stat,
  def,
  periodEnd,
}: {
  studio: Studio;
  stat: StatDef;
  def: SeriesDef;
  periodEnd: Date;
}) {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const isMobile = useIsMobile();

  const anchor = def.future ? periodEnd : min([periodEnd, new Date()]);
  const anchorISO = toISO(anchor);
  const buckets = useMemo(
    () => buildBuckets(granularity, new Date(`${anchorISO}T00:00:00`)),
    [granularity, anchorISO],
  );
  const from = buckets[0].from;
  const to = buckets[buckets.length - 1].to;

  const query = useQuery({
    queryKey: ["dashboard", studio.id, "series", stat.key, granularity, from, to],
    queryFn: async () => {
      const points = await def.load(studio.id, from, to);
      return aggregate(granularity, buckets, points, def.kind);
    },
    // Пока грузится другая разбивка — прежний график, а не пустое место.
    placeholderData: keepPreviousData,
    meta: { errorMessage: `${studio.name}: не удалось загрузить график «${stat.label}»` },
  });

  const values = query.data;
  const g = GRANULARITIES.find((x) => x.value === granularity)!;
  const fmt = (n: number) => formatStat(stat.format, n);
  const color = studio.brand_color || "var(--brand)";

  const data = (values ?? []).map((v) => ({
    tick: v.bucket.tick,
    label: v.bucket.label,
    value: v.value,
    n: v.n,
  }));
  const filled = (values ?? []).filter((v) => v.value !== null && v.value !== 0);
  const total = values ? seriesTotal(def.kind, values) : null;
  const best = filled.reduce<(typeof filled)[number] | null>(
    (b, v) => (b === null || v.value! > b.value! ? v : b),
    null,
  );

  const summary = [
    {
      label: def.kind === "avg" ? `Средний за ${g.span}` : `Итого за ${g.span}`,
      value: total === null ? "—" : fmt(total),
    },
    def.kind === "avg"
      ? {
          label: `Продаж за ${g.span}`,
          value: formatNumber((values ?? []).reduce((s, v) => s + v.n, 0)),
        }
      : {
          label: `В среднем за ${g.unit}`,
          // Штуки в среднем — целым числом: «1 196,833 посещения» не читается.
          value:
            total === null
              ? "—"
              : fmt(
                  def.kind === "count"
                    ? Math.round(total / buckets.length)
                    : total / buckets.length,
                ),
        },
    {
      label: "Максимум",
      value: best ? fmt(best.value!) : "—",
      note: best?.bucket.label,
    },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{stat.label}</DialogTitle>
        <DialogDescription>
          {studio.name} · {def.description}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            aria-label="Разбивка"
            value={granularity}
            onChange={setGranularity}
            options={GRANULARITIES}
          />
          <SegmentedControl
            aria-label="Вид графика"
            iconOnly
            value={chartType}
            onChange={setChartType}
            options={CHART_TYPES}
          />
        </div>

        {/* На телефоне итоги — строками «подпись · значение»: в трети ширины
            суммы вида «18 222 313 GEL» обрезались. */}
        <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          {summary.map((s) => (
            <div
              key={s.label}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border px-3 py-2 sm:grid-cols-1 sm:content-start sm:p-3"
            >
              <div className="text-xs text-muted-foreground">{s.label}</div>
              {values ? (
                <div className="whitespace-nowrap text-base font-semibold tabular-nums max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1 sm:mt-1 sm:truncate sm:text-lg">
                  {s.value}
                </div>
              ) : (
                <Skeleton className="h-6 w-20 max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1 sm:mt-1.5" />
              )}
              {s.note && (
                <div className="truncate text-xs text-muted-foreground first-letter:uppercase">
                  {s.note}
                </div>
              )}
            </div>
          ))}
        </div>

        <div
          className={cn("relative transition-opacity", query.isPlaceholderData && "opacity-50")}
          style={{ height: isMobile ? 260 : 340 }}
        >
          {!values ? (
            query.isError ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Не удалось загрузить график
              </div>
            ) : (
              <Skeleton className="h-full w-full" />
            )
          ) : filled.length === 0 && !query.isPlaceholderData ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              Нет данных за {g.span}
            </div>
          ) : (
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <MetricChartPlot
                data={data}
                chartType={chartType}
                color={color}
                dots={granularity !== "day"}
                format={fmt}
                showDeals={def.kind === "avg"}
              />
            </Suspense>
          )}
        </div>
      </DialogBody>
    </>
  );
}
