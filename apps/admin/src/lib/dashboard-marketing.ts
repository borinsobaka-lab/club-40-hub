import { differenceInCalendarDays, parseISO } from "date-fns";

import { inPeriod, sumBy, type SaleRecord } from "@/lib/dashboard-analytics";
import type { SeriesPoint } from "@/lib/dashboard-series";
import type { MarketingKey } from "@/lib/dashboard-stats";

/**
 * Расчёты подраздела дашборда «Маркетинг» без React и Supabase (тест —
 * dashboard-marketing.test.ts): привлечение новых клиентов, их первые
 * покупки, пробные, анкета приложения, промокоды, NPS. Покупка — абонемент,
 * кроме пробного и разового посещения, по которому выдан абонемент клиенту
 * (удалённые не в счёт), как в истории клиента на «Продажах».
 */

export type MarketingClient = {
  id: string;
  userId: string | null;
  /** clients.registration_date — по ней «новые клиенты». */
  registrationDate: string | null;
};

/** Ответы анкеты приложения (member_profiles) по учётной записи. */
export type ProfileAnswers = { referralSource: string | null; goal: string | null };

const isPurchase = (s: SaleRecord) => !s.trial && !s.single && !s.noMembership;

function compareSales(a: SaleRecord, b: SaleRecord) {
  return a.soldAt === b.soldAt
    ? a.createdAt.localeCompare(b.createdAt)
    : a.soldAt.localeCompare(b.soldAt);
}

/** Первая покупка каждого клиента (абонемент, не пробное и не разовое). */
export function firstPurchases(sales: SaleRecord[]): Map<string, SaleRecord> {
  const first = new Map<string, SaleRecord>();
  for (const s of [...sales].sort(compareSales)) {
    if (isPurchase(s) && !first.has(s.clientId)) first.set(s.clientId, s);
  }
  return first;
}

/** Клиенты, появившиеся в периоде (дата регистрации в карточке). */
export function newClients(clients: MarketingClient[], from: string, to: string) {
  return clients.filter((c) => !!c.registrationDate && inPeriod(c.registrationDate, from, to));
}

const share = (part: number, base: number) => (base ? (part / base) * 100 : undefined);
const avg = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined;

/** Дней от регистрации до покупки; покупку внесли раньше регистрации — 0. */
function daysBetween(registration: string, soldAt: string) {
  return Math.max(0, differenceInCalendarDays(parseISO(soldAt), parseISO(registration)));
}

/**
 * Пробные периода: первое пробное клиента в периоде (возвращённые и
 * удалённые не в счёт) и купил ли он после него абонемент — на сегодня.
 */
export function trialOutcomes(sales: SaleRecord[], from: string, to: string) {
  const trials = new Map<string, SaleRecord>();
  for (const s of [...sales].sort(compareSales)) {
    if (!s.trial || s.cancelled || s.noMembership || !inPeriod(s.soldAt, from, to)) continue;
    if (!trials.has(s.clientId)) trials.set(s.clientId, s);
  }
  return [...trials.values()].map((trial) => ({
    trial,
    converted: sales.some(
      (s) =>
        s.clientId === trial.clientId && isPurchase(s) && !s.cancelled && s.soldAt >= trial.soldAt,
    ),
  }));
}

/** NPS: доля промоутеров (9–10) минус доля критиков (0–6), от −100 до 100. */
export function npsScore(scores: number[]) {
  if (scores.length === 0) return undefined;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return ((promoters - detractors) / scores.length) * 100;
}

export type MarketingInput = {
  sales: SaleRecord[];
  clients: MarketingClient[];
  /** Члены клуба (ЧК) — для доли в приложении. */
  memberIds: Set<string>;
  /** Оценки NPS с датой ответа (локальная yyyy-MM-dd). */
  nps: { date: string; score: number }[];
};

/** Плитки «Маркетинга» за период; не посчитать (нет базы для доли) — undefined. */
export function marketingMetrics(
  input: MarketingInput,
  from: string,
  to: string,
): Partial<Record<MarketingKey, number>> {
  const cohort = newClients(input.clients, from, to);
  const first = firstPurchases(input.sales);
  const registration = new Map(input.clients.map((c) => [c.id, c.registrationDate]));
  const buyers = [...first.values()].filter((s) => inPeriod(s.soldAt, from, to));
  const sold = input.sales.filter((s) => inPeriod(s.soldAt, from, to));
  const trials = trialOutcomes(input.sales, from, to);
  const members = input.clients.filter((c) => input.memberIds.has(c.id));
  return {
    newClients: cohort.length,
    newBuyers: buyers.length,
    purchaseConversion: share(cohort.filter((c) => first.has(c.id)).length, cohort.length),
    trialConversion: share(trials.filter((t) => t.converted).length, trials.length),
    firstRevenue: sumBy(buyers, (s) => s.totalAmount),
    daysToPurchase: avg(
      buyers.flatMap((s) => {
        const reg = registration.get(s.clientId);
        return reg ? [daysBetween(reg, s.soldAt)] : [];
      }),
    ),
    appSales: share(sold.filter((s) => s.source === "mobile").length, sold.length),
    appMembers: share(members.filter((c) => c.userId).length, members.length),
    nps: npsScore(input.nps.filter((r) => inPeriod(r.date, from, to)).map((r) => r.score)),
    discounts: sumBy(sold, (s) => s.discount),
  };
}

/**
 * Точки графиков плиток «Маркетинга» — из уже загруженных строк: у долей и
 * средних сумма и знаменатель по клиенту, продаже или ответу
 * (lib/dashboard-series.ts, avg). Точки вне корзин отбросит aggregate.
 */
