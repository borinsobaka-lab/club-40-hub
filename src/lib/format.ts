/**
 * Общие форматтеры админки. Раньше эти функции были скопированы в 5–6 файлов,
 * причём с расхождениями по точности денег — здесь обе точности сохранены
 * намеренно, чтобы вид разделов не изменился.
 */

const MONEY_ROUND = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "GEL",
  maximumFractionDigits: 0,
});

const MONEY_PRECISE = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "GEL",
  maximumFractionDigits: 2,
});

/** Деньги без копеек: продажи, дашборд, карточка клиента. */
export function formatMoney(n: number) {
  return MONEY_ROUND.format(n);
}

/** Деньги с копейками: касса, прочие продажи (там суммы мелкие). */
export function formatMoneyPrecise(n: number) {
  return MONEY_PRECISE.format(n);
}

/** Дата в ru-RU (dd.mm.yyyy). Невалидное значение отдаём как есть. */
export function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("ru-RU");
  } catch {
    return v;
  }
}

/** Число с разделителями разрядов. */
export function formatNumber(n: number) {
  return new Intl.NumberFormat("ru-RU").format(n);
}

/** «Фамилия Имя» с фолбэком на full_name — единый вид имени клиента. */
export function clientName(c: {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}) {
  const composed = [c.last_name, c.first_name].filter(Boolean).join(" ").trim();
  return composed || c.full_name || "—";
}
