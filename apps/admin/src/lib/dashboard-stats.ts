/**
 * Плитки и блоки подразделов дашборда: подписи, подсказки «?» и вид
 * значения. Отдельно от страниц (routes/_authenticated/dashboard/*): те же
 * подписи рисуют скелетоны (components/page-skeletons.tsx), а им нельзя
 * импортировать файлы страниц. Графики к плиткам страницы добавляют сами.
 */

import { RENEWAL_GRACE_DAYS } from "@/lib/dashboard-analytics";
import { formatMoney, formatNumber } from "@/lib/format";

export type StatFormat = "money" | "number" | "decimal" | "years";

const decimal = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export function formatStat(format: StatFormat, n: number) {
  if (format === "money") return formatMoney(n);
  if (format === "decimal") return decimal.format(n);
  if (format === "years") return `${decimal.format(n)} ${yearsWord(n)}`;
  return formatNumber(n);
}

function yearsWord(n: number) {
  if (!Number.isInteger(n)) return "года";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "год";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "года";
  return "лет";
}

export type StatInfo<K extends string = string> = {
  key: K;
  label: string;
  tip: string;
  hint?: string;
  format: StatFormat;
  compare: boolean;
  goodWhenUp: boolean;
};

const GRACE = `${RENEWAL_GRACE_DAYS} дней`;

/** Подразделы дашборда — пункты его меню и заголовки страниц. */
export const DASHBOARD_TITLES = {
  overview: "Общие показатели",
  sales: "Продажи",
  clients: "Клиенты",
  classes: "Занятия",
  marketing: "Маркетинг",
} as const;

/** Подписи и подсказки плашки фильтров дашборда. */
export const DASHBOARD_FILTERS = {
  period: {
    label: "Период",
    tip: "Диапазон дат, за который считаются показатели аналитики.",
  },
  clubs: {
    label: "Клубы",
    tip: "Показатели считаются суммарно по выбранным клубам: один клуб, несколько или все клубы одного формата. Подписочные клубы и клубы с пакетами тренировок вместе не считаются.",
  },
} as const;

/** Высоты графиков — общие у страницы и её скелетона. */
export const DASHBOARD_CHART_HEIGHT = 260;
export const DASHBOARD_PIE_HEIGHT = 180;
/** График рядом с «Топ 10» — высотой с сам рейтинг. */
export const DASHBOARD_RANK_HEIGHT = 360;

// ---------------------------------------------------------------------------
// Общие показатели

export type OverviewKey =
  | "revenue"
  | "signups"
  | "activeClients"
  | "expiring"
  | "visits"
  | "avgMembership"
  | "avgServices"
  | "avgTotal"
  | "debtPeriod"
  | "debtTotal";

export const OVERVIEW_STATS: StatInfo<OverviewKey>[] = [
  {
    key: "revenue",
    label: "Выручка",
    tip: "Проданные за период абонементы, услуги и товары минус возвраты. Абонемент в рассрочку считается полной стоимостью в день продажи; платежи, снятые возвратом, вычитаются в день возврата.",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "signups",
    label: "Новые регистрации",
    tip: "Сколько клиентов появилось за период: зарегистрировались в приложении или заведены в админке.",
    hint: "за период",
    format: "number",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "activeClients",
    label: "Активные клиенты",
    tip: "Клиенты, у которых сейчас есть действующий абонемент (замороженные не считаются). От периода не зависит.",
    hint: "сейчас",
    format: "number",
    compare: false,
    goodWhenUp: true,
  },
  {
    key: "expiring",
    label: "Заканчивается абонементов",
    tip: "Абонементы, срок которых истекает в выбранном периоде, — кого звать на продление. Не считаются отменённые, с возвратом и те, что клиент уже продлил: купил следующий абонемент того же вида до окончания.",
    hint: "в периоде",
    format: "number",
    compare: true,
    goodWhenUp: false,
  },
  {
    key: "visits",
    label: "Посещений",
    tip: "Сколько посещений занятий отмечено за период.",
    hint: "за период",
    format: "number",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "avgMembership",
    label: "Средний чек за абонементы",
    tip: "Сумма проданных за период абонементов, делённая на число продаж.",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "avgServices",
    label: "Средний чек за услуги",
    tip: "Сумма прочих продаж (услуги и товары) за период, делённая на их число.",
    hint: "за период",
    format: "money",
    compare: false,
    goodWhenUp: true,
  },
  {
    key: "avgTotal",
    label: "Средний чек общий",
    tip: "Все продажи за период — абонементы, услуги и товары, — делённые на их число.",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "debtPeriod",
    label: "Задолженность за период",
    tip: "Неоплаченные платежи рассрочки со сроком оплаты в выбранном периоде. Платежи, снятые возвратом, не считаются.",
    hint: "не оплачено",
    format: "money",
    compare: true,
    goodWhenUp: false,
  },
  {
    key: "debtTotal",
    label: "Общая задолженность",
    tip: "Все неоплаченные платежи рассрочки клуба — с любым сроком оплаты. Платежи, снятые возвратом, не считаются.",
    hint: "всего",
    format: "money",
    compare: false,
    goodWhenUp: false,
  },
];

/** Сетка плиток: 10 штук — по 5 в ряд на широком экране. */
export const OVERVIEW_GRID = "lg:grid-cols-3 xl:grid-cols-5";

