/**
 * Зарплаты сотрудников клубов (раздел рейки «Сотрудники»):
 * периоды выплат и сводка по строкам расчёта. Без React — модуль читают
 * страницы «Зарплаты» и «График администраторов» и тест payroll.test.ts.
 *
 * Строки считает база — RPC payroll_lines
 * (db/migrations/2026-10-11_zzz_staff_payroll.sql): смены администратора,
 * проведённые занятия по «Зарплатным ставкам» и продажи, по всем клубам
 * сотрудника. Здесь — только суммы за выбранный период: бонус 5 %
 * с продаж, корректировки, итог.
 *
 * Выплаты дважды в месяц. Классическая ставка: 20-го — аванс за 1–19, 1-го
 * числа следующего месяца — основная часть за 20–конец месяца.
 * Прогрессивная (PayFormat): 11-го — за 26–10, 26-го — за 11–25.
 */

/**
 * trial_bonus — тренеру пробного за абонемент, купленный после пробного
 * (тренер на прогрессивной ставке с бонусом в «Ставках»,
 * 2026-11-24_trainer_progressive_pay.sql).
 */
export type PayrollLineKind = "shift" | "group" | "personal" | "other" | "sale" | "trial_bonus";

/** Строка RPC payroll_lines: сотрудник × день × студия × вид (× название). */
export type PayrollLine = {
  trainer_id: string;
  work_date: string;
  studio_id: string;
  studio_name: string;
  kind: PayrollLineKind;
  /** Название прочей активности (kind = other). */
  title: string | null;
  units: number;
  /** Деньги за строку; у продаж — поступившие за день платежи (бонус считается отдельно). */
  amount: number;
};

export type AdjustmentKind = "bonus" | "deduction";

export const ADJUSTMENT_KINDS: Record<AdjustmentKind, { label: string; sign: 1 | -1 }> = {
  deduction: { label: "Вычет", sign: -1 },
  bonus: { label: "Надбавка", sign: 1 },
};

export type PayrollAdjustment = {
  id: string;
  trainer_id: string;
  kind: AdjustmentKind;
  amount: number;
  adjusted_on: string;
  reason: string;
  created_by_name: string | null;
  created_at: string;
};

export type PayrollPayout = {
  trainer_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  paid_at: string;
  paid_by_name: string | null;
};

/** Бонус с продаж по умолчанию — 5 %; свой процент сотрудника — trainer_pay_rates.sales_percent. */
export const BONUS_RATE = 0.05;

/** «5 %», «3,5 %» — доля бонуса с продаж подписью. */
export function percentLabel(rate: number): string {
  return `${String(Math.round(rate * 10000) / 100).replace(".", ",")} %`;
}

const PAY_FORMAT = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "GEL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Зарплатные суммы: копейки только когда они есть (235,9 — бонус с продаж), без «,00». */
export function formatPay(n: number) {
  return PAY_FORMAT.format(n);
}

