/**
 * «Аналитика» — типы ответов базы (RPC analytics_*,
 * db/migrations/2026-10-26_zz_analytics.sql) после разбора. База отдаёт
 * строки массивами (так короче на сети), lib/analytics/data.ts раскладывает их
 * в эти объекты. Даты — yyyy-MM-dd по Тбилиси.
 */
import type { StudioFormat } from "@/lib/studio-formats";

/** Клуб отчётов: город, бренд, формат и настройки аналитики. */
export type AnStudio = {
  id: string;
  name: string;
  city: string | null;
  format: StudioFormat;
  ownership: "own" | "franchise";
  brandId: string | null;
  brandName: string | null;
  brandColor: string | null;
  /** Точка 0 — месячная выручка «в ноль»; null — не задана. */
  pointZero: number | null;
  /** Закрыт с этого дня (включительно); null — открыт. */
  closedOn: string | null;
  /** Может ли вызывающий менять точку 0 и статус этого клуба. */
  canManage: boolean;
};

export type AnScope = {
  /** Сегодня по Тбилиси — по часам базы, не браузера. */
  today: string;
  /** Может ли менять настройки хоть одного клуба (страница «Настройки»). */
  canManage: boolean;
  studios: AnStudio[];
};

/** Поступившие деньги клуба за день (или месяц): абонементы, прочие, возвраты. */
export type RevenueRow = {
  studioId: string;
  date: string;
  membership: number;
  other: number;
  refunds: number;
};

/**
 * Вид продажи по истории клиента — как classifySales дашборда: новый,
 * продление, возврат (перерыв дольше 14 дней), разовое посещение, пробное.
 */
export type SaleOrigin = "new" | "renewal" | "return" | "single" | "trial";

export type SoldRow = {
  studioId: string;
  date: string;
  membershipId: string | null;
  origin: SaleOrigin;
  count: number;
  /** Сумма продаж (номинал: total_amount), не поступившие деньги. */
  amount: number;
};

export type PaidRow = {
  studioId: string;
  date: string;
  origin: SaleOrigin;
  income: number;
  refunds: number;
};

/** Деньги вида продаж за весь период и сколько продаж оплачивалось в нём. */
export type PaidTotalRow = {
  studioId: string;
  origin: SaleOrigin;
  income: number;
  refunds: number;
  paidSales: number;
};

export type SalesData = {
  sold: SoldRow[];
  paid: PaidRow[];
  paidTotal: PaidTotalRow[];
  names: Record<string, { name: string; kind: string }>;
};

export type ClassRow = {
  studioId: string;
  date: string;
  /** Тренировка группового занятия; у персональных — null. */
  workoutId: string | null;
  kind: "group" | "personal";
  classes: number;
  booked: number;
  attended: number;
  noShow: number;
  /** Мест на занятиях с лимитом и сколько на них пришло. */
  capacity: number;
  capAttended: number;
};

export type ClassesData = { rows: ClassRow[]; names: Record<string, string> };

export type TrialRow = {
  studioId: string;
  date: string;
  membershipId: string;
  trials: number;
  attended: number;
  day0: number;
  d14: number;
  /** Пришли, ещё не купили, а 14 дней ещё не прошли. */
  open: number;
};

export type TrialsData = { rows: TrialRow[]; names: Record<string, string> };

export type ZeroRow = {
  studioId: string;
  kind: "membership" | "other";
  name: string;
  count: number;
  lastOn: string;
};

export type Period = { from: string; to: string };
