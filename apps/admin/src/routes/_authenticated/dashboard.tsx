import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, differenceInCalendarDays, addDays, min } from "date-fns";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ChartArea,
  ChartColumn,
  ChartLine,
  Minus,
  Loader2,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { TableToolbar } from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ChartType } from "@/components/metric-chart-plot";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useStudios, type Studio } from "@/hooks/use-studios";
import { useIsMobile } from "@/hooks/use-mobile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatNumber } from "@/lib/format";
import { dashboardStudioIds } from "@/lib/admin-access";
import {
  BUCKET_COUNT,
  aggregate,
  buildBuckets,
  seriesTotal,
  type Granularity,
  type SeriesKind,
  type SeriesPoint,
} from "@/lib/dashboard-series";
import {
  DashboardPageSkeleton,
  DashboardStatsSkeleton,
  DashboardStudioSkeleton,
} from "@/components/page-skeletons";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Дашборд — Base40 Admin" }] }),
  pendingComponent: DashboardPageSkeleton,
  component: DashboardPage,
});

function toISO(d: Date) {
  return format(d, "yyyy-MM-dd");
}

// Границы локальных суток как моменты времени для timestamptz-колонок.
// Строку без смещения ("YYYY-MM-DDT00:00:00") сервер читает в своём поясе
// (UTC), и окно периода съезжало на 4 часа относительно суток студии.
function dayStartISO(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}

function nextDayStartISO(date: string) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Показатели за период — считаются для выбранного и для предыдущего периода. */
type PeriodMetrics = {
  revenue: number;
  signups: number;
  expiring: number;
  visits: number;
  avgMembership: number;
  avgServices: number;
  avgTotal: number;
  debtPeriod: number;
};

/** Показатели «на сейчас» — от выбранного периода не зависят. */
type SnapshotMetrics = {
  activeClients: number;
  debtTotal: number;
};

type Metrics = PeriodMetrics & SnapshotMetrics;

/** Метрика, которую не удалось посчитать, — undefined: в карточке «—», а не 0. */
type Loaded<T> = { metrics: Partial<T>; errors: string[] };

type SupabaseResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

// Таблица ещё не создана миграцией (other_sales, refunds — AGENT_TASKS,
// Задача 6): данных нет — это 0, а не ошибка.
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

/**
 * Запросы метрик независимы: упавший даёт undefined только своим метрикам
 * (текст ошибки — в общий тост), соседние карточки считаются как обычно.
 * `load` — запрос с count (строки не нужны), `loadRows` — все строки
 * источника постранично: суммы считаются по строкам, а PostgREST отдаёт не
 * больше 1000 строк на ответ.
 */
