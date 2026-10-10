/** Способ оплаты продаж (sales.payment_type, other_sales.payment_method). */
export type PaymentMethod = "cash" | "card" | "transfer" | "app";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  app: "Приложение",
};

export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[];

/** Откуда продажа: из админки (портал) или из клиентского приложения. */
export type SaleSource = "admin" | "mobile";

export function saleSourceLabel(source: string | null | undefined) {
  return source === "mobile" ? "Приложение" : "Портал";
}