/** Деньги с копейками без плавающих хвостов (0.1 + 0.2). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Месяцы и периоды ---------------------------------------------------------

/** Месяц — строка YYYY-MM; даты — YYYY-MM-DD (сравниваются как строки). */
export type MonthKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function monthOf(dateISO: string): MonthKey {
  return dateISO.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function monthBounds(month: MonthKey): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(month))}` };
}

/** Дни месяца с днём недели (0 — воскресенье) — для графика смен. */
export function monthDays(month: MonthKey): { date: string; day: number; weekday: number }[] {
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: daysInMonth(month) }, (_, i) => ({
    date: `${month}-${pad(i + 1)}`,
    day: i + 1,
    weekday: new Date(y, m - 1, i + 1).getDay(),
  }));
}

const MONTH_NAME = new Intl.DateTimeFormat("ru-RU", { month: "long" });
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Октябрь» — именительный падеж (standalone в ru-RU). */
export function monthName(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  return capitalize(MONTH_NAME.format(new Date(y, m - 1, 1)));
}

/** «Октябрь 2026». */
export function monthLabel(month: MonthKey): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/**
 * Формат оплаты тренера (trainer_pay_rates.pay_format, решение владельца
 * 2026-11-24): classic — «Классическая» (ставка за тренировку и бонус с
 * продажи), progressive — «Прогрессивная» (групповые по числу пришедших по
 * своим схемам тренера). У форматов разные дни выплат — см. PeriodKey.
 */
export type PayFormat = "classic" | "progressive";

export const PAY_FORMATS: Record<PayFormat, { label: string; tip: string }> = {
  classic: {
    label: "Классическая",
    tip: "Ставка за тренировку и бонус 5 % с продажи. Выплаты: 20-го — аванс за 1–19, 1-го — основная часть за 20–конец месяца.",
  },
  progressive: {
    label: "Прогрессивная",
    tip: "Тренеры с оплатой групповых по числу пришедших (минимум за малую группу, дальше — за каждого человека, плюс бонус за наполняемость) и администраторы со своим процентом с продаж. Выплаты: 11-го — за 26–10, 26-го — за 11–25.",
  },
};

/**
 * Период выплаты. Классическая ставка: advance — аванс 1–19, main —
 * основная 20–конец, month — весь месяц. Прогрессивная: advance — с 26-го
 * прошлого месяца по 10-е (выплата 11-го), main — 11–25 (выплата 26-го),
 * month — оба периода (26-е прошлого — 25-е).
 */
export type PeriodKey = "advance" | "main" | "month";

export const ADVANCE_LAST_DAY = 19;
/** Прогрессивная ставка: дни выплат; период заканчивается накануне. */
export const PROGRESSIVE_PAY_DAYS = [11, 26] as const;

const [P_FIRST, P_SECOND] = PROGRESSIVE_PAY_DAYS;

export function periodRange(
  month: MonthKey,
  period: PeriodKey,
  format: PayFormat = "classic",
): { from: string; to: string } {
  if (format === "progressive") {
    const start = `${addMonths(month, -1)}-${pad(P_SECOND)}`;
    const mid = `${month}-${pad(P_FIRST - 1)}`;
    if (period === "advance") return { from: start, to: mid };
    const end = `${month}-${pad(P_SECOND - 1)}`;
    if (period === "main") return { from: `${month}-${pad(P_FIRST)}`, to: end };
    return { from: start, to: end };
  }
  const { from, to } = monthBounds(month);
  if (period === "advance") return { from, to: `${month}-${pad(ADVANCE_LAST_DAY)}` };
  if (period === "main") return { from: `${month}-${pad(ADVANCE_LAST_DAY + 1)}`, to };
  return { from, to };
}

/** Даты, за которые нужны строки расчёта, чтобы показать любой период месяца. */
export function payrollBounds(month: MonthKey, format: PayFormat = "classic") {
  return periodRange(month, "month", format);
}

const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const DAY_MONTH_LONG = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const asDate = (iso: string) => new Date(`${iso}T00:00:00`);
const shortDay = (iso: string) => DAY_MONTH.format(asDate(iso)).replace(".", "");

/** «26 окт – 10 ноя», в пределах месяца — «11–25 ноя». */
export function rangeLabel(r: { from: string; to: string }): string {
  if (monthOf(r.from) === monthOf(r.to)) return `${Number(r.from.slice(8))}–${shortDay(r.to)}`;
  return `${shortDay(r.from)} – ${shortDay(r.to)}`;
}

export function periodLabel(
  month: MonthKey,
  period: PeriodKey,
  format: PayFormat = "classic",
): string {
  if (format === "progressive")
    return period === "month" ? "Оба периода" : rangeLabel(periodRange(month, period, format));
  if (period === "advance") return `Аванс 1–${ADVANCE_LAST_DAY}`;
  if (period === "main") return `Основная ${ADVANCE_LAST_DAY + 1}–${daysInMonth(month)}`;
  return "Весь месяц";
}

/** «Октябрь 1–19, 2026» — как в шапке карточки сотрудника; через месяц — «26 октября – 10 ноября 2026». */
export function periodTitle(
  month: MonthKey,
  period: PeriodKey,
  format: PayFormat = "classic",
): string {
  const { from, to } = periodRange(month, period, format);
  if (monthOf(from) !== monthOf(to))
    return `${DAY_MONTH_LONG.format(asDate(from))} – ${DAY_MONTH_LONG.format(asDate(to))} ${to.slice(0, 4)}`;
  return `${monthName(month)} ${Number(from.slice(8))}–${Number(to.slice(8))}, ${month.slice(0, 4)}`;
}

/**
 * День выплаты. Классическая: аванс — 20-го этого месяца, основная — 1-го
 * следующего. Прогрессивная: 11-го и 26-го.
 */
export function payDate(
  month: MonthKey,
  period: PeriodKey,
  format: PayFormat = "classic",
): string | null {
  if (period === "month") return null;
  if (format === "progressive") return `${month}-${pad(period === "advance" ? P_FIRST : P_SECOND)}`;
  if (period === "advance") return `${month}-${pad(ADVANCE_LAST_DAY + 1)}`;
  return `${addMonths(month, 1)}-01`;
}

/**
 * Период, который открывать по умолчанию, — ближайшая выплата. Классическая:
 * 1-го числа — основная за прошлый месяц, со 2-го по 20-е — аванс, дальше —
 * основная. Прогрессивная: по 11-е — период до 10-го, по 26-е — 11–25,
 * дальше — первый период следующего месяца (он уже идёт).
 */
export function defaultPeriod(
  todayISO: string,
  format: PayFormat = "classic",
): { month: MonthKey; period: PeriodKey } {
  const month = monthOf(todayISO);
  const day = Number(todayISO.slice(8, 10));
  if (format === "progressive") {
    if (day <= P_FIRST) return { month, period: "advance" };
    if (day <= P_SECOND) return { month, period: "main" };
    return { month: addMonths(month, 1), period: "advance" };
  }
  if (day === 1) return { month: addMonths(month, -1), period: "main" };
  return { month, period: day <= ADVANCE_LAST_DAY + 1 ? "advance" : "main" };
}

/** Части, из которых складывается период (выплаты отмечаются по ним). */
export function payoutPeriods(
  month: MonthKey,
  period: PeriodKey,
  format: PayFormat = "classic",
): { from: string; to: string }[] {
  return period === "month"
    ? [periodRange(month, "advance", format), periodRange(month, "main", format)]
    : [periodRange(month, period, format)];
}

// --- Сводка ---------------------------------------------------------------------

export type PayrollSummary = {
  /** Оклад: смены + занятия. */
  base: number;
  shifts: number;
  groups: number;
  personals: number;
  others: number;
  sales: number;
  salesCount: number;
  /** За абонементы после пробного (фикс за продажу). */
  trialBonus: number;
  trialSales: number;
  /** Бонус: процент с продаж + за абонементы после пробного. */
  bonus: number;
  /** Доля бонуса с продаж у сотрудника (0.05 — 5 %). */
  bonusRate: number;
  /** Корректировки со знаком. */
  adjustments: number;
  total: number;
};

export const EMPTY_SUMMARY: PayrollSummary = {
  base: 0,
  shifts: 0,
  groups: 0,
  personals: 0,
  others: 0,
  sales: 0,
  salesCount: 0,
  trialBonus: 0,
  trialSales: 0,
  bonus: 0,
  bonusRate: BONUS_RATE,
  adjustments: 0,
  total: 0,
};

const inRange = (date: string, r: { from: string; to: string }) => date >= r.from && date <= r.to;

/** Сводка по сотрудникам за период [from, to]. */
export function summarize(
  lines: PayrollLine[],
  adjustments: PayrollAdjustment[],
  range: { from: string; to: string },
  /** Доля бонуса с продаж сотрудника; без неё — 5 %. */
  rateOf?: (trainerId: string) => number,
): Map<string, PayrollSummary> {
  const out = new Map<string, PayrollSummary>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) {
      s = { ...EMPTY_SUMMARY, bonusRate: rateOf?.(id) ?? BONUS_RATE };
      out.set(id, s);
    }
    return s;
  };

  for (const l of lines) {
    if (!inRange(l.work_date, range)) continue;
    const s = get(l.trainer_id);
    const amount = Number(l.amount) || 0;
    switch (l.kind) {
      case "sale":
        s.sales += amount;
        s.salesCount += l.units;
        continue;
      case "trial_bonus":
        s.trialBonus += amount;
        s.trialSales += l.units;
        continue;
      case "shift":
        s.shifts += l.units;
        break;
      case "group":
        s.groups += l.units;
        break;
      case "personal":
        s.personals += l.units;
        break;
      case "other":
        s.others += l.units;
        break;
    }
    s.base += amount;
  }

  for (const a of adjustments) {
    if (!inRange(a.adjusted_on, range)) continue;
    get(a.trainer_id).adjustments += ADJUSTMENT_KINDS[a.kind].sign * (Number(a.amount) || 0);
  }

  for (const s of out.values()) {
    s.base = round2(s.base);
    s.sales = round2(s.sales);
    s.trialBonus = round2(s.trialBonus);
    s.bonus = round2(s.sales * s.bonusRate + s.trialBonus);
    s.adjustments = round2(s.adjustments);
    s.total = round2(s.base + s.bonus + s.adjustments);
  }
  return out;
}

/** Короткая подпись оклада: «10 смен», «12 гр. · 3 перс.». */
export function workSummary(s: PayrollSummary): string {
  const parts: string[] = [];
  if (s.shifts) parts.push(`${s.shifts} ${plural(s.shifts, ["смена", "смены", "смен"])}`);
  if (s.groups) parts.push(`${s.groups} гр.`);
  if (s.personals) parts.push(`${s.personals} перс.`);
  if (s.others) parts.push(`${s.others} проч.`);
  return parts.join(" · ");
}

export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Короткое обозначение студии для строк тренировок: «Ваке» → «В», «Old Town» → «OT». */
export function studioAbbr(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

/**
 * Обозначения студий без совпадений: при одинаковых первых буквах — больше
 * букв названия («Ваке» / «Варкетили» → «Вак» / «Вар»).
 */
export function studioAbbrs(names: string[]): Map<string, string> {
  const unique = [...new Set(names)];
  const out = new Map<string, string>();
  for (const name of unique) {
    const base = studioAbbr(name);
    const clash = unique.some((other) => other !== name && studioAbbr(other) === base);
    if (!clash) {
      out.set(name, base);
      continue;
    }
    let len = 2;
    const short = (n: string) => n.replace(/\s+/g, "").slice(0, len);
    while (
      len < name.length &&
      unique.some(
        (other) => other !== name && short(other).toLowerCase() === short(name).toLowerCase(),
      )
    )
      len++;
    out.set(name, short(name));
  }
  return out;
}