function makeLoader(errors: string[]) {
  async function load(query: PromiseLike<SupabaseResult>) {
    const { data, error, count } = await query;
    if (error) {
      if (error.code && MISSING_TABLE.has(error.code)) return { rows: [], count: 0 };
      errors.push(error.message);
      return undefined;
    }
    return { rows: (data ?? []) as Record<string, unknown>[], count: count ?? 0 };
  }
  async function loadRows(source: SeriesSource) {
    try {
      return { rows: await loadAllRows(source) };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }
  return { load, loadRows };
}

function sum(rows: Record<string, unknown>[], column: string) {
  return rows.reduce<number>((s, r) => s + Number(r[column] ?? 0), 0);
}

/** Статусы абонементов в «Заканчивается абонементов» — карточка и график. */
const EXPIRING_STATUSES = ["active", "frozen", "expired"];

async function loadPeriodMetrics(
  studioId: string,
  from: string,
  to: string,
): Promise<Loaded<PeriodMetrics>> {
  const errors: string[] = [];
  const { load, loadRows } = makeLoader(errors);
  const [saleRows, signups, expiring, visits, debtRows, otherSaleRows, refundRows] =
    await Promise.all([
      loadRows(sales(studioId, from, to)),
      load(
        supabase
          .from("clients")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studioId)
          .gte("registration_date", from)
          .lte("registration_date", to),
      ),
      load(
        supabase
          .from("client_memberships")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studioId)
          .in("status", EXPIRING_STATUSES)
          .gte("ends_at", from)
          .lte("ends_at", to),
      ),
      load(
        supabase
          .from("bookings_log")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studioId)
          .eq("status", "attended")
          .gte("starts_at", dayStartISO(from))
          .lt("starts_at", nextDayStartISO(to)),
      ),
      // Задолженность за период — неоплаченные взносы со сроком в диапазоне
      loadRows(unpaidInstallments(studioId, from, to)),
      // Продажи услуг и товаров — отдельная таблица, но выручка общая.
      loadRows(otherSales(studioId, from, to)),
      // Возвраты уменьшают выручку за период.
      loadRows(refunds(studioId, from, to)),
    ]);

  const metrics: Partial<PeriodMetrics> = {
    signups: signups?.count,
    expiring: expiring?.count,
    visits: visits?.count,
    debtPeriod: debtRows && sum(debtRows.rows, "amount"),
  };
  if (saleRows) {
    const revenue = sum(saleRows.rows, "total_amount");
    metrics.avgMembership = saleRows.rows.length ? revenue / saleRows.rows.length : 0;
  }
  if (otherSaleRows) {
    const revenue = sum(otherSaleRows.rows, "total_amount");
    metrics.avgServices = otherSaleRows.rows.length ? revenue / otherSaleRows.rows.length : 0;
  }
  if (saleRows && otherSaleRows) {
    const revenue = sum(saleRows.rows, "total_amount") + sum(otherSaleRows.rows, "total_amount");
    const deals = saleRows.rows.length + otherSaleRows.rows.length;
    metrics.avgTotal = deals ? revenue / deals : 0;
    // Выручка — абонементы плюс услуги и товары, минус возвраты.
    if (refundRows) metrics.revenue = revenue - sum(refundRows.rows, "amount");
  }
  return { metrics, errors };
}

async function loadSnapshotMetrics(studioId: string): Promise<Loaded<SnapshotMetrics>> {
  const errors: string[] = [];
  const { loadRows } = makeLoader(errors);
  const [active, debtRows] = await Promise.all([
    loadRows({
      date: "ends_at",
      page: (lo, hi) =>
        select("client_memberships", "client_id, ends_at", lo)
          .eq("studio_id", studioId)
          .eq("status", "active")
          .order("id")
          .range(lo, hi),
    }),
    // Общая задолженность — все неоплаченные взносы по студии
    loadRows(unpaidInstallments(studioId)),
  ]);

  const today = toISO(new Date());
  const current = active?.rows.filter((m) => !m.ends_at || String(m.ends_at) >= today);
  return {
    metrics: {
      activeClients: current && new Set(current.map((m) => m.client_id)).size,
      debtTotal: debtRows && sum(debtRows.rows, "amount"),
    },
    errors,
  };
}

/** Тост о метриках, которые не удалось посчитать (сами они — «—»). */
function reportErrors(what: string, errors: string[]) {
  if (errors.length) toast.error(`${what}: ${[...new Set(errors)].join("; ")}`);
}

/** Предыдущий период той же длины, вплотную перед выбранным. */
function previousPeriod(from: Date, to: Date) {
  const days = differenceInCalendarDays(to, from) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: toISO(prevFrom), to: toISO(prevTo) };
}

/**
 * Строки одной таблицы для графика: откуда взять дату и сумму. Строк за год
 * бывает больше лимита PostgREST на ответ (1000), поэтому `page` — запрос
 * одной страницы, а `loadSeries` догружает остальные.
 */
type SeriesSource = {
  page: (lo: number, hi: number) => PromiseLike<SupabaseResult>;
  date: string;
  /** timestamptz — дату берём по локальным суткам; иначе колонка date. */
  timestamp?: boolean;
  /** Без суммы точка — просто «одна штука». */
  amount?: string;
  /** Возвраты вычитаются из выручки. */
  sign?: number;
  /** Считается в число продаж (знаменатель среднего чека)? */
  deal?: boolean;
};

