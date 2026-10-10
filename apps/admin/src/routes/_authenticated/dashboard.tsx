import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, differenceInCalendarDays, addDays } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, ArrowUp, ArrowDown, Minus, Loader2 } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { TableToolbar } from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useStudios, type Studio } from "@/hooks/use-studios";
import { useIsMobile } from "@/hooks/use-mobile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatNumber } from "@/lib/format";
import { dashboardStudioIds } from "@/lib/admin-access";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Дашборд — Base40 Admin" }] }),
  component: DashboardPage,
});

function formatRange(range: DateRange | undefined) {
  if (!range?.from) return "Выберите период";
  const from = format(range.from, "d MMM yyyy", { locale: ru });
  const to = range.to ? format(range.to, "d MMM yyyy", { locale: ru }) : from;
  return `${from} — ${to}`;
}

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
 */
function makeLoader(errors: string[]) {
  return async function load(query: PromiseLike<SupabaseResult>) {
    const { data, error, count } = await query;
    if (error) {
      if (error.code && MISSING_TABLE.has(error.code)) return { rows: [], count: 0 };
      errors.push(error.message);
      return undefined;
    }
    return { rows: (data ?? []) as Record<string, unknown>[], count: count ?? 0 };
  };
}

function sum(rows: Record<string, unknown>[], column: string) {
  return rows.reduce<number>((s, r) => s + Number(r[column] ?? 0), 0);
}

async function loadPeriodMetrics(
  studioId: string,
  from: string,
  to: string,
): Promise<Loaded<PeriodMetrics>> {
  const errors: string[] = [];
  const load = makeLoader(errors);
  const [sales, signups, expiring, visits, debtRows, otherSales, refunds] = await Promise.all([
    load(
      supabase
        .from("sales")
        .select("total_amount, sold_at")
        .eq("studio_id", studioId)
        .gte("sold_at", from)
        .lte("sold_at", to),
    ),
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
        .eq("status", "active")
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
    load(
      supabase
        .from("sale_installments")
        .select("amount, sales!inner(studio_id)")
        .eq("paid", false)
        .eq("sales.studio_id", studioId)
        .gte("due_date", from)
        .lte("due_date", to),
    ),
    // Продажи услуг и товаров — отдельная таблица, но выручка общая.
    load(
      supabase
        .from("other_sales")
        .select("total_amount")
        .eq("studio_id", studioId)
        .gte("sold_at", from)
        .lte("sold_at", to),
    ),
    // Возвраты уменьшают выручку за период.
    load(
      supabase
        .from("refunds")
        .select("amount")
        .eq("studio_id", studioId)
        .gte("refunded_at", dayStartISO(from))
        .lt("refunded_at", nextDayStartISO(to)),
    ),
  ]);

  const metrics: Partial<PeriodMetrics> = {
    signups: signups?.count,
    expiring: expiring?.count,
    visits: visits?.count,
    debtPeriod: debtRows && sum(debtRows.rows, "amount"),
  };
  if (sales) {
    const revenue = sum(sales.rows, "total_amount");
    metrics.avgMembership = sales.rows.length ? revenue / sales.rows.length : 0;
  }
  if (otherSales) {
    const revenue = sum(otherSales.rows, "total_amount");
    metrics.avgServices = otherSales.rows.length ? revenue / otherSales.rows.length : 0;
  }
  if (sales && otherSales) {
    const revenue = sum(sales.rows, "total_amount") + sum(otherSales.rows, "total_amount");
    const deals = sales.rows.length + otherSales.rows.length;
    metrics.avgTotal = deals ? revenue / deals : 0;
    // Выручка — абонементы плюс услуги и товары, минус возвраты.
    if (refunds) metrics.revenue = revenue - sum(refunds.rows, "amount");
  }
  return { metrics, errors };
}

async function loadSnapshotMetrics(studioId: string): Promise<Loaded<SnapshotMetrics>> {
  const errors: string[] = [];
  const load = makeLoader(errors);
  const [active, debtRows] = await Promise.all([
    load(
      supabase
        .from("client_memberships")
        .select("client_id, ends_at, status")
        .eq("studio_id", studioId)
        .eq("status", "active"),
    ),
    // Общая задолженность — все неоплаченные взносы по студии
    load(
      supabase
        .from("sale_installments")
        .select("amount, sales!inner(studio_id)")
        .eq("paid", false)
        .eq("sales.studio_id", studioId),
    ),
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
        <div className="space-y-3">
          <Skeleton className="h-7 w-48" />
          <StatsSkeleton />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
          Нет студий, где вам открыт дашборд.
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

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {STATS.map((stat) => (
        <div key={stat.key} className="rounded-lg border bg-background p-3 sm:p-4">
          <Skeleton className="h-4 w-full max-w-32" />
          <Skeleton className="mt-3 h-7 w-24" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
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
  const [open, setOpen] = useState(false);
  // Два месяца рядом не помещаются в экран телефона.
  const isMobile = useIsMobile();

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
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "toolbar-full min-w-[260px] justify-start text-left font-normal",
                !range?.from && "text-muted-foreground",
              )}
            >
              <CalendarIcon />
              {formatRange(range)}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
            <Calendar
              mode="range"
              numberOfMonths={isMobile ? 1 : 2}
              selected={range}
              onSelect={setRange}
              defaultMonth={range?.from ?? today}
              initialFocus
              locale={ru}
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
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
        <StatsSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {STATS.map((stat) => {
            const v = current[stat.key];
            const p = previous[stat.key];
            const value =
              v === undefined ? "—" : stat.format === "money" ? formatMoney(v) : formatNumber(v);
            return (
              // На телефоне — две карточки в ряд: по одной в столбик
              // одиннадцать показателей растягивались на пять экранов.
              <div key={stat.key} className="min-w-0 rounded-lg border bg-background p-3 sm:p-4">
                <div className="text-xs font-medium text-muted-foreground sm:text-sm">
                  {stat.label}
                </div>
                <div className="mt-1.5 text-lg font-semibold tabular-nums sm:mt-2 sm:text-2xl">
                  {value}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {stat.hint && <span className="text-xs text-muted-foreground">{stat.hint}</span>}
                </div>
                {stat.compare && v !== undefined && p !== undefined && (
                  <div className="mt-2">
                    <Delta
                      current={v}
                      previous={p}
                      goodWhenUp={stat.goodWhenUp}
                      isMoney={stat.format === "money"}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
