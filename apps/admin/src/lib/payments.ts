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

/**
 * Номенклатура пакетной студии (memberships.kind): пакет тренировок, пакет
 * персональных тренировок или пробное посещение. Пакет тренировок и пробное
 * расходуются на групповых занятиях (visits_left), пакет персональных — на
 * персональных (personal_left; туда же — подарочные персональные пакета
 * тренировок, memberships.personal_count). Подписочный формат тип не использует.
 */
export type MembershipKind = "package" | "personal" | "trial";

export const MEMBERSHIP_KIND_LABEL: Record<MembershipKind, string> = {
  package: "Пакет тренировок",
  personal: "Пакет персональных тренировок",
  trial: "Пробное посещение",
};
export const MEMBERSHIP_KINDS: MembershipKind[] = ["package", "personal", "trial"];

/**
 * Тип продажи пакетной студии (sales.sale_kind) — для аналитики: сколько
 * продали сразу в студии, сколько допродали потом (например, в чате), сколько
 * продлили. null — продажа без типа (подписочный формат, приложение).
 */
export type SaleKind = "new" | "trial" | "upsell" | "renewal";

export const SALE_KIND_LABEL: Record<SaleKind, string> = {
  new: "Новая продажа",
  trial: "Оплата пробного",
  upsell: "Допродажа",
  renewal: "Продление",
};
export const SALE_KINDS: SaleKind[] = ["new", "trial", "upsell", "renewal"];

/** Цветной кружок типа продажи — в выборе типа и в колонке «Тип продажи». */
export const SALE_KIND_DOT: Record<SaleKind, string> = {
  new: "bg-emerald-500",
  trial: "bg-emerald-500",
  upsell: "bg-blue-500",
  renewal: "bg-violet-500",
};

/** Светлая плашка под кружком на плитке выбора типа — тот же цвет. */
export const SALE_KIND_TINT: Record<SaleKind, string> = {
  new: "bg-emerald-500/15",
  trial: "bg-emerald-500/15",
  upsell: "bg-blue-500/15",
  renewal: "bg-violet-500/15",
};

/** Короткое пояснение на плитке выбора типа продажи. */
export const SALE_KIND_DESCRIPTION: Record<SaleKind, string> = {
  new: "Продажа пакета в студии",
  trial: "Пробное посещение из «Номенклатур»",
  upsell: "Продали позже — например, в чате",
  renewal: "Новый пакет клиенту, у которого уже были абонементы",
};

/** Пояснение под заголовком диалога продажи — по типу. */
export const SALE_KIND_HINT: Record<SaleKind, string> = {
  new: "Продажа в студии. Выберите клиента и пакет — стоимость подтянется автоматически.",
  trial: "Продажа пробного посещения. Пробное из «Номенклатур» подставится само.",
  upsell:
    "Продажа позже первого визита — например, в чате. Заполняется как обычная продажа, в отчётах учитывается отдельно.",
  renewal:
    "Новый пакет клиенту, у которого уже были абонементы. Заполняется как обычная продажа, в отчётах учитывается отдельно.",
};

/** Подсказки «?»: у полей формы продажи и у колонок таблицы «Продаж». */
export const SALE_TIPS = {
  soldAt: "С этой даты начинается абонемент: от неё считается срок действия и график рассрочки.",
  membership:
    "Тарифы из «Номенклатур». Если у клиента уже есть действующий или замороженный абонемент, новый его заменит. В пакетной студии пакет персональных заменяет только пакет персональных, пакет тренировок — только пакет тренировок.",
  paymentType: "Для отчётов: первая покупка, регулярное продление или прочее.",
  promo: "Только пометка для учёта — скидку сам не считает. Уменьшите «Стоимость» вручную.",
  amount:
    "Подставляется цена тарифа. Уменьшите её, чтобы дать скидку, — разница сохранится как скидка.",
  downPayment: "Сколько клиент платит сегодня. Остаток делится поровну на следующие платежи.",
  installments: "На сколько месяцев разбить остаток. Платежи — раз в месяц от даты продажи.",
  paymentsCount:
    "Сколькими платежами клиент оплатит пакет. Максимум задан в «Номенклатурах». Платежи — раз в месяц от даты продажи.",
  firstPayment:
    "Сколько клиент внёс на месте в студии. Остаток делится поровну на следующие платежи.",
  trainer:
    "Тренер, который был с клиентом, когда тот купил абонемент (например, вёл пробное). За продажу ему начисляется бонус к зарплате. Не было — оставьте «Без тренера».",
  saleKind:
    "Новая продажа — в студии, пробное — пробное посещение, допродажа — продали позже (например, в чате), продление — клиенту, у которого уже были абонементы.",
};