type SeriesDef = {
  kind: SeriesKind;
  /** Что именно на графике — подзаголовок окна. */
  description: string;
  /**
   * Показатель смотрит вперёд (окончания абонементов, сроки взносов) — график
   * заканчивается концом выбранного периода. Остальные — не позже сегодня:
   * будущие корзины выручки и посещений всегда пустые.
   */
  future?: boolean;
  sources: (studioId: string, from: string, to: string) => SeriesSource[];
};

const PAGE_SIZE = 1000;

function select(table: string, columns: string, lo: number) {
  return supabase.from(table).select(`id, ${columns}`, lo === 0 ? { count: "exact" } : undefined);
}

function salesSource(table: "sales" | "other_sales") {
  return (studioId: string, from: string, to: string): SeriesSource => ({
    date: "sold_at",
    amount: "total_amount",
    page: (lo, hi) =>
      select(table, "sold_at, total_amount", lo)
        .eq("studio_id", studioId)
        .gte("sold_at", from)
        .lte("sold_at", to)
        .order("sold_at")
        .order("id")
        .range(lo, hi),
  });
}

const sales = salesSource("sales");
const otherSales = salesSource("other_sales");

/** Неоплаченные взносы студии: со сроком в from–to или (без границ) все. */
function unpaidInstallments(studioId: string, from?: string, to?: string): SeriesSource {
  return {
    date: "due_date",
    amount: "amount",
    page: (lo, hi) => {
      let q = select("sale_installments", "due_date, amount, sales!inner(studio_id)", lo)
        .eq("paid", false)
        .eq("sales.studio_id", studioId);
      if (from) q = q.gte("due_date", from);
      if (to) q = q.lte("due_date", to);
      return q.order("due_date").order("id").range(lo, hi);
    },
  };
}

function refunds(studioId: string, from: string, to: string): SeriesSource {
  return {
    date: "refunded_at",
    timestamp: true,
    amount: "amount",
    sign: -1,
    deal: false,
    page: (lo, hi) =>
      select("refunds", "refunded_at, amount", lo)
        .eq("studio_id", studioId)
        .gte("refunded_at", dayStartISO(from))
        .lt("refunded_at", nextDayStartISO(to))
        .order("refunded_at")
        .order("id")
        .range(lo, hi),
  };
}

/** Графики есть у показателей за период; у «сейчас»-показателей истории нет. */
const SERIES: Partial<Record<keyof Metrics, SeriesDef>> = {
  revenue: {
    kind: "sum",
    description: "абонементы, услуги и товары за вычетом возвратов",
    sources: (s, f, t) => [sales(s, f, t), otherSales(s, f, t), refunds(s, f, t)],
  },
  signups: {
    kind: "count",
    description: "клиенты по дате регистрации",
    sources: (studioId, from, to) => [
      {
        date: "registration_date",
        page: (lo, hi) =>
          select("clients", "registration_date", lo)
            .eq("studio_id", studioId)
            .gte("registration_date", from)
            .lte("registration_date", to)
            .order("registration_date")
            .order("id")
            .range(lo, hi),
      },
    ],
  },
  expiring: {
    kind: "count",
    // Прошедшие абонементы уже не active (expire_memberships), поэтому здесь
    // и истёкшие; заменённые новой покупкой и отменённые не считаем.
    description: "абонементы по дате окончания, кроме отменённых и продлённых досрочно",
    future: true,
    sources: (studioId, from, to) => [
      {
        date: "ends_at",
        page: (lo, hi) =>
          select("client_memberships", "ends_at", lo)
            .eq("studio_id", studioId)
            .in("status", EXPIRING_STATUSES)
            .gte("ends_at", from)
            .lte("ends_at", to)
            .order("ends_at")
            .order("id")
            .range(lo, hi),
      },
    ],
  },
  visits: {
    kind: "count",
    description: "отмеченные посещения занятий",
    sources: (studioId, from, to) => [
      {
        date: "starts_at",
        timestamp: true,
        page: (lo, hi) =>
          select("bookings_log", "starts_at", lo)
            .eq("studio_id", studioId)
            .eq("status", "attended")
            .gte("starts_at", dayStartISO(from))
            .lt("starts_at", nextDayStartISO(to))
            .order("starts_at")
            .order("id")
            .range(lo, hi),
      },
    ],
  },
  avgMembership: {
    kind: "avg",
    description: "выручка за абонементы / число продаж",
    sources: (s, f, t) => [sales(s, f, t)],
  },
  avgServices: {
    kind: "avg",
    description: "выручка за услуги и товары / число продаж",
    sources: (s, f, t) => [otherSales(s, f, t)],
  },
  avgTotal: {
    kind: "avg",
    description: "вся выручка / число продаж",
    sources: (s, f, t) => [sales(s, f, t), otherSales(s, f, t)],
  },
  debtPeriod: {
    kind: "sum",
    description: "неоплаченные взносы по сроку оплаты",
    future: true,
    sources: (studioId, from, to) => [unpaidInstallments(studioId, from, to)],
  },
};

