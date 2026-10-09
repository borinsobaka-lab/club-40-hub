import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, differenceInCalendarDays, addDays } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, ArrowUp, ArrowDown, Minus, Loader2 } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useRefreshSignal } from "@/lib/refresh-bus";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatNumber } from "@/lib/format";

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

type Metrics = {
  revenue: number;
  signups: number;
  activeClients: number;
  expiring: number;
  visits: number;
  avgMembership: number;
  avgServices: number;
  avgTotal: number;
  debtPeriod: number;
  debtTotal: number;
};

const ZERO: Metrics = {
  revenue: 0,
  signups: 0,
  activeClients: 0,
  expiring: 0,
  visits: 0,
  avgMembership: 0,
  avgServices: 0,
  avgTotal: 0,
  debtPeriod: 0,
  debtTotal: 0,
};

async function loadMetrics(studioId: string, from: string, to: string): Promise<Metrics> {
  // Запускаем все запросы параллельно.
  const [
    salesRes,
    signupsRes,
    activeRes,
    expiringRes,
    visitsRes,
    debtPeriodRes,
    debtTotalRes,
    otherSalesRes,
    refundsRes,
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("total_amount, sold_at")
      .eq("studio_id", studioId)
      .gte("sold_at", from)
      .lte("sold_at", to),
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)
      .gte("registration_date", from)
      .lte("registration_date", to),
    supabase
      .from("client_memberships")
      .select("client_id, ends_at, status")
      .eq("studio_id", studioId)
      .eq("status", "active"),
    supabase
      .from("client_memberships")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)
      .eq("status", "active")
      .gte("ends_at", from)
      .lte("ends_at", to),
    supabase
      .from("bookings_log")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studioId)
      .eq("status", "attended")
      .gte("starts_at", dayStartISO(from))
      .lt("starts_at", nextDayStartISO(to)),
    // Задолженность за период — неоплаченные взносы со сроком в диапазоне
    supabase
      .from("sale_installments")
      .select("amount, sales!inner(studio_id)")
      .eq("paid", false)
      .eq("sales.studio_id", studioId)
      .gte("due_date", from)
      .lte("due_date", to),
    // Общая задолженность — все неоплаченные взносы по студии
    supabase
      .from("sale_installments")
      .select("amount, sales!inner(studio_id)")
      .eq("paid", false)
      .eq("sales.studio_id", studioId),
    // Продажи услуг и товаров — отдельная таблица, но выручка общая.
    supabase
      .from("other_sales")
      .select("total_amount")
      .eq("studio_id", studioId)
      .gte("sold_at", from)
      .lte("sold_at", to),
    // Возвраты уменьшают выручку за период.
    supabase
      .from("refunds")
      .select("amount")
      .eq("studio_id", studioId)
      .gte("refunded_at", dayStartISO(from))
      .lt("refunded_at", nextDayStartISO(to)),
  ]);

  const sales = (salesRes.data ?? []) as { total_amount: number }[];
  const membershipRevenue = sales.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const avgMembership = sales.length ? membershipRevenue / sales.length : 0;

  const otherSales = (otherSalesRes.data ?? []) as { total_amount: number }[];
  const servicesRevenue = otherSales.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const avgServices = otherSales.length ? servicesRevenue / otherSales.length : 0;

  const refunded = ((refundsRes.data ?? []) as { amount: number }[]).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0,
  );

  // Выручка — абонементы плюс услуги и товары, минус возвраты.
  const revenue = membershipRevenue + servicesRevenue - refunded;
  const dealsCount = sales.length + otherSales.length;
  const avgTotal = dealsCount ? (membershipRevenue + servicesRevenue) / dealsCount : 0;

  const active = (activeRes.data ?? []) as { client_id: string; ends_at: string | null }[];
  const today = toISO(new Date());
  const activeClients = new Set(
    active.filter((m) => !m.ends_at || m.ends_at >= today).map((m) => m.client_id),
  ).size;

  const debtPeriodRows = (debtPeriodRes.data ?? []) as { amount: number }[];
  const debtTotalRows = (debtTotalRes.data ?? []) as { amount: number }[];

  return {
    revenue,
    signups: signupsRes.count ?? 0,
    activeClients,
    expiring: expiringRes.count ?? 0,
    visits: visitsRes.count ?? 0,
    avgMembership,
    avgServices,
    avgTotal,
    debtPeriod: debtPeriodRows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    debtTotal: debtTotalRows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
  };
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
    <span className={cn("inline-flex items-center gap-1 text-xs", color)}>
      <Icon className="h-3 w-3" />
      {pct === null ? diffText : `${up ? "+" : "−"}${Math.abs(pct).toFixed(0)}% · ${diffText}`}
      <span className="text-muted-foreground">vs пред. период</span>
    </span>
  );
}

function DashboardPage() {
  const studioId = useActiveStudioId();
  const refreshSignal = useRefreshSignal();
  const today = useMemo(() => new Date(), []);
  const [range, setRange] = useState<DateRange | undefined>({
    from: startOfMonth(today),
    to: endOfMonth(today),
  });
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Metrics>(ZERO);
  const [previous, setPrevious] = useState<Metrics>(ZERO);
  const [loading, setLoading] = useState(false);

  const from = range?.from ?? null;
  const to = range?.to ?? range?.from ?? null;

  useEffect(() => {
    if (!studioId || !from || !to) {
      setCurrent(ZERO);
      setPrevious(ZERO);
      return;
    }
    const fromISO = toISO(from);
    const toISOStr = toISO(to);
    const days = differenceInCalendarDays(to, from) + 1;
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));

    setLoading(true);
    Promise.all([
      loadMetrics(studioId, fromISO, toISOStr),
      loadMetrics(studioId, toISO(prevFrom), toISO(prevTo)),
    ])
      .then(([cur, prev]) => {
        setCurrent(cur);
        setPrevious(prev);
      })
      .finally(() => setLoading(false));
  }, [studioId, from?.getTime(), to?.getTime(), refreshSignal]);

  return (
    <AdminShell title="Дашборд" description="Сводная статистика по студии">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "min-w-[260px] justify-start text-left font-normal",
                  !range?.from && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {formatRange(range)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
              <Calendar
                mode="range"
                numberOfMonths={2}
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
            size="sm"
            onClick={() => setRange({ from: startOfMonth(today), to: endOfMonth(today) })}
          >
            Текущий месяц
          </Button>
          {loading && (
            <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              обновляем…
            </div>
          )}
        </div>

        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {STATS.map((stat) => (
              <Card key={stat.key}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="mt-2 h-3 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {STATS.map((stat) => {
              const v = current[stat.key];
              const p = previous[stat.key];
              const value = stat.format === "money" ? formatMoney(v) : formatNumber(v);
              return (
                <Card key={stat.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {stat.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold tabular-nums">{value}</div>
                    <div className="mt-1 flex items-center gap-2">
                      {stat.hint && (
                        <span className="text-xs text-muted-foreground">{stat.hint}</span>
                      )}
                    </div>
                    {stat.compare && (
                      <div className="mt-2">
                        <Delta
                          current={v}
                          previous={p}
                          goodWhenUp={stat.goodWhenUp}
                          isMoney={stat.format === "money"}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
