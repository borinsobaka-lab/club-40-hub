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

/** Тип оплаты продажи абонемента (sales.payment_type) — для отчётов. */
export type PaymentType = "first" | "recurring" | "other";

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  first: "Первая оплата",
  recurring: "Регулярная оплата",
  other: "Другое",
};
export const PAYMENT_TYPES: PaymentType[] = ["first", "recurring", "other"];

/** Подсказки «?»: у полей формы продажи и у колонок таблицы «Продаж». */
export const SALE_TIPS = {
  soldAt: "С этой даты начинается абонемент: от неё считается срок действия и график рассрочки.",
  membership:
    "Тарифы из «Номенклатур». Если у клиента уже есть действующий или замороженный абонемент, новый его заменит.",
  paymentType: "Для отчётов: первая покупка, регулярное продление или прочее.",
  promo: "Только пометка для учёта — скидку сам не считает. Уменьшите «Стоимость» вручную.",
  amount:
    "Подставляется цена тарифа. Уменьшите её, чтобы дать скидку, — разница сохранится как скидка.",
  downPayment: "Сколько клиент платит сегодня. Остаток делится поровну на следующие платежи.",
  installments: "На сколько месяцев разбить остаток. Платежи — раз в месяц от даты продажи.",
  admin: "Подставляется сам: продажа записывается на того, кто её оформляет.",
};
