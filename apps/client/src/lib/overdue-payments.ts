/**
 * Просроченный платёж по текущему абонементу — красная плашка на главной
 * (решение владельца 2026-11-07, оба приложения): у действующего или
 * замороженного абонемента клиента есть невнесённый платёж рассрочки, дата
 * которого прошла (по Тбилиси, в сам день — ещё не просрочен). Платёж,
 * снятый возвратом, не в счёт. Оплатить — у администратора клуба.
 */

export type OverduePayment = { amount: number; due_date: string };

/** Строка sale_installments (numeric приходит строкой). */
export type OverdueRow = {
  amount: number | string;
  due_date: string;
  paid: boolean | null;
  refunded?: boolean | null;
};

/** Сегодня по Тбилиси (YYYY-MM-DD) — как база считает даты платежей. */
export function tbilisiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi" }).format(now);
}

/** Просроченные платежи: не внесены, не сняты возвратом, дата раньше сегодня; самый ранний первым. */
export function overduePayments(rows: OverdueRow[], today: string): OverduePayment[] {
  return rows
    .filter((r) => !r.paid && !r.refunded && r.due_date < today)
    .map((r) => ({ amount: Number(r.amount), due_date: r.due_date }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}