/** Все строки источника: первая страница с count, остальные — параллельно. */
async function loadAllRows(source: SeriesSource) {
  const unwrapPage = ({ data, error }: SupabaseResult) => {
    if (error) throw new Error(error.message);
    return (data ?? []) as Record<string, unknown>[];
  };
  const first = await source.page(0, PAGE_SIZE - 1);
  if (first.error?.code && MISSING_TABLE.has(first.error.code)) return [];
  const rows = unwrapPage(first);
  const total = first.count ?? rows.length;
  // Сервер может отдавать меньше PAGE_SIZE (свой max-rows) — шаг по факту.
  const step = rows.length;
  if (!step || step >= total) return rows;
  const pages: PromiseLike<SupabaseResult>[] = [];
  for (let lo = step; lo < total; lo += step) pages.push(source.page(lo, lo + step - 1));
  return rows.concat(...(await Promise.all(pages)).map(unwrapPage));
}

async function loadSeries(def: SeriesDef, studioId: string, from: string, to: string) {
  const sources = def.sources(studioId, from, to);
  const chunks = await Promise.all(
    sources.map(async (source): Promise<SeriesPoint[]> => {
      const rows = await loadAllRows(source);
      return rows.map((r) => ({
        date: source.timestamp
          ? toISO(new Date(String(r[source.date])))
          : String(r[source.date]).slice(0, 10),
        amount: source.amount ? Number(r[source.amount] ?? 0) * (source.sign ?? 1) : 0,
        n: source.deal === false ? 0 : 1,
      }));
    }),
  );
  return chunks.flat();
}

type StatDef = {
  key: keyof Metrics;
  label: string;
  hint?: string;
  format: "money" | "number";
  /** Сравнивать с предыдущим периодом? Для текущих snapshot-метрик (активные клиенты, общая задолженность) — false. */
  compare: boolean;
  /** Рост — это хорошо? Влияет на цвет дельты. */
  goodWhenUp: boolean;
};

const STATS: StatDef[] = [
  {
    key: "revenue",
    label: "Выручка",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "signups",
    label: "Новые регистрации",
    hint: "за период",
    format: "number",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "activeClients",
    label: "Активные клиенты",
    hint: "сейчас",
    format: "number",
    compare: false,
    goodWhenUp: true,
  },
  {
    key: "expiring",
    label: "Заканчивается абонементов",
    hint: "в этом периоде",
    format: "number",
    compare: true,
    goodWhenUp: false,
  },
  {
    key: "visits",
    label: "Посещений",
    hint: "за период",
    format: "number",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "avgMembership",
    label: "Средний чек за абонементы",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "avgServices",
    label: "Средний чек за услуги",
    hint: "за период",
    format: "money",
    compare: false,
    goodWhenUp: true,
  },
  {
    key: "avgTotal",
    label: "Средний чек общий",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "debtPeriod",
    label: "Задолженность за период",
    hint: "неоплаченные взносы",
    format: "money",
    compare: true,
    goodWhenUp: false,
  },
  {
    key: "debtTotal",
    label: "Общая задолженность",
    hint: "всего",
    format: "money",
    compare: false,
    goodWhenUp: false,
  },
];

