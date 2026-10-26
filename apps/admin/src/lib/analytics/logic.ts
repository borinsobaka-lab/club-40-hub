/**
 * «Аналитика» — расчёты без React и Supabase (тест — logic.test.ts): клубы
 * по городам, недели месяца, прогноз, точка 0, сравнения периодов, сводки
 * продаж, занятий и пробных, рейтинг клубов. Правила — как у прежнего
 * портала Lady Stretch (ANALYTICS.md): итоговые доли считаются из итоговых
 * числителя и знаменателя, а не средним по строкам; нет знаменателя — null
 * («—»), а не ноль.
 */
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getDaysInMonth,
  isLastDayOfMonth,
  parseISO,
  startOfMonth,
} from "date-fns";
import { ru } from "date-fns/locale";

import type {
  AnStudio,
  ClassRow,
  Period,
  RevenueRow,
  SaleOrigin,
  SalesData,
  TrialRow,
  ZeroRow,
} from "./types";

export const NO_CITY = "Без города";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

// ---------------------------------------------------------------------------
// Клубы и города

/** Клуб закрыт к этому дню (closed_on — первый день закрытия). */
export function isClosed(studio: Pick<AnStudio, "closedOn">, today: string): boolean {
  return !!studio.closedOn && studio.closedOn <= today;
}

export type StatusFilter = "all" | "open" | "closed";

export type StudioFilter = {
  brandId: string | null;
  city: string | null;
  clubId: string | null;
  status: StatusFilter;
};

export const cityOf = (s: Pick<AnStudio, "city">) => s.city?.trim() || NO_CITY;

/** Клубы под фильтрами страницы. */
export function filterStudios(studios: AnStudio[], f: StudioFilter, today: string): AnStudio[] {
  return studios.filter(
    (s) =>
      (!f.brandId || s.brandId === f.brandId) &&
      (!f.city || cityOf(s) === f.city) &&
      (!f.clubId || s.id === f.clubId) &&
      (f.status === "all" || (f.status === "closed") === isClosed(s, today)),
  );
}

export type CityGroup = { city: string; open: boolean; studios: AnStudio[] };

const byName = (a: string, b: string) => a.localeCompare(b, "ru");

/**
 * Клубы по городам. Порядок — как в отчётах Lady Stretch: сначала города,
 * где есть открытые клубы, по алфавиту, затем города только с закрытыми;
 * внутри — открытые клубы по алфавиту, затем закрытые. «Без города» — в
 * конце своей части.
 */
export function groupByCity(studios: AnStudio[], today: string): CityGroup[] {
  const map = new Map<string, AnStudio[]>();
  for (const s of studios) {
    const list = map.get(cityOf(s)) ?? [];
    list.push(s);
    map.set(cityOf(s), list);
  }
  const groups = [...map.entries()].map(([city, list]) => ({
    city,
    open: list.some((s) => !isClosed(s, today)),
    studios: [...list].sort(
      (a, b) => Number(isClosed(a, today)) - Number(isClosed(b, today)) || byName(a.name, b.name),
    ),
  }));
  return groups.sort(
    (a, b) =>
      Number(!a.open) - Number(!b.open) ||
      Number(a.city === NO_CITY) - Number(b.city === NO_CITY) ||
      byName(a.city, b.city),
  );
}

/** Города клубов (для фильтра) — в том же порядке, что в отчётах. */
export function cityNames(studios: AnStudio[], today: string): string[] {
  return groupByCity(studios, today).map((g) => g.city);
}

// ---------------------------------------------------------------------------
// Периоды

export function monthPeriod(anyDay: string): Period {
  const d = parseISO(anyDay);
  return { from: iso(startOfMonth(d)), to: iso(endOfMonth(d)) };
}

/**
 * Тот же период на `months` месяцев раньше (-1 — прошлый месяц, -12 —
 * прошлый год): те же числа, день ограничен длиной месяца; конец месяца
 * остаётся концом месяца (1–30 сентября → 1–31 августа).
 */
export function shiftPeriod(p: Period, months: number): Period {
  const from = addMonths(parseISO(p.from), months);
  const toDate = parseISO(p.to);
  const to = isLastDayOfMonth(toDate)
    ? endOfMonth(addMonths(toDate, months))
    : addMonths(toDate, months);
  return { from: iso(from), to: iso(to) };
}

/** Дни периода (включительно). */
export function periodDays(p: Period): number {
  return differenceInCalendarDays(parseISO(p.to), parseISO(p.from)) + 1;
}