export function marketingSeries(
  input: Pick<MarketingInput, "sales" | "clients">,
): Partial<Record<MarketingKey, SeriesPoint[]>> {
  const first = firstPurchases(input.sales);
  const firsts = [...first.values()];
  const registration = new Map(input.clients.map((c) => [c.id, c.registrationDate]));
  const trials = trialOutcomes(input.sales, "0000-01-01", "9999-12-31");
  return {
    newBuyers: firsts.map((s) => ({ date: s.soldAt, amount: 0, n: 1 })),
    purchaseConversion: input.clients.flatMap((c) =>
      c.registrationDate
        ? [{ date: c.registrationDate, amount: first.has(c.id) ? 100 : 0, n: 1 }]
        : [],
    ),
    trialConversion: trials.map((t) => ({
      date: t.trial.soldAt,
      amount: t.converted ? 100 : 0,
      n: 1,
    })),
    firstRevenue: firsts.map((s) => ({ date: s.soldAt, amount: s.totalAmount, n: 1 })),
    daysToPurchase: firsts.flatMap((s) => {
      const reg = registration.get(s.clientId);
      return reg ? [{ date: s.soldAt, amount: daysBetween(reg, s.soldAt), n: 1 }] : [];
    }),
    appSales: input.sales.map((s) => ({
      date: s.soldAt,
      amount: s.source === "mobile" ? 100 : 0,
      n: 1,
    })),
    discounts: input.sales.map((s) => ({ date: s.soldAt, amount: s.discount, n: 1 })),
  };
}

/** Точки графика NPS: промоутер +100, критик −100, нейтральный 0 — среднее и есть NPS. */
export function npsPoints(rows: MarketingInput["nps"]): SeriesPoint[] {
  return rows.map((r) => ({
    date: r.date,
    amount: r.score >= 9 ? 100 : r.score <= 6 ? -100 : 0,
    n: 1,
  }));
}

// ---------------------------------------------------------------------------
// Новые клиенты периода: путь, источники, цели

export type FunnelStep = { key: string; label: string; value: number };

/**
 * Что успели сделать новые клиенты периода — на сегодня. Каждый шаг — от
 * всех новых клиентов, а не от предыдущего: абонемент покупают и без
 * пробного. Пробные и разовые посещения — только у клубов с пакетами
 * тренировок (`withTrials`).
 */
export function newClientsFunnel(
  cohort: MarketingClient[],
  sales: SaleRecord[],
  visitedIds: Set<string>,
  withTrials: boolean,
): FunnelStep[] {
  const ids = new Set(cohort.map((c) => c.id));
  const buyers = (kind: (s: SaleRecord) => boolean) =>
    new Set(
      sales.filter((s) => kind(s) && !s.noMembership && ids.has(s.clientId)).map((s) => s.clientId),
    );
  const trialIds = buyers((s) => s.trial);
  const singleIds = buyers((s) => s.single);
  const first = firstPurchases(sales);
  const steps: FunnelStep[] = [
    { key: "new", label: "Новые клиенты", value: cohort.length },
    { key: "app", label: "Вошли в приложение", value: cohort.filter((c) => c.userId).length },
  ];
  if (withTrials)
    steps.push(
      { key: "trial", label: "Купили пробное", value: trialIds.size },
      { key: "single", label: "Купили разовое посещение", value: singleIds.size },
    );
  steps.push(
    {
      key: "visit",
      label: "Пришли на занятие",
      value: cohort.filter((c) => visitedIds.has(c.id)).length,
    },
    {
      key: "purchase",
      label: "Купили абонемент",
      value: cohort.filter((c) => first.has(c.id)).length,
    },
  );
  return steps;
}

export const NO_ANSWER = "__none";

/**
 * Новые клиенты по ответу анкеты (`answer` — источник или цель): сколько
 * пришло, сколько купили и на сколько (все покупки, кроме пробного и
 * разового). Без
 * приложения или без ответа — NO_ANSWER.
 */
export function cohortByAnswer(
  cohort: MarketingClient[],
  profiles: Map<string, ProfileAnswers>,
  sales: SaleRecord[],
  answer: (p: ProfileAnswers) => string | null,
) {
  const first = firstPurchases(sales);
  const revenue = new Map<string, number>();
  for (const s of sales) {
    if (isPurchase(s)) revenue.set(s.clientId, (revenue.get(s.clientId) ?? 0) + s.totalAmount);
  }
  const groups = new Map<string, { clients: number; buyers: number; revenue: number }>();
  for (const c of cohort) {
    const profile = c.userId ? profiles.get(c.userId) : undefined;
    const key = (profile && answer(profile)) || NO_ANSWER;
    const g = groups.get(key) ?? { clients: 0, buyers: 0, revenue: 0 };
    g.clients++;
    if (first.has(c.id)) g.buyers++;
    g.revenue += revenue.get(c.id) ?? 0;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, ...g, conversion: share(g.buyers, g.clients) }))
    .sort((a, b) => (a.key === NO_ANSWER ? 1 : b.key === NO_ANSWER ? -1 : b.clients - a.clients));
}

/** Промокоды продаж периода: код без регистра и пробелов, сумма и число продаж. */
export function promoCodes(sales: SaleRecord[], from: string, to: string) {
  const map = new Map<string, { value: number; n: number }>();
  for (const s of sales) {
    const code = s.promoCode?.trim().toUpperCase();
    if (!code || !inPeriod(s.soldAt, from, to)) continue;
    const g = map.get(code) ?? { value: 0, n: 0 };
    g.value += s.totalAmount;
    g.n++;
    map.set(code, g);
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => b.value - a.value || b.n - a.n);
}
