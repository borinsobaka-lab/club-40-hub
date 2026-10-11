import { addDays, differenceInCalendarDays, format } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { SeriesKind, SeriesPoint } from "@/lib/dashboard-series";
import type { OtherSaleRecord, RefundRecord, SaleRecord } from "@/lib/dashboard-analytics";

/**
 * Загрузка данных дашборда из Supabase: показатели «Общих показателей»,
 * история продаж («Продажи», «Клиенты», графики), посещения, клиенты.
 * Расчёты над строками — lib/dashboard-analytics.ts и lib/dashboard-series.ts.
 */

export function toISO(d: Date) {
  return format(d, "yyyy-MM-dd");
}

// Границы локальных суток как моменты времени для timestamptz-колонок.
// Строку без смещения ("YYYY-MM-DDT00:00:00") сервер читает в своём поясе
// (UTC), и окно периода съезжало на 4 часа относительно суток студии.
export function dayStartISO(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}

export function nextDayStartISO(date: string) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Локальная дата yyyy-MM-dd момента timestamptz. */
export function localDate(ts: string) {
  return toISO(new Date(ts));
}

export type Period = { from: string; to: string };

/** Предыдущий период той же длины, вплотную перед выбранным. */
export function previousPeriod(period: Period): Period {
  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T00:00:00`);
  const days = differenceInCalendarDays(to, from) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: toISO(prevFrom), to: toISO(prevTo) };
}

/** Показатели «Общих показателей» за период — для выбранного и предыдущего периода. */
export type PeriodMetrics = {
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
export type SnapshotMetrics = {
  activeClients: number;
  debtTotal: number;
};

export type OverviewMetrics = PeriodMetrics & SnapshotMetrics;

/** Метрика, которую не удалось посчитать, — undefined: в карточке «—», а не 0. */
type Loaded<T> = { metrics: Partial<T>; errors: string[] };

type SupabaseResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

type Row = Record<string, unknown>;

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
    return { rows: (data ?? []) as Row[], count: count ?? 0 };
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

function sum(rows: Row[], column: string) {
  return rows.reduce<number>((s, r) => s + Number(r[column] ?? 0), 0);
}

/** Статусы абонементов в «Заканчивается абонементов» — карточка и график. */
const EXPIRING_STATUSES = ["active", "frozen", "expired"];

export async function loadPeriodMetrics(
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

export async function loadSnapshotMetrics(studioId: string): Promise<Loaded<SnapshotMetrics>> {
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
export function reportErrors(what: string, errors: string[]) {
  if (errors.length) toast.error(`${what}: ${[...new Set(errors)].join("; ")}`);
}

/**
 * Строки одной таблицы: откуда взять дату и сумму. Строк бывает больше
 * лимита PostgREST на ответ (1000), поэтому `page` — запрос одной страницы,
 * а `loadAllRows` догружает остальные.
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

/** График показателя в окне карточки: как получить точки за отрезок дат. */
export type SeriesDef = {
  kind: SeriesKind;
  /** Что именно на графике — подзаголовок окна. */
  description: string;
  /**
   * Показатель смотрит вперёд (окончания абонементов, сроки взносов) — график
   * заканчивается концом выбранного периода. Остальные — не позже сегодня:
   * будущие корзины выручки и посещений всегда пустые.
   */
  future?: boolean;
  load: (studioId: string, from: string, to: string) => Promise<SeriesPoint[]>;
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

function attendedVisits(studioId: string, from: string, to: string, columns = "starts_at") {
  return {
    date: "starts_at",
    timestamp: true,
    page: (lo: number, hi: number) =>
      select("bookings_log", columns, lo)
        .eq("studio_id", studioId)
        .eq("status", "attended")
        .gte("starts_at", dayStartISO(from))
        .lt("starts_at", nextDayStartISO(to))
        .order("starts_at")
        .order("id")
        .range(lo, hi),
  } satisfies SeriesSource;
}

/** Все строки источника: первая страница с count, остальные — параллельно. */
async function loadAllRows(source: Pick<SeriesSource, "page">) {
  const unwrapPage = ({ data, error }: SupabaseResult) => {
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
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

/** Точки графика из таблиц: дата, сумма (со знаком) и вклад в число продаж. */
function sourcesSeries(
  sources: (studioId: string, from: string, to: string) => SeriesSource[],
): SeriesDef["load"] {
  return async (studioId, from, to) => {
    const chunks = await Promise.all(
      sources(studioId, from, to).map(async (source): Promise<SeriesPoint[]> => {
        const rows = await loadAllRows(source);
        return rows.map((r) => ({
          date: source.timestamp
            ? localDate(String(r[source.date]))
            : String(r[source.date]).slice(0, 10),
          amount: source.amount ? Number(r[source.amount] ?? 0) * (source.sign ?? 1) : 0,
          n: source.deal === false ? 0 : 1,
        }));
      }),
    );
    return chunks.flat();
  };
}

/** Графики есть у показателей за период; у «сейчас»-показателей истории нет. */
export const OVERVIEW_SERIES: Partial<Record<keyof OverviewMetrics, SeriesDef>> = {
  revenue: {
    kind: "sum",
    description: "абонементы, услуги и товары за вычетом возвратов",
    load: sourcesSeries((s, f, t) => [sales(s, f, t), otherSales(s, f, t), refunds(s, f, t)]),
  },
  signups: {
    kind: "count",
    description: "клиенты по дате регистрации",
    load: sourcesSeries((studioId, from, to) => [
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
    ]),
  },
  expiring: {
    kind: "count",
    // Прошедшие абонементы уже не active (expire_memberships), поэтому здесь
    // и истёкшие; заменённые новой покупкой и отменённые не считаем.
    description: "абонементы по дате окончания, кроме отменённых и продлённых досрочно",
    future: true,
    load: sourcesSeries((studioId, from, to) => [
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
    ]),
  },
  visits: {
    kind: "count",
    description: "отмеченные посещения занятий",
    load: sourcesSeries((studioId, from, to) => [attendedVisits(studioId, from, to)]),
  },
  avgMembership: {
    kind: "avg",
    description: "выручка за абонементы / число продаж",
    load: sourcesSeries((s, f, t) => [sales(s, f, t)]),
  },
  avgServices: {
    kind: "avg",
    description: "выручка за услуги и товары / число продаж",
    load: sourcesSeries((s, f, t) => [otherSales(s, f, t)]),
  },
  avgTotal: {
    kind: "avg",
    description: "вся выручка / число продаж",
    load: sourcesSeries((s, f, t) => [sales(s, f, t), otherSales(s, f, t)]),
  },
  debtPeriod: {
    kind: "sum",
    description: "неоплаченные взносы по сроку оплаты",
    future: true,
    load: sourcesSeries((studioId, from, to) => [unpaidInstallments(studioId, from, to)]),
  },
};

// ---------------------------------------------------------------------------
// История продаж — «Продажи», «Клиенты» (LTV), продления и возвраты

export type SalesHistory = {
  sales: SaleRecord[];
  otherSales: OtherSaleRecord[];
  refunds: RefundRecord[];
};

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/**
 * Все продажи студии за всё время: продления и возвраты смотрят на прошлые
 * покупки клиента, LTV от периода не зависит. Расчёты по периоду дальше идут
 * по этим строкам в браузере — смена периода не ходит в базу.
 */
export async function loadSalesHistory(studioId: string): Promise<SalesHistory> {
  const [saleRows, otherRows, refundRows] = await Promise.all([
    loadAllRows({
      page: (lo, hi) =>
        select(
          "sales",
          "client_id, sold_at, created_at, total_amount, payment_method, seller_id, admin_name, " +
            "memberships(name, kind), client_memberships(ends_at, status), " +
            "sale_installments(amount, paid, paid_at, due_date, payment_method)",
          lo,
        )
          .eq("studio_id", studioId)
          .order("sold_at")
          .order("id")
          .range(lo, hi),
    }),
    loadAllRows({
      page: (lo, hi) =>
        select("other_sales", "client_id, sold_at, total_amount, payment_method, item_name", lo)
          .eq("studio_id", studioId)
          .order("sold_at")
          .order("id")
          .range(lo, hi),
    }),
    loadAllRows({
      page: (lo, hi) =>
        select("refunds", "refunded_at, amount, sale_id, other_sale_id", lo)
          .eq("studio_id", studioId)
          .order("refunded_at")
          .order("id")
          .range(lo, hi),
    }),
  ]);

  return {
    sales: saleRows.map((r) => {
      const membership = one(r.memberships as { name: string; kind: string } | null);
      const term = one(r.client_memberships as { ends_at: string | null; status: string }[]);
      const installments = (r.sale_installments ?? []) as {
        amount: number;
        paid: boolean;
        paid_at: string | null;
        due_date: string;
        payment_method: string | null;
      }[];
      const sellerName = (r.admin_name as string | null) || null;
      return {
        id: String(r.id),
        clientId: String(r.client_id),
        soldAt: String(r.sold_at),
        createdAt: String(r.created_at ?? ""),
        totalAmount: Number(r.total_amount ?? 0),
        membershipName: membership?.name ?? "Без названия",
        trial: membership?.kind === "trial",
        method: (r.payment_method as string | null) ?? null,
        sellerKey: (r.seller_id as string | null) ?? sellerName,
        sellerName,
        endsAt: term?.ends_at ?? null,
        cancelled: term?.status === "cancelled",
        noMembership: !term,
        installments: installments.map((i) => ({
          amount: Number(i.amount ?? 0),
          paid: !!i.paid,
          date: i.paid_at ?? i.due_date,
          method: i.payment_method,
        })),
      };
    }),
    otherSales: otherRows.map((r) => ({
      id: String(r.id),
      clientId: (r.client_id as string | null) ?? null,
      soldAt: String(r.sold_at),
      totalAmount: Number(r.total_amount ?? 0),
      itemName: String(r.item_name ?? "Без названия"),
      method: (r.payment_method as string | null) ?? null,
    })),
    refunds: refundRows.map((r) => ({
      date: localDate(String(r.refunded_at)),
      amount: Number(r.amount ?? 0),
      saleId: (r.sale_id as string | null) ?? null,
      otherSaleId: (r.other_sale_id as string | null) ?? null,
    })),
  };
}

/** Посещения за период по дням (отмеченные занятия). */
export async function loadVisitDates(studioId: string, from: string, to: string) {
  const rows = await loadAllRows(attendedVisits(studioId, from, to));
  return rows.map((r) => localDate(String(r.starts_at)));
}

// ---------------------------------------------------------------------------
// «Клиенты»

export type ClientRow = {
  id: string;
  userId: string | null;
  name: string;
  birthday: string | null;
};

export type VisitRow = { clientId: string | null; userId: string | null; name: string };

export type ClientsData = {
  clients: ClientRow[];
  /** Члены клуба (ЧК): есть действующий абонемент, в том числе замороженный. */
  memberIds: Set<string>;
};

export async function loadClientsData(studioId: string): Promise<ClientsData> {
  const [clientRows, termRows] = await Promise.all([
    loadAllRows({
      page: (lo, hi) =>
        select("clients", "user_id, first_name, last_name, full_name, birthday", lo)
          .eq("studio_id", studioId)
          .order("id")
          .range(lo, hi),
    }),
    loadAllRows({
      page: (lo, hi) =>
        select("client_memberships", "client_id, status, ends_at", lo)
          .eq("studio_id", studioId)
          .in("status", ["active", "frozen"])
          .order("id")
          .range(lo, hi),
    }),
  ]);
  // Та же логика, что у статуса ЧК (lib/client-status.ts, clients_with_status).
  const today = toISO(new Date());
  const memberIds = new Set(
    termRows
      .filter((m) => m.status === "frozen" || !m.ends_at || String(m.ends_at) >= today)
      .map((m) => String(m.client_id)),
  );
  return {
    clients: clientRows.map((r) => ({
      id: String(r.id),
      userId: (r.user_id as string | null) ?? null,
      name:
        [r.last_name, r.first_name].filter(Boolean).join(" ").trim() || String(r.full_name ?? "—"),
      birthday: (r.birthday as string | null) ?? null,
    })),
    memberIds,
  };
}

/** Отмеченные посещения за период: кто ходил (карточка, учётная запись, имя из журнала). */
export async function loadVisits(studioId: string, from: string, to: string): Promise<VisitRow[]> {
  const rows = await loadAllRows(
    attendedVisits(
      studioId,
      from,
      to,
      "starts_at, client_id, user_id, client_first_name, client_last_name, client_full_name",
    ),
  );
  return rows.map((r) => ({
    clientId: (r.client_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    name:
      [r.client_last_name, r.client_first_name].filter(Boolean).join(" ").trim() ||
      String(r.client_full_name ?? "—"),
  }));
}