export const OVERVIEW_CHARTS = {
  revenue: {
    title: "Фактическая выручка",
    tip: "Деньги, поступившие в клуб, по дням: оплаты абонементов и внесённые платежи рассрочки, прочие продажи, минус возвраты.",
  },
  rates: {
    title: "Продления и возвращения",
    tip: `Продления — доля абонементов, закончившихся в месяце, после которых клиент купил новый не позже чем через ${GRACE}. Возвращения — доля бывших клиентов (без абонемента дольше ${GRACE}), купивших абонемент в этом месяце. Пакеты персональных тренировок считаются отдельно от групповых абонементов.`,
  },
  visits: {
    title: "Посещения",
    tip: "Отмеченные посещения занятий по дням периода.",
  },
} as const;

// ---------------------------------------------------------------------------
// Продажи

export type SalesKey =
  | "membershipRevenue"
  | "membershipPayments"
  | "otherRevenue"
  | "avgMembershipCheck"
  | "avgMembershipPayment"
  | "avgOtherCheck";

export const SALES_STATS: StatInfo<SalesKey>[] = [
  {
    key: "membershipRevenue",
    label: "Выручка от абонементов",
    tip: "Полная стоимость абонементов, проданных за период, — вместе с ещё не внесёнными платежами рассрочки.",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "membershipPayments",
    label: "Платежи по абонементам",
    tip: "Деньги, фактически поступившие за период по абонементам: оплаты без рассрочки и внесённые платежи рассрочки, в том числе по продажам прошлых периодов.",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "otherRevenue",
    label: "Прочая выручка",
    tip: "Сумма прочих продаж за период — услуги и товары из раздела «Прочие продажи».",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "avgMembershipCheck",
    label: "Средний чек по абонементам",
    tip: "Выручка от абонементов за период, делённая на число проданных абонементов.",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "avgMembershipPayment",
    label: "Средний платёж по абонементам",
    tip: "Платежи по абонементам за период, делённые на число платежей. При рассрочке каждый внесённый платёж считается отдельно.",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "avgOtherCheck",
    label: "Средний чек по прочим продажам",
    tip: "Прочая выручка за период, делённая на число прочих продаж.",
    hint: "за период",
    format: "money",
    compare: true,
    goodWhenUp: true,
  },
];

export const SALES_GRID = "lg:grid-cols-3";

export const SALES_CHARTS = {
  origin: {
    title: "Доля выручки от абонементов",
    tip: `Выручка от абонементов за период по типу покупки. Новый — первый абонемент клиента; продление — прежний ещё действовал или закончился не больше ${GRACE} назад; возврат — после перерыва дольше ${GRACE}. Пробное посещение прошлой покупкой не считается, пакеты персональных тренировок — отдельная история от групповых абонементов.`,
  },
  methods: {
    title: "Способы оплаты",
    tip: "Деньги, поступившие за период (платежи по абонементам и прочие продажи), по способу оплаты.",
  },
  subjects: {
    title: "Предмет оплаты",
    tip: "Деньги, поступившие за период, по тому, за что заплатили: абонементы и позиции прочих продаж.",
  },
  topMemberships: {
    title: "Топ 10 абонементов по выручке",
    tip: "Тарифы из «Номенклатур» с наибольшей суммой платежей за период.",
  },
  topSellers: {
    title: "Топ менеджеров по абонементам",
    tip: "Платежи по абонементам за период по ответственному администратору — тому, кто указан в продаже.",
  },
} as const;

// ---------------------------------------------------------------------------
// Клиенты

export type ClientsKey = "avgAge" | "visitsPerClient" | "ltv";

const MEMBERS = "членов клуба — клиентов с действующим абонементом (в том числе замороженным)";

export const CLIENTS_STATS: StatInfo<ClientsKey>[] = [
  {
    key: "avgAge",
    label: "Средний возраст",
    tip: `Средний возраст ${MEMBERS}. Клиенты без даты рождения не учитываются.`,
    hint: "сейчас",
    format: "years",
    compare: false,
    goodWhenUp: true,
  },
  {
    key: "visitsPerClient",
    label: "Посещений на клиента",
    tip: `Сколько посещений за период в среднем приходится на одного из ${MEMBERS}.`,
    hint: "за период",
    format: "decimal",
    compare: true,
    goodWhenUp: true,
  },
  {
    key: "ltv",
    label: "LTV клиента",
    tip: `Сколько денег в среднем принёс один из ${MEMBERS}, за всё время: платежи по абонементам и прочим продажам минус возвраты. От периода не зависит.`,
    hint: "за всё время",
    format: "money",
    compare: false,
    goodWhenUp: true,
  },
];

export const CLIENTS_GRID = "sm:grid-cols-3";

export const CLIENTS_CHARTS = {
  ages: {
    title: "Возраст клиентов",
    tip: "Члены клуба (с действующим абонементом) по возрасту — полных лет на сегодня.",
  },
  topVisits: {
    title: "Топ 10 клиентов по посещениям",
    tip: "Клиенты с наибольшим числом отмеченных посещений за период.",
  },
  topLtv: {
    title: "Топ 10 клиентов по LTV",
    tip: "Клиенты, принёсшие клубу больше всего денег за всё время: все платежи за вычетом возвратов. От периода не зависит.",
  },
} as const;