/** Начала месяцев: `count` месяцев, заканчивая месяцем `lastDay`. */
export function monthStarts(lastDay: string, count: number): string[] {
  const last = startOfMonth(parseISO(lastDay));
  return Array.from({ length: count }, (_, i) => iso(addMonths(last, i - count + 1)));
}

export function monthLabel(monthStart: string, withYear = false): string {
  return format(parseISO(monthStart), withYear ? "LLLL yyyy" : "LLL", { locale: ru }).replace(
    ".",
    "",
  );
}

export type Week = { from: string; to: string; label: string };

/**
 * Календарные недели месяца — понедельник–воскресенье, обрезанные границами
 * месяца (как в «Выручке» Lady Stretch: 1–4, 5–11, …, 26–31).
 */
export function monthWeeks(monthStart: string): Week[] {
  const start = parseISO(monthStart);
  const end = endOfMonth(start);
  const weeks: Week[] = [];
  let from = start;
  while (from <= end) {
    // getDay: 0 — воскресенье.
    const toSunday = (7 - from.getDay()) % 7;
    const to = addDays(from, toSunday) > end ? end : addDays(from, toSunday);
    weeks.push({ from: iso(from), to: iso(to), label: `${from.getDate()}–${to.getDate()}` });
    from = addDays(to, 1);
  }
  return weeks;
}

/**
 * Прогноз месяца по среднему дневному темпу: выручка за прошедшие полные
 * дни (до вчера) / их число × дней в месяце. Только для текущего месяца; 1-го
 * числа прошедших дней нет — null.
 */
export function forecast(netBeforeToday: number, monthStart: string, today: string): number | null {
  if (monthPeriod(today).from !== monthStart) return null;
  const elapsed = parseISO(today).getDate() - 1;
  if (elapsed <= 0) return null;
  return (netBeforeToday / elapsed) * getDaysInMonth(parseISO(monthStart));
}

// ---------------------------------------------------------------------------
// Проценты и сравнения

/** Доля в процентах; знаменатель 0 — null. */
export function rate(part: number, base: number): number | null {
  return base > 0 ? (part / base) * 100 : null;
}

/** Деление; знаменатель 0 — null. */
export function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

/** Изменение к базе в процентах; базы нет или она 0 — null. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ---------------------------------------------------------------------------
// Выручка

export const net = (r: RevenueRow) => r.membership + r.other - r.refunds;

/** Выручка клубов за даты [from, to] (строки — по дням или по месяцам). */
export function sumRevenue(rows: RevenueRow[], ids: Set<string>, from: string, to: string): number {
  let sum = 0;
  for (const r of rows) if (ids.has(r.studioId) && r.date >= from && r.date <= to) sum += net(r);
  return sum;
}

export type RevenueLine = {
  key: string;
  label: string;
  closed: boolean;
  weeks: number[];
  /** Выручка месяца (с сегодняшним днём). */
  fact: number;
  forecast: number | null;
  pointZero: number | null;
  /** Прогноз (у прошедшего месяца — факт) к точке 0, %. */
  pointZeroRate: number | null;
  /** Прошлые месяцы — от ближнего к дальнему. */
  history: number[];
  studios: number;
};

export type RevenueTable = {
  month: string;
  weeks: Week[];
  historyMonths: string[];
  total: RevenueLine;
  cities: { line: RevenueLine; studios: RevenueLine[] }[];
};

/**
 * Таблица «Выручка»: город → клубы, недели выбранного месяца, факт, прогноз,
 * точка 0 и прошлые месяцы. `days` — выручка по дням выбранного месяца,
 * `months` — по месяцам истории (корзина month). Прогноз города и сети — от
 * их суммарной выручки, а не сумма округлённых прогнозов клубов.
 */
