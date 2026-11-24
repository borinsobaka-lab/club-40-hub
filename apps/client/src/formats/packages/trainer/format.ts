import type { Translator } from "@/i18n";
import { GOAL_LABEL } from "./profile-labels";

/** Подписи экранов тренера без запросов к базе — их проверяют тесты. */

/** «сегодня 14:05», «вчера 09:30», «12 окт.» — когда оставлен комментарий. */
export function commentWhen(iso: string, t: Translator, now = new Date()) {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return t("сегодня {time}", { time: t.time(d) });
  if (days === 1) return t("вчера {time}", { time: t.time(d) });
  return t.date(d, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Главная цель клиента одной строкой («Другое» — с текстом клиента). */
export function goalText(goal: string | null, other: string | null, t: Translator) {
  if (!goal) return null;
  const label = GOAL_LABEL[goal] ? t(GOAL_LABEL[goal]) : goal;
  return goal === "other" && other?.trim() ? `${label}: ${other.trim()}` : label;
}

/** Имя клиента: «Имя Фамилия». */
export function clientDisplayName(c: {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
}) {
  const parts = [c.first_name, c.last_name].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : c.full_name?.trim() || "—";
}

/**
 * Ссылка на Telegram сотрудника из поля «Telegram» админки: ник (с «@» или
 * без), «t.me/ник» или ссылка целиком. Чужие адреса и мусор — null (кнопки нет).
 */
export function telegramHref(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const link = v.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(.+)$/i);
  if (link) return `https://t.me/${link[1]}`;
  const nick = v.replace(/^@/, "");
  return /^[A-Za-z0-9_]{4,32}$/.test(nick) ? `https://t.me/${nick}` : null;
}

/** Дата YYYY-MM-DD из базы как местная полночь (new Date(iso) дал бы UTC и сдвиг дня). */
export function localDay(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Сколько дней от from до to (даты YYYY-MM-DD). */
export function daysBetween(from: string, to: string) {
  return Math.round((localDay(to).getTime() - localDay(from).getTime()) / 86_400_000);
}

/** Период выплаты: «11–25 ноября», через месяц — «26 октября – 10 ноября». */
export function payoutPeriodLabel(from: string, to: string, t: Translator) {
  const long = { day: "numeric", month: "long" } as const;
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${Number(from.slice(8, 10))}–${t.date(localDay(to), long)}`;
  return `${t.date(localDay(from), long)} – ${t.date(localDay(to), long)}`;
}

/** Деньги в лари: «240 ₾», копейки — только когда они есть. */
export function payoutMoney(amount: number, t: Translator) {
  return `${t.number(Math.round(amount * 100) / 100, { maximumFractionDigits: 2 })} ₾`;
}

/** Когда выплата: «сегодня», «завтра», «через 3 дня»; прошла — null. */
export function payoutIn(today: string, payOn: string, t: Translator) {
  const days = daysBetween(today, payOn);
  if (days < 0) return null;
  if (days === 0) return t("сегодня");
  if (days === 1) return t("завтра");
  return t.plural(days, "через {n} день|через {n} дня|через {n} дней");
}

const TBILISI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tbilisi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** День занятия по Тбилиси (YYYY-MM-DD) — как база относит его к периоду. */
export function tbilisiDay(iso: string) {
  return TBILISI_DAY.format(new Date(iso));
}

export type PayoutDay<L, X, A> = {
  date: string;
  lessons: L[];
  extras: X[];
  adjustments: A[];
  /** Начислено за день: занятия + бонусы + надбавки − вычеты. */
  total: number;
};

/**
 * Начисления периода по дням, свежие сверху: занятия дня (по времени),
 * смены и бонусы, вычеты и надбавки с этой датой.
 */
export function payoutDays<
  L extends { starts_at: string; amount: number },
  X extends { date: string; bonus: number },
  A extends { adjusted_on: string; kind: "bonus" | "deduction"; amount: number },
>(lessons: L[], extras: X[], adjustments: A[]): PayoutDay<L, X, A>[] {
  const days = new Map<string, PayoutDay<L, X, A>>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = { date, lessons: [], extras: [], adjustments: [], total: 0 };
      days.set(date, d);
    }
    return d;
  };
  for (const l of lessons) {
    const d = day(tbilisiDay(l.starts_at));
    d.lessons.push(l);
    d.total += l.amount;
  }
  for (const x of extras) {
    const d = day(x.date.slice(0, 10));
    d.extras.push(x);
    d.total += x.bonus;
  }
  for (const a of adjustments) {
    const d = day(a.adjusted_on.slice(0, 10));
    d.adjustments.push(a);
    d.total += a.kind === "deduction" ? -a.amount : a.amount;
  }
  for (const d of days.values()) {
    d.lessons.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    d.total = Math.round(d.total * 100) / 100;
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}
