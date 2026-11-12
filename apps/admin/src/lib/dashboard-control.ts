import { addDays, differenceInCalendarDays, parseISO } from "date-fns";

import { commentAgeDays, type CommentStats } from "@/lib/client-comments";
import { formatPhoneDisplay } from "@/lib/contacts";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { plural } from "@/lib/payroll";

/**
 * «Руководителю» (меню «Дашборд», решение владельца 2026-11-10): то, что
 * руководитель проверял руками фильтрами «Абонементов» пакетных клубов, —
 * у каких абонементов давно нет комментария по клиенту:
 *
 * 1. просрочен платёж (`payment_state = 'overdue'`);
 * 2. срок заканчивается сегодня или в ближайшие 7 дней (действующий или
 *    замороженный);
 * 3. на балансе осталось 2–4 тренировки (действующий или замороженный; у
 *    пакета персональных — персональных).
 *
 * У каждого такого абонемента должен быть комментарий по клиенту не старше
 * 7 дней — та же лента, что в колонке «Комментарии» «Абонементов» (о клиенте
 * и всех его абонементах). Нет комментария или последний старше — абонемент
 * в списке. Во 2 и 3 не попадают клиенты, у которых продление уже куплено и
 * ждёт в очереди (абонемент того же вида со статусом «Ожидает»): обсуждать
 * с ними нечего.
 *
 * Здесь — правила и подписи без React и без базы (тест —
 * dashboard-control.test.ts); загрузка — routes/_authenticated/dashboard/control.tsx.
 */

/** Комментарий по клиенту должен быть не старше стольких дней. */
export const CONTROL_COMMENT_DAYS = 7;
/** «Заканчиваются»: сегодня и столько дней вперёд. */
export const CONTROL_ENDING_DAYS = 7;
/** «Мало тренировок»: остаток баланса от и до (включительно). */
export const CONTROL_BALANCE = { min: 2, max: 4 } as const;
/** Абонементы, которые ещё идут: у них срок и остаток что-то значат. */
export const CONTROL_LIVE_STATES = ["active", "frozen"] as const;

export type ControlRuleKey = "overdue" | "ending" | "balance";

export const CONTROL_RULES: Record<
  ControlRuleKey,
  { title: string; tip: string; empty: string; ok: string }
> = {
  overdue: {
    title: "Просроченные платежи",
    tip: `Абонементы с просроченным платежом (в «Абонементах» — фильтр «С просрочкой»), у клиента которых нет комментария за последние ${CONTROL_COMMENT_DAYS} дней. Договоритесь с клиентом и запишите договорённость комментарием.`,
    empty: "Просроченных платежей нет",
    ok: "У всех просроченных платежей есть свежий комментарий",
  },
  ending: {
    title: "Заканчиваются за неделю",
    tip: `Действующие и замороженные абонементы, срок которых заканчивается сегодня или в ближайшие ${CONTROL_ENDING_DAYS} дней, без комментария по клиенту за последние ${CONTROL_COMMENT_DAYS} дней. Клиенты, которые уже купили продление (ждёт в очереди), не попадают.`,
    empty: "На этой неделе абонементы не заканчиваются",
    ok: "У всех заканчивающихся абонементов есть свежий комментарий",
  },
  balance: {
    title: `Осталось ${CONTROL_BALANCE.min}–${CONTROL_BALANCE.max} тренировки`,
    tip: `Действующие и замороженные абонементы, на балансе которых осталось от ${CONTROL_BALANCE.min} до ${CONTROL_BALANCE.max} тренировок (у пакета персональных — персональных), без комментария по клиенту за последние ${CONTROL_COMMENT_DAYS} дней. Клиенты, которые уже купили продление (ждёт в очереди), не попадают.`,
    empty: `Абонементов с остатком ${CONTROL_BALANCE.min}–${CONTROL_BALANCE.max} нет`,
    ok: "У всех абонементов с малым остатком есть свежий комментарий",
  },
};

export const CONTROL_RULE_ORDER: ControlRuleKey[] = ["overdue", "ending", "balance"];

/** Платёж из client_packages_list.payments. */
export type ControlPayment = {
  amount: number | string;
  due_date: string;
  paid: boolean;
  refunded?: boolean | null;
};

/** Строка client_packages_list, нужная блоку. */
export type ControlSale = {
  id: string;
  client_id: string;
  studio_name: string | null;
  clients: {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email?: string | null;
  } | null;
  memberships: {
    name: string | null;
    kind: string | null;
    visits_count: number | null;
    personal_count: number | null;
  } | null;
  membership_state: string | null;
  ends_at: string | null;
  balance_left: number | null;
  payments: ControlPayment[] | null;
};

/** Ждущее в очереди продление: чей и какого вида. */
export type QueuedRenewal = { client_id: string; memberships: { kind: string | null } | null };

/** Вид баланса: пакет персональных списывается отдельно от групповых. */
function balanceKind(kind: string | null | undefined) {
  return kind === "personal" ? "personal" : "group";
}

/** Клиенты с купленным продлением — по виду баланса. */
export function renewedKeys(queued: QueuedRenewal[]): Set<string> {
  return new Set(queued.map((q) => `${q.client_id}:${balanceKind(q.memberships?.kind)}`));
}

export function isRenewed(sale: ControlSale, renewed: Set<string>) {
  return renewed.has(`${sale.client_id}:${balanceKind(sale.memberships?.kind)}`);
}

/** Окно «заканчиваются»: сегодня … сегодня + 7. */
export function endingWindow(today: string) {
  const to = addDays(parseISO(today), CONTROL_ENDING_DAYS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: today,
    to: `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`,
  };
}