export function revenueTable(input: {
  studios: AnStudio[];
  days: RevenueRow[];
  months: RevenueRow[];
  month: string;
  today: string;
  history: number;
}): RevenueTable {
  const { studios, days, months, month, today, history } = input;
  const weeks = monthWeeks(month);
  const historyMonths = monthStarts(iso(addMonths(parseISO(month), -1)), history).reverse();
  const end = monthPeriod(month).to;
  const current = monthPeriod(today).from === month;
  const yesterday = iso(addDays(parseISO(today), -1));

  const line = (key: string, label: string, list: AnStudio[], closed: boolean): RevenueLine => {
    const ids = new Set(list.map((s) => s.id));
    const fact = sumRevenue(days, ids, month, end);
    const fc = forecast(sumRevenue(days, ids, month, yesterday), month, today);
    const zeros = list.map((s) => s.pointZero).filter((v): v is number => v !== null);
    // Точка 0 города — только если задана у всех его открытых клубов.
    const open = list.filter((s) => !isClosed(s, today));
    const pointZero =
      zeros.length > 0 && open.every((s) => s.pointZero !== null)
        ? open.reduce((sum, s) => sum + (s.pointZero ?? 0), 0) || null
        : null;
    const reach = current ? fc : fact;
    return {
      key,
      label,
      closed,
      weeks: weeks.map((w) => sumRevenue(days, ids, w.from, w.to)),
      fact,
      forecast: fc,
      pointZero,
      pointZeroRate: pointZero && reach !== null ? rate(reach, pointZero) : null,
      history: historyMonths.map((m) => sumRevenue(months, ids, m, monthPeriod(m).to)),
      studios: list.length,
    };
  };

  const cities = groupByCity(studios, today).map((g) => ({
    line: line(`city:${g.city}`, g.city, g.studios, !g.open),
    studios: g.studios.map((s) => line(s.id, s.name, [s], isClosed(s, today))),
  }));
  return {
    month,
    weeks,
    historyMonths,
    total: line("total", "Итого по сети", studios, false),
    cities,
  };
}

// ---------------------------------------------------------------------------
// Продажи абонементов

/** Абонементы (то, что Lady Stretch называет «продажи абонементов»). */
export const MEMBERSHIP_ORIGINS: SaleOrigin[] = ["new", "renewal", "return"];
/** Повторные — продления и возвраты. */
export const REPEAT_ORIGINS: SaleOrigin[] = ["renewal", "return"];

export type SalesSummary = {
  /** Продано абонементов (новые + продления + возвраты), без пробных и разовых. */
  sold: number;
  newSold: number;
  repeatSold: number;
  renewals: number;
  returns: number;
  singles: number;
  trials: number;
  /** Сумма продаж (номинал) абонементов. */
  soldAmount: number;
  /** Поступило минус возвраты — все виды продаж абонементов, кроме пробных. */
  paid: number;
  newPaid: number;
  repeatPaid: number;
  /** Средний чек: поступившее / продаж с поступлением в периоде. */
  avgCheck: number | null;
  avgNew: number | null;
  avgRepeat: number | null;
};

export function salesSummary(data: SalesData, ids: Set<string>): SalesSummary {
  const count = (origins: SaleOrigin[]) =>
    data.sold
      .filter((r) => ids.has(r.studioId) && origins.includes(r.origin))
      .reduce((s, r) => s + r.count, 0);
  const money = (origins: SaleOrigin[]) => {
    let paid = 0;
    let n = 0;
    for (const r of data.paidTotal) {
      if (!ids.has(r.studioId) || !origins.includes(r.origin)) continue;
      paid += r.income - r.refunds;
      n += r.paidSales;
    }
    return { paid, n };
  };
  const all = money([...MEMBERSHIP_ORIGINS, "single"]);
  const fresh = money(["new"]);
  const repeat = money(REPEAT_ORIGINS);
  return {
    sold: count(MEMBERSHIP_ORIGINS),
    newSold: count(["new"]),
    repeatSold: count(REPEAT_ORIGINS),
    renewals: count(["renewal"]),
    returns: count(["return"]),
    singles: count(["single"]),
    trials: count(["trial"]),
    soldAmount: data.sold
      .filter((r) => ids.has(r.studioId) && MEMBERSHIP_ORIGINS.includes(r.origin))
      .reduce((s, r) => s + r.amount, 0),
    paid: all.paid,
    newPaid: fresh.paid,
    repeatPaid: repeat.paid,
    avgCheck: ratio(all.paid, all.n),
    avgNew: ratio(fresh.paid, fresh.n),
    avgRepeat: ratio(repeat.paid, repeat.n),
  };
}

export type MonthPoint = {
  month: string;
  label: string;
  newSold: number;
  repeatSold: number;
  paid: number;
};

/** Продажи по месяцам (данные с корзиной month): новые, повторные, деньги. */
export function salesByMonth(data: SalesData, ids: Set<string>, months: string[]): MonthPoint[] {
  return months.map((m) => {
    const sold = data.sold.filter((r) => ids.has(r.studioId) && r.date === m);
    const paid = data.paid.filter(
      (r) => ids.has(r.studioId) && r.date === m && r.origin !== "trial",
    );
    return {
      month: m,
      label: monthLabel(m),
      newSold: sold.filter((r) => r.origin === "new").reduce((s, r) => s + r.count, 0),
      repeatSold: sold
        .filter((r) => REPEAT_ORIGINS.includes(r.origin))
        .reduce((s, r) => s + r.count, 0),
      paid: paid.reduce((s, r) => s + r.income - r.refunds, 0),
    };
  });
}