function Delta({
  current,
  previous,
  goodWhenUp,
  isMoney,
}: {
  current: number;
  previous: number;
  goodWhenUp: boolean;
  isMoney: boolean;
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
  const diffText = isMoney ? formatMoney(Math.abs(diff)) : formatNumber(Math.abs(diff));
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1 text-xs", color)}>
      <Icon className="h-3 w-3" />
      {pct === null ? diffText : `${up ? "+" : "−"}${Math.abs(pct).toFixed(0)}% · ${diffText}`}
      <span className="text-muted-foreground max-sm:hidden">vs пред. период</span>
    </span>
  );
}

/**
 * Дашборд — раздел рейки над студиями: показатели всех студий сотрудника
 * одна за другой (название, свой период, карточки). Студия попадает сюда,
 * только если у сотрудника есть в ней роль и открыт раздел «Дашборд»
 * («Доступы»); данные всё равно ограничивает RLS по студии.
 */
function DashboardPage() {
  const access = useAdminAccess();
  const { data: studios, isLoading } = useStudios();

  const allowed = access ? new Set(dashboardStudioIds(access)) : null;
  const list = allowed ? (studios ?? []).filter((s) => allowed.has(s.id)) : [];

  return (
    <AdminShell title="Дашборд">
      {isLoading || !access ? (
        <DashboardStudioSkeleton />
      ) : list.length === 0 ? (
        <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
          Нет клубов, где вам открыт дашборд.
        </div>
      ) : (
        <div className="space-y-8">
          {list.map((studio) => (
            <StudioDashboard key={studio.id} studio={studio} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

/** Дашборд одной студии: свой период — у каждой студии отдельно. */
function StudioDashboard({ studio }: { studio: Studio }) {
  const studioId = studio.id;
  const today = useMemo(() => new Date(), []);
  const [range, setRange] = useState<DateRange | undefined>({
    from: startOfMonth(today),
    to: endOfMonth(today),
  });
  const fromDate = range?.from;
  const toDate = range?.to ?? range?.from;
  const period = fromDate && toDate ? { from: toISO(fromDate), to: toISO(toDate) } : null;
  const prev = fromDate && toDate ? previousPeriod(fromDate, toDate) : null;

  // Выбранный и предыдущий периоды меняются вместе (по выбору дат) — один
  // запрос; ответ на уже неактуальный период React Query отбросит сам.
  const periodQuery = useQuery({
    queryKey: ["dashboard", studioId, period?.from, period?.to],
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        loadPeriodMetrics(studioId, period!.from, period!.to),
        loadPeriodMetrics(studioId, prev!.from, prev!.to),
      ]);
      reportErrors(`${studio.name}: часть показателей за период не загрузилась`, [
        ...current.errors,
        ...previous.errors,
      ]);
      return { current: current.metrics, previous: previous.metrics };
    },
    enabled: !!period,
    meta: { errorMessage: `${studio.name}: не удалось загрузить показатели за период` },
  });

  // Метрики «на сейчас» от периода не зависят: грузим их один раз, а не для
  // каждого из двух периодов при каждой смене дат.
  const snapshotQuery = useQuery({
    queryKey: ["dashboard", studioId, "snapshot"],
    queryFn: async () => {
      const { metrics, errors } = await loadSnapshotMetrics(studioId);
      reportErrors(`${studio.name}: часть текущих показателей не загрузилась`, errors);
      return metrics;
    },
    meta: { errorMessage: `${studio.name}: не удалось загрузить текущие показатели` },
  });

  const loading = periodQuery.isLoading || snapshotQuery.isLoading;
  const fetching = periodQuery.isFetching || snapshotQuery.isFetching;
  // Нет данных (ошибка загрузки, период не выбран) — в карточке «—», а не 0.
  const current: Partial<Metrics> = { ...periodQuery.data?.current, ...snapshotQuery.data };
  const previous: Partial<Metrics> = periodQuery.data?.previous ?? {};
  const headingId = `dashboard-${studioId}`;

  // Показатель держим и после закрытия: иначе окно пустеет, пока гаснет.
  const [chartStat, setChartStat] = useState<StatDef | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const openChart = (stat: StatDef) => {
    setChartStat(stat);
    setChartOpen(true);
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      {/* Точка — основной цвет студии, как в переключателе студий. */}
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
        <Button
          variant="ghost"
          onClick={() => setRange({ from: startOfMonth(today), to: endOfMonth(today) })}
        >
          Текущий месяц
        </Button>
        {fetching && (
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            обновляем…
          </div>
        )}
      </TableToolbar>

      {loading ? (
        <DashboardStatsSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {STATS.map((stat) => {
            const v = current[stat.key];
            const p = previous[stat.key];
            const value =
              v === undefined ? "—" : stat.format === "money" ? formatMoney(v) : formatNumber(v);
            const chartable = !!SERIES[stat.key];
            // Карточка с графиком — кнопка: стрелка в углу, по нажатию окно.
            const Card = chartable ? "button" : "div";
            return (
              // На телефоне — две карточки в ряд: по одной в столбик
              // одиннадцать показателей растягивались на пять экранов.
              <Card
                key={stat.key}
                {...(chartable && { type: "button", onClick: () => openChart(stat) })}
                className={cn(
                  // flex-col: кнопка иначе центрирует содержимое по высоте ряда.
                  "flex min-w-0 flex-col rounded-lg border bg-background p-3 text-left sm:p-4",
                  chartable &&
                    "group relative cursor-pointer transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {chartable && (
                  <ArrowUpRight
                    aria-hidden
                    className="absolute right-2.5 top-2.5 size-4 text-muted-foreground transition-[color,transform] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground sm:right-3 sm:top-3"
                  />
                )}
                {/* Внутри кнопки — только span: div в button — невалидная разметка. */}
                <span
                  className={cn(
                    "block text-xs font-medium text-muted-foreground sm:text-sm",
                    chartable && "pr-5",
                  )}
                >
                  {stat.label}
                  {chartable && <span className="sr-only"> — открыть график</span>}
                </span>
                <span className="mt-1.5 block text-lg font-semibold tabular-nums sm:mt-2 sm:text-2xl">
                  {value}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  {stat.hint && <span className="text-xs text-muted-foreground">{stat.hint}</span>}
                </span>
                {stat.compare && v !== undefined && p !== undefined && (
                  <span className="mt-2 block">
                    <Delta
                      current={v}
                      previous={p}
                      goodWhenUp={stat.goodWhenUp}
                      isMoney={stat.format === "money"}
                    />
                  </span>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={chartOpen} onOpenChange={setChartOpen}>
        <DialogContent className="sm:max-w-5xl">
          {chartStat && SERIES[chartStat.key] && (
            <MetricChart
              key={chartStat.key}
              studio={studio}
              stat={chartStat}
              def={SERIES[chartStat.key]!}
              periodEnd={toDate ?? today}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
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
      const points = await loadSeries(def, studio.id, from, to);
      return aggregate(granularity, buckets, points, def.kind);
    },
    // Пока грузится другая разбивка — прежний график, а не пустое место.
    placeholderData: keepPreviousData,
    meta: { errorMessage: `${studio.name}: не удалось загрузить график «${stat.label}»` },
  });

  const values = query.data;
  const g = GRANULARITIES.find((x) => x.value === granularity)!;
  const fmt = (n: number) => (stat.format === "money" ? formatMoney(n) : formatNumber(n));
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