/**
 * Комментарий по клиенту свежий: последний не старше 7 дней по календарю
 * (написан 3-го — 10-го ещё свежий, 11-го уже нет). Перенесённый из прежних
 * полей — без даты, свежим не считается.
 */
export function hasFreshComment(stats: CommentStats | undefined, now = new Date()) {
  if (!stats) return false;
  const age = commentAgeDays(stats.last_at, stats.last_kind, now);
  return age !== null && age <= CONTROL_COMMENT_DAYS;
}

/** Просроченный долг: невнесённые платежи с прошедшей датой и самая ранняя дата. */
export function overdueDebt(payments: ControlPayment[] | null, today: string) {
  let amount = 0;
  let since: string | null = null;
  for (const p of payments ?? []) {
    if (p.paid || p.refunded || p.due_date >= today) continue;
    amount += Number(p.amount ?? 0);
    if (!since || p.due_date < since) since = p.due_date;
  }
  return { amount, since };
}

const DAYS: [string, string, string] = ["день", "дня", "дней"];

/** «на балансе 3 из 8 тренировок» (после «из» — родительный падеж). */
function balanceText(sale: ControlSale) {
  const left = sale.balance_left ?? 0;
  const personal = balanceKind(sale.memberships?.kind) === "personal";
  const total = personal ? sale.memberships?.personal_count : sale.memberships?.visits_count;
  const n = total || left;
  const noun = personal
    ? n === 1
      ? "персональной"
      : "персональных"
    : n === 1
      ? "тренировки"
      : "тренировок";
  return total
    ? `на балансе ${formatNumber(left)} из ${formatNumber(total)} ${noun}`
    : `на балансе ${formatNumber(left)}`;
}

function daysBetween(from: string, to: string) {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

/** Что с абонементом по правилу — строка под именем клиента. */
export function controlFact(rule: ControlRuleKey, sale: ControlSale, today: string): string {
  if (rule === "overdue") {
    const { amount, since } = overdueDebt(sale.payments, today);
    if (!since) return "Просрочен платёж";
    const days = daysBetween(since, today);
    return `Просрочено ${formatMoney(amount)} с ${formatDate(since)} (${formatNumber(days)} ${plural(days, DAYS)})`;
  }
  if (rule === "ending") {
    if (!sale.ends_at) return "Без срока";
    const days = daysBetween(today, sale.ends_at);
    const when =
      days <= 0
        ? "сегодня"
        : days === 1
          ? "завтра"
          : `через ${formatNumber(days)} ${plural(days, DAYS)}`;
    const left = sale.balance_left === null ? "" : ` · ${balanceText(sale)}`;
    return `Заканчивается ${when}, ${formatDate(sale.ends_at)}${left}`;
  }
  const text = balanceText(sale);
  const ends = sale.ends_at ? ` · до ${formatDate(sale.ends_at)}` : "";
  return `${text[0].toUpperCase()}${text.slice(1)}${ends}`;
}

/** Как давно писали клиенту — для чипа строки. */
export function commentLag(stats: CommentStats | undefined, now = new Date()): string {
  if (!stats) return "Нет комментариев";
  const age = commentAgeDays(stats.last_at, stats.last_kind, now);
  if (age === null) return "Нет комментариев с датой";
  return `Последний ${formatNumber(age)} ${plural(age, DAYS)} назад`;
}

/** Строка списка: абонемент и что с комментарием. */
export type ControlItem = {
  sale: ControlSale;
  /** Комментарий уже свежий (написали, пока страница открыта). */
  done: boolean;
};

/**
 * Строки правила: без свежего комментария, плюс те, что были в списке, пока
 * страница открыта (`seen`), — им только что написали, они остаются с
 * отметкой «Готово», а не пропадают из-под руки. Сверху — без комментариев
 * совсем, дальше — кому писали давнее всего; готовые — внизу.
 */
export function controlItems(
  sales: ControlSale[],
  stats: Map<string, CommentStats>,
  seen: ReadonlySet<string>,
  now = new Date(),
): ControlItem[] {
  const lastAt = (s: ControlSale) => {
    const st = stats.get(s.client_id);
    return !st || st.last_kind === "imported" ? "" : st.last_at;
  };
  return sales
    .map((sale) => ({ sale, done: hasFreshComment(stats.get(sale.client_id), now) }))
    .filter((x) => !x.done || seen.has(x.sale.id))
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        lastAt(a.sale).localeCompare(lastAt(b.sale)) ||
        a.sale.id.localeCompare(b.sale.id),
    );
}

/** «Иванова Анна» — как в таблицах; без имени — full_name. */
export function controlClientName(sale: ControlSale) {
  const c = sale.clients;
  if (!c) return "Клиент удалён";
  return [c.last_name, c.first_name].filter(Boolean).join(" ").trim() || c.full_name || "—";
}

/**
 * Список для буфера обмена (кнопка «Скопировать» в конце блока): заголовок
 * блока и клиенты без свежего комментария — «Имя Фамилия (телефон, почта)»,
 * по строке на клиента (несколько абонементов одного клиента — одна строка).
 * Отмеченные «Готово» не копируются: им уже написали.
 */
export function controlCopyText(title: string, items: ControlItem[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const { sale, done } of items) {
    if (done || seen.has(sale.client_id)) continue;
    seen.add(sale.client_id);
    const c = sale.clients;
    const name = c
      ? [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.full_name || "—"
      : "Клиент удалён";
    const contacts = [formatPhoneDisplay(c?.phone), c?.email?.trim()].filter(Boolean);
    lines.push(contacts.length ? `${name} (${contacts.join(", ")})` : name);
  }
  return [title, ...lines].join("\n");
}