export type NomenclatureFilter = "all" | "new" | "repeat";

export type NomenclatureLine = { key: string; name: string; count: number; amount: number };

/** «Что покупают»: номенклатуры абонементов по числу продаж. */
export function nomenclature(
  data: SalesData,
  ids: Set<string>,
  filter: NomenclatureFilter,
  origins: SaleOrigin[] = MEMBERSHIP_ORIGINS,
): NomenclatureLine[] {
  const allowed = filter === "new" ? ["new"] : filter === "repeat" ? REPEAT_ORIGINS : origins;
  const map = new Map<string, NomenclatureLine>();
  for (const r of data.sold) {
    if (!ids.has(r.studioId) || !allowed.includes(r.origin)) continue;
    const key = r.membershipId ?? "none";
    const line = map.get(key) ?? {
      key,
      name: (r.membershipId && data.names[r.membershipId]?.name) || "Без названия",
      count: 0,
      amount: 0,
    };
    line.count += r.count;
    line.amount += r.amount;
    map.set(key, line);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || byName(a.name, b.name));
}

// ---------------------------------------------------------------------------
// Занятия

export type ClassesSummary = {
  classes: number;
  personal: number;
  booked: number;
  attended: number;
  noShow: number;
  /** Средние на групповом занятии. */
  avgBooked: number | null;
  avgAttended: number | null;
  /** Доходимость: пришли / записались, %. */
  attendance: number | null;
  /** Заполняемость: пришли / мест на занятиях с лимитом, %. */
  fill: number | null;
};

export function classesSummary(rows: ClassRow[], ids: Set<string>): ClassesSummary {
  const group = rows.filter((r) => ids.has(r.studioId) && r.kind === "group");
  const sum = (k: keyof ClassRow) => group.reduce((s, r) => s + Number(r[k]), 0);
  const classes = sum("classes");
  const booked = sum("booked");
  const attended = sum("attended");
  return {
    classes,
    personal: rows
      .filter((r) => ids.has(r.studioId) && r.kind === "personal")
      .reduce((s, r) => s + r.classes, 0),
    booked,
    attended,
    noShow: sum("noShow"),
    avgBooked: ratio(booked, classes),
    avgAttended: ratio(attended, classes),
    attendance: rate(attended, booked),
    fill: rate(sum("capAttended"), sum("capacity")),
  };
}

export type WorkoutLine = {
  key: string;
  name: string;
  classes: number;
  booked: number;
  attended: number;
  attendance: number | null;
  avgAttended: number | null;
};

/** Направления (тренировки) групповых занятий. */
export function workoutLines(
  rows: ClassRow[],
  names: Record<string, string>,
  ids: Set<string>,
): WorkoutLine[] {
  const map = new Map<string, WorkoutLine>();
  for (const r of rows) {
    if (!ids.has(r.studioId) || r.kind !== "group" || !r.workoutId) continue;
    const line = map.get(r.workoutId) ?? {
      key: r.workoutId,
      name: names[r.workoutId] ?? "Без названия",
      classes: 0,
      booked: 0,
      attended: 0,
      attendance: null,
      avgAttended: null,
    };
    line.classes += r.classes;
    line.booked += r.booked;
    line.attended += r.attended;
    map.set(r.workoutId, line);
  }
  return [...map.values()]
    .map((l) => ({
      ...l,
      attendance: rate(l.attended, l.booked),
      avgAttended: ratio(l.attended, l.classes),
    }))
    .sort((a, b) => b.attended - a.attended || byName(a.name, b.name));
}

// ---------------------------------------------------------------------------
// Пробные

export type TrialsSummary = {
  trials: number;
  attended: number;
  day0: number;
  d14: number;
  open: number;
  /** Пришли / пробных, %. */
  attendance: number | null;
  /** Купили в день пробного / пришли, %. */
  day0Rate: number | null;
  /** Купили за 14 дней / пришли, %. */
  d14Rate: number | null;
};

export function trialsSummary(rows: TrialRow[], ids: Set<string>): TrialsSummary {
  const list = rows.filter((r) => ids.has(r.studioId));
  const sum = (k: "trials" | "attended" | "day0" | "d14" | "open") =>
    list.reduce((s, r) => s + r[k], 0);
  const attended = sum("attended");
  return {
    trials: sum("trials"),
    attended,
    day0: sum("day0"),
    d14: sum("d14"),
    open: sum("open"),
    attendance: rate(attended, sum("trials")),
    day0Rate: rate(sum("day0"), attended),
    d14Rate: rate(sum("d14"), attended),
  };
}

/** Пробные по номенклатуре пробного занятия. */
export function trialLines(
  rows: TrialRow[],
  names: Record<string, string>,
  ids: Set<string>,
): ({ key: string; name: string } & TrialsSummary)[] {
  const keys = [...new Set(rows.filter((r) => ids.has(r.studioId)).map((r) => r.membershipId))];
  return keys
    .map((key) => ({
      key,
      name: names[key] ?? "Пробное",
      ...trialsSummary(
        rows.filter((r) => r.membershipId === key),
        ids,
      ),
    }))
    .sort((a, b) => b.trials - a.trials || byName(a.name, b.name));
}

// ---------------------------------------------------------------------------
// Рейтинг

export type RankBy = "club" | "city";

export type RatingEntry = {
  key: string;
  label: string;
  value: number;
  part?: number;
  base?: number;
};

export type Rating = {
  day0: RatingEntry[];
  d14: RatingEntry[];
  renewals: RatingEntry[];
  returns: RatingEntry[];
};

/**
 * Рейтинг клубов (или городов) за месяц — как «Топ-10» Lady Stretch:
 * покупка в день пробного и за 14 дней (доля от пришедших), продления без
 * возвращённых и возвращённые (штук). Без пришедших на пробное в долях не
 * участвует.
 */
export function rating(input: {
  studios: AnStudio[];
  trials: TrialRow[];
  sales: SalesData;
  by: RankBy;
  limit?: number;
}): Rating {
  const { studios, trials, sales, by, limit = 10 } = input;
  const groups =
    by === "club"
      ? studios.map((s) => ({ key: s.id, label: s.name, ids: new Set([s.id]) }))
      : [...new Set(studios.map(cityOf))].map((city) => ({
          key: city,
          label: city,
          ids: new Set(studios.filter((s) => cityOf(s) === city).map((s) => s.id)),
        }));
  const top = (list: RatingEntry[]) =>
    list
      .filter((e) => e.value > 0 || (e.base ?? 0) > 0)
      .sort(
        (a, b) => b.value - a.value || (b.base ?? 0) - (a.base ?? 0) || byName(a.label, b.label),
      )
      .slice(0, limit);
  const conv = (k: "day0" | "d14") =>
    top(
      groups.flatMap((g) => {
        const t = trialsSummary(trials, g.ids);
        return t.attended > 0
          ? [
              {
                key: g.key,
                label: g.label,
                value: rate(t[k], t.attended) ?? 0,
                part: t[k],
                base: t.attended,
              },
            ]
          : [];
      }),
    );
  const counts = (origin: SaleOrigin) =>
    top(
      groups.map((g) => ({
        key: g.key,
        label: g.label,
        value: sales.sold
          .filter((r) => g.ids.has(r.studioId) && r.origin === origin)
          .reduce((s, r) => s + r.count, 0),
      })),
    );
  return {
    day0: conv("day0"),
    d14: conv("d14"),
    renewals: counts("renewal"),
    returns: counts("return"),
  };
}

// ---------------------------------------------------------------------------
// Нулевая номенклатура

export type ZeroCity = {
  city: string;
  count: number;
  studios: { studio: AnStudio; count: number; items: ZeroRow[] }[];
};

/** Нулевые продажи: город → клуб → номенклатура (по числу продаж). */
export function zeroTree(rows: ZeroRow[], studios: AnStudio[], today: string): ZeroCity[] {
  return groupByCity(studios, today)
    .map((g) => {
      const list = g.studios
        .map((studio) => {
          const items = rows
            .filter((r) => r.studioId === studio.id)
            .sort((a, b) => b.count - a.count || byName(a.name, b.name));
          return { studio, items, count: items.reduce((s, r) => s + r.count, 0) };
        })
        .filter((s) => s.count > 0);
      return { city: g.city, studios: list, count: list.reduce((s, x) => s + x.count, 0) };
    })
    .filter((c) => c.count > 0);
}

// ---------------------------------------------------------------------------
// Вывод

const pctFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const decFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** «48,5%»; null — «—». */
export function formatRate(v: number | null, digits = 0): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${digits === 0 ? Math.round(v) : pctFormat.format(v)}%`;
}

/** Среднее с одним знаком; null — «—». */
export function formatAvg(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : decFormat.format(v);
}

/** Изменение «+12%» / «−5%»; null — «—». */
export function formatChange(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  return r === 0 ? "0%" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}
