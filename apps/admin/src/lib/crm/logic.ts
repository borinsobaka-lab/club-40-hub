/**
 * CRM — логика без React: порядок этапов, раскладка сделок по колонкам,
 * состояние задач, подписи событий ленты. Тест — logic.test.ts.
 */
import { replyWindowOpen } from "./meta";

export { replyWindowOpen };
import type { CrmDeal, CrmEvent, CrmStage, CrmTask, StageKind } from "./types";

const KIND_ORDER: Record<StageKind, number> = { open: 0, won: 1, lost: 2 };

/** Этапы воронки: обычные по порядку, затем «Успешно», затем «Не реализовано». */
export function sortStages<T extends Pick<CrmStage, "kind" | "sort_order" | "created_at">>(
  stages: T[],
): T[] {
  return [...stages].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at),
  );
}

export type TaskState = "overdue" | "today" | "future";

/** Состояние невыполненной задачи: просрочена, на сегодня, позже. */
export function taskState(dueAt: string, now: Date): TaskState {
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  return sameDay ? "today" : "future";
}

/** Ближайшая невыполненная задача каждой сделки. */
export function nextTaskByDeal(tasks: Pick<CrmTask, "deal_id" | "due_at" | "done_at">[]) {
  const map = new Map<string, string>();
  for (const t of tasks) {
    if (t.done_at) continue;
    const cur = map.get(t.deal_id);
    if (!cur || t.due_at < cur) map.set(t.deal_id, t.due_at);
  }
  return map;
}

export type DealFilter = {
  search: string;
  /** "" — все, "none" — без ответственного, иначе id. */
  responsible: string;
  /** "" — все, "none" — без клуба, иначе id. */
  studio: string;
  /** Только сделки без невыполненных задач. */
  noTasks: boolean;
};

export const EMPTY_FILTER: DealFilter = { search: "", responsible: "", studio: "", noTasks: false };

const digits = (s: string) => s.replace(/\D/g, "");

export function filterDeals(
  deals: CrmDeal[],
  filter: DealFilter,
  nextTask: Map<string, string>,
): CrmDeal[] {
  const term = filter.search.trim().toLowerCase();
  const termDigits = digits(term);
  return deals.filter((d) => {
    if (
      filter.responsible === "none"
        ? d.responsible_id
        : filter.responsible && d.responsible_id !== filter.responsible
    )
      return false;
    if (filter.studio === "none" ? d.studio_id : filter.studio && d.studio_id !== filter.studio)
      return false;
    if (filter.noTasks && nextTask.has(d.id)) return false;
    if (!term) return true;
    const hay = [d.title, d.contact?.name, d.contact?.email, d.source, ...d.tags]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (hay.includes(term)) return true;
    return termDigits.length >= 3 && digits(d.contact?.phone ?? "").includes(termDigits);
  });
}

/** Сделки по этапам; в колонке — сначала недавно вошедшие в этап. */
export function groupByStage(deals: CrmDeal[]): Map<string, CrmDeal[]> {
  const map = new Map<string, CrmDeal[]>();
  for (const d of [...deals].sort((a, b) => b.stage_entered_at.localeCompare(a.stage_entered_at))) {
    const list = map.get(d.stage_id);
    if (list) list.push(d);
    else map.set(d.stage_id, [d]);
  }
  return map;
}

export function sumBudget(deals: Pick<CrmDeal, "budget">[]): number {
  return deals.reduce((s, d) => s + (d.budget ?? 0), 0);
}

/** Бюджет из поля: пусто — null, не число или меньше нуля — undefined (ошибка). */
export function parseBudget(raw: string): number | null | undefined {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Теги из строки через запятую: без пустых и повторов (без учёта регистра). */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim().replace(/^#/, "");
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Текст события ленты (комментарий — его текст рисует лента сама). */
export function eventText(e: Pick<CrmEvent, "kind" | "body" | "meta">): string {
  const m = e.meta ?? {};
  switch (e.kind) {
    case "created":
      return m.stage ? `Сделка создана в этапе «${m.stage}»` : "Сделка создана";
    case "stage": {
      const reason = m.reason ? ` Причина: ${m.reason}.` : "";
      return `Этап: «${m.from ?? "—"}» → «${m.to ?? "—"}».${reason}`.trim();
    }
    case "pipeline":
      return `Воронка: «${m.from ?? "—"}» → «${m.to ?? "—"}», этап «${m.stage ?? "—"}»`;
    case "responsible":
      return m.to
        ? `Ответственный: ${m.from ? `${m.from} → ` : ""}${m.to}`
        : `Ответственный снят${m.from ? ` (был ${m.from})` : ""}`;
    case "task_done":
      return `Задача выполнена${m.type ? ` (${m.type})` : ""}: ${e.body ?? ""}${
        m.result ? ` — ${m.result}` : ""
      }`.trim();
    case "auto":
      return `Автоматизация: ${e.body ?? ""}`;
    default:
      return e.body ?? "";
  }
}

/** «2 дня», «5 ч», «только что» — сколько сделка в этапе. */
export function ageLabel(since: string, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (min < 60) return min < 5 ? "только что" : `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} дн`;
}

/** Срок задачи для поля datetime-local по умолчанию: завтра в 10:00. */
export function defaultTaskDue(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

/** Новый порядок id после перетаскивания строки на место другой. */
export function reorderIds(
  ids: string[],
  sourceId: string,
  targetId: string,
  after: boolean,
): string[] {
  const rest = ids.filter((id) => id !== sourceId);
  const at = rest.indexOf(targetId);
  if (at < 0) return ids;
  rest.splice(after ? at + 1 : at, 0, sourceId);
  return rest;
}

/** Значение «не выбрано» в выпадающих списках (у Radix пустого значения нет). */
export const NONE = "none";

/** Срок задачи: «сегодня 14:00» или «18 нояб., 10:00». */
export function formatDue(dueAt: string, now: Date): string {
  const d = new Date(dueAt);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return taskState(dueAt, now) === "today"
    ? `сегодня ${time}`
    : d.toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

// Переписка --------------------------------------------------------------------

export const CHANNEL_LABEL: Record<string, string> = {
  telegram_bot: "Telegram-бот",
  telegram_user: "Telegram",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

/** Подпись диалога: «Telegram-бот · Ваке» — в какой аккаунт пишет человек. */
export function accountLabel(account: { kind: string; name: string } | undefined | null): string {
  if (!account) return "Канал";
  const kind = CHANNEL_LABEL[account.kind] ?? account.kind;
  return account.name && account.name !== kind ? `${kind} · ${account.name}` : kind;
}

/** Переменные шаблона ответа: {имя} — имя контакта, {клуб} — клуб аккаунта. */
export function fillTemplate(
  body: string,
  vars: { name?: string | null; studio?: string | null },
): string {
  const first = (vars.name ?? "").trim().split(/\s+/)[0] ?? "";
  return body
    .replace(/\{имя\}/gi, first)
    .replace(/\{клуб\}/gi, vars.studio ?? "")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/,\s*([!.?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Время сообщения в списке диалогов: сегодня — «14:05», иначе «12 нояб.». */
export function shortTime(iso: string | null, now: Date): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Сообщения по дням — заголовки «Сегодня», «Вчера», «12 ноября». */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function fileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

// Автоматизации этапов -----------------------------------------------------------

export type DurationUnit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** Минуты → самое крупное целое: 120 → 2 часа, 90 → 90 минут. */
export function splitDuration(minutes: number): { value: number; unit: DurationUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

export function joinDuration(value: number, unit: DurationUnit): number {
  return Math.max(0, Math.round(value)) * UNIT_MINUTES[unit];
}

export function plural(n: number, one: string, few: string, many: string) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

/** «2 часа», «15 минут», «3 дня». */
export function durationLabel(minutes: number): string {
  const { value, unit } = splitDuration(minutes);
  if (unit === "days") return `${value} ${plural(value, "день", "дня", "дней")}`;
  if (unit === "hours") return `${value} ${plural(value, "час", "часа", "часов")}`;
  return `${value} ${plural(value, "минуту", "минуты", "минут")}`;
}

/** Правило одной строкой: «Сразу при входе в этап → задача «Позвонить»». */
export function automationLabel(
  a: {
    trigger: string;
    delay_minutes: number;
    action: string;
    params: {
      title?: string;
      assignee?: string;
      user_ids?: string[];
      stage_id?: string;
      body?: string;
      tag?: string;
    };
  },
  names: { stage: (id: string) => string; person: (id: string) => string },
): string {
  const PORTAL: Record<string, string> = {
    trial_sale: "Куплено пробное",
    booked: "Клиент записан на занятие",
    attended: "Клиент посетил занятие",
  };
  const when =
    a.trigger in PORTAL
      ? a.delay_minutes > 0
        ? `${PORTAL[a.trigger]}, через ${durationLabel(a.delay_minutes)}`
        : PORTAL[a.trigger]
      : a.trigger === "inbound"
        ? "Клиент написал"
        : a.trigger === "no_reply"
          ? `Клиент не ответил ${durationLabel(a.delay_minutes)}`
          : a.delay_minutes > 0
            ? `Через ${durationLabel(a.delay_minutes)} в этапе`
            : "Сразу при входе в этап";
  const p = a.params;
  const ids = p.user_ids ?? [];
  const what =
    a.action === "task"
      ? `задача «${p.title ?? ""}»${
          p.assignee && p.assignee !== "responsible" ? ` для ${names.person(p.assignee)}` : ""
        }`
      : a.action === "responsible"
        ? ids.length > 1
          ? `ответственный по очереди: ${ids.map(names.person).join(", ")}`
          : `ответственный: ${ids.map(names.person).join("")}`
        : a.action === "move"
          ? `перевести в этап «${names.stage(p.stage_id ?? "")}»`
          : a.action === "message"
            ? `сообщение клиенту «${(p.body ?? "").slice(0, 60)}${(p.body ?? "").length > 60 ? "…" : ""}»`
            : `тег #${p.tag ?? ""}`;
  return `${when} → ${what}`;
}

// Отчёт -------------------------------------------------------------------------

/** Доля в процентах, целым: 1 из 3 → 33; деление на ноль → null. */
export function percent(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

/** Минуты ожидания ответа: «12 мин», «1 ч 30 мин», «2 дн». */
export function waitLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${Math.max(m, 1)} мин`;
  if (m < 1440) return m % 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m / 60} ч`;
  return `${Math.round(m / 1440)} дн`;
}

/** Почему в диалог нельзя ответить (вместо поля ввода); null — можно. */
export function replyBlock(
  account: { kind: string; status: string } | undefined | null,
  lastInboundAt: string | null,
  now: Date = new Date(),
): string | null {
  if (!account) return null;
  if (account.status === "disabled") return "Аккаунт канала отключён — ответить нельзя.";
  if (!replyWindowOpen(account.kind, lastInboundAt, now))
    return account.kind === "whatsapp"
      ? "Прошло больше 24 часов с последнего сообщения клиента — WhatsApp пропустит только одобренный шаблон."
      : "Прошло больше 7 дней с последнего сообщения клиента. По правилам канала ответить можно, когда он напишет снова.";
  return null;
}

// Задачи -------------------------------------------------------------------------

export type TaskGroup = "overdue" | "today" | "tomorrow" | "later";

export const TASK_GROUP_LABEL: Record<TaskGroup, string> = {
  overdue: "Просрочено",
  today: "Сегодня",
  tomorrow: "Завтра",
  later: "Позже",
};

/** Группа невыполненной задачи по сроку. */
export function taskGroup(dueAt: string, now: Date): TaskGroup {
  const state = taskState(dueAt, now);
  if (state !== "future") return state;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return new Date(dueAt).toDateString() === tomorrow.toDateString() ? "tomorrow" : "later";
}

export type DuePreset = "in15" | "in1h" | "evening" | "tomorrow" | "in3d" | "week";

export const DUE_PRESETS: { key: DuePreset; label: string }[] = [
  { key: "in15", label: "Через 15 мин" },
  { key: "in1h", label: "Через час" },
  { key: "evening", label: "Сегодня вечером" },
  { key: "tomorrow", label: "Завтра" },
  { key: "in3d", label: "Через 3 дня" },
  { key: "week", label: "Через неделю" },
];

/** Срок по быстрой кнопке; «завтра» и дальше — в 10:00, «вечером» — в 18:00. */
export function presetDue(preset: DuePreset, now: Date): Date {
  const d = new Date(now);
  const at = (days: number, hour: number) => {
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  switch (preset) {
    case "in15":
      return new Date(now.getTime() + 15 * 60_000);
    case "in1h":
      return new Date(now.getTime() + 60 * 60_000);
    case "evening":
      // Уже вечер — через час, а не в прошлое.
      return now.getHours() >= 17 ? new Date(now.getTime() + 60 * 60_000) : at(0, 18);
    case "tomorrow":
      return at(1, 10);
    case "in3d":
      return at(3, 10);
    default:
      return at(7, 10);
  }
}

// Шаблоны WhatsApp ----------------------------------------------------------------

export const WA_STATUS_LABEL: Record<string, string> = {
  PENDING: "на проверке",
  APPROVED: "одобрен",
  REJECTED: "отклонён",
  PAUSED: "приостановлен",
  DISABLED: "отключён Meta",
  IN_APPEAL: "апелляция",
  PENDING_DELETION: "удаляется",
};

export const WA_VAR_LABEL: Record<string, string> = { name: "имя", studio: "клуб", text: "текст" };

/**
 * Текст шаблона для Meta: наши {имя} и {клуб} и свободные {текст} — в
 * позиционные {{1}}, {{2}}… (одна и та же переменная — один номер, каждый
 * {текст} — свой). vars — что подставлять в каждый номер.
 */
export function toWaTemplate(body: string): { body: string; vars: string[] } {
  const vars: string[] = [];
  const out = body.replace(/\{(имя|клуб|текст)\}/gi, (_, raw: string) => {
    const key =
      raw.toLowerCase() === "имя" ? "name" : raw.toLowerCase() === "клуб" ? "studio" : "text";
    let index = key === "text" ? -1 : vars.indexOf(key);
    if (index < 0) {
      vars.push(key);
      index = vars.length - 1;
    }
    return `{{${index + 1}}}`;
  });
  return { body: out, vars };
}

/** Обратно — для показа: {{1}} → {имя}. */
export function fromWaTemplate(body: string, vars: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (m, n: string) => {
    const v = vars[Number(n) - 1];
    return v ? `{${WA_VAR_LABEL[v] ?? v}}` : m;
  });
}

/** Текст сообщения с подставленными значениями. */
export function renderWaTemplate(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (m, n: string) => values[Number(n) - 1] || m);
}

/** Сколько переменных {{n}} в тексте шаблона (наибольший номер). */
export function waVarCount(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Значения переменных по умолчанию: имя контакта (первое слово), клуб. */
export function waDefaultValues(
  vars: string[],
  count: number,
  ctx: { name?: string | null; studio?: string | null },
): string[] {
  return Array.from({ length: Math.max(count, vars.length) }, (_, i) =>
    vars[i] === "name"
      ? ((ctx.name ?? "").trim().split(/\s+/)[0] ?? "")
      : vars[i] === "studio"
        ? (ctx.studio ?? "")
        : "",
  );
}

/** Правила Meta к тексту шаблона; null — годится. */
export function waBodyProblem(body: string): string | null {
  const text = body.trim();
  if (!text) return "Напишите текст шаблона";
  if (text.length > 1024) return "Текст длиннее 1024 знаков";
  if (/^\{\{\d+\}\}/.test(text) || /\{\{\d+\}\}$/.test(text))
    return "Текст не может начинаться или заканчиваться переменной — добавьте слова до и после";
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(text)) return "Между двумя переменными должен быть текст";
  return null;
}

/** Имя шаблона для Meta из названия: латиница, цифры и «_». */
export function waTemplateName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Номер для WhatsApp: только цифры с кодом страны («5XX…» — грузинский). */
export function waPhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.length === 9 && d.startsWith("5") ? `995${d}` : d;
}

// Скорость ответа (db/migrations/2026-11-19_crm_reply_sla_notifications.sql) ------

export type CrmSettings = {
  reply_sla_minutes: number;
  escalate_minutes: number | null;
  work_from: number;
  work_to: number;
};

export const DEFAULT_CRM_SETTINGS: CrmSettings = {
  reply_sla_minutes: 15,
  escalate_minutes: 60,
  work_from: 9,
  work_to: 21,
};

/** Тбилиси — без перевода часов, всегда UTC+4. */
const TBILISI_OFFSET_MS = 4 * 3_600_000;

/**
 * С какого момента сообщение «ждёт»: в рабочие часы — сразу, иначе с
 * ближайшего открытия (как crm_work_start в базе).
 */
export function workStart(at: Date, s: Pick<CrmSettings, "work_from" | "work_to">): Date {
  const local = new Date(at.getTime() + TBILISI_OFFSET_MS);
  const hour = local.getUTCHours();
  if (hour >= s.work_from && hour < s.work_to) return at;
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const opens = day + s.work_from * 3_600_000 + (hour >= s.work_to ? 86_400_000 : 0);
  return new Date(opens - TBILISI_OFFSET_MS);
}

/** Сколько минут клиент ждёт ответа в рабочее время; null — не ждёт. */
export function waitingMinutes(
  waitingSince: string | null | undefined,
  now: Date,
  s: Pick<CrmSettings, "work_from" | "work_to">,
): number | null {
  if (!waitingSince) return null;
  const from = workStart(new Date(waitingSince), s);
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
}

export type WaitTone = "ok" | "late" | "critical";

/** В нормативе, дольше норматива, дольше срока эскалации. */
export function waitTone(minutes: number, s: CrmSettings): WaitTone {
  if (s.escalate_minutes !== null && minutes >= s.escalate_minutes) return "critical";
  return minutes >= s.reply_sla_minutes ? "late" : "ok";
}

// Сценарии по клиентам клуба (db/migrations/2026-11-19_zz_crm_scenarios.sql) -------

export type ScenarioKey =
  | "expiring"
  | "trial_no_purchase"
  | "inactive"
  | "lapsed"
  | "overdue_payment";

export const SCENARIOS: Record<
  ScenarioKey,
  { label: string; hint: string; daysLabel: string; closes: string }
> = {
  expiring: {
    label: "Продление",
    hint: "Абонемент скоро закончится — по сроку или по остатку тренировок, а продление ещё не куплено.",
    daysLabel: "Дней до конца срока",
    closes: "Закроется сама, когда клиент купит абонемент.",
  },
  trial_no_purchase: {
    label: "После пробного",
    hint: "Клиент был на пробном занятии и не купил абонемент.",
    daysLabel: "Дней после пробного",
    closes: "Закроется сама, когда клиент купит абонемент.",
  },
  inactive: {
    label: "Давно не был",
    hint: "Абонемент действует, но клиент не приходит и не записан на занятия.",
    daysLabel: "Дней без посещений",
    closes: "Закроется сама, когда клиент придёт на занятие или купит абонемент.",
  },
  lapsed: {
    label: "Возврат",
    hint: "Абонемент закончился, нового клиент не купил (не старше 90 дней).",
    daysLabel: "Дней после окончания",
    closes: "Закроется сама, когда клиент купит абонемент.",
  },
  overdue_payment: {
    label: "Долг по оплате",
    hint: "Платёж по рассрочке просрочен.",
    daysLabel: "Дней просрочки",
    closes: "Закроется сама, когда платёж внесут.",
  },
};

export const scenarioLabel = (key: string | null | undefined) =>
  (key && SCENARIOS[key as ScenarioKey]?.label) || "Сценарий";

/** «Когда срабатывает» — строкой с текущими параметрами. */
export function scenarioRule(key: ScenarioKey, params: { days?: number; left?: number }): string {
  const days = params.days ?? 0;
  const dn = `${days} ${plural(days, "день", "дня", "дней")}`;
  switch (key) {
    case "expiring":
      return `До конца срока ${days === 0 ? "сегодня" : `≤ ${dn}`} или осталось ≤ ${params.left ?? 0} ${plural(params.left ?? 0, "тренировка", "тренировки", "тренировок")}`;
    case "trial_no_purchase":
      return `Прошло ${dn} после пробного, абонемент не куплен`;
    case "inactive":
      return `Не был ${dn} и не записан`;
    case "lapsed":
      return `Абонемент закончился ${dn} назад, нового нет`;
    case "overdue_payment":
      return `Платёж просрочен на ${dn}`;
  }
}

// Сквозная воронка (db/migrations/2026-11-19_zzz_crm_sources_funnel.sql) -----------

export type FunnelGroup = "source" | "campaign" | "studio" | "responsible";

export const FUNNEL_GROUPS: { value: FunnelGroup; label: string }[] = [
  { value: "source", label: "Источники" },
  { value: "campaign", label: "Кампании" },
  { value: "studio", label: "Клубы" },
  { value: "responsible", label: "Сотрудники" },
];

export type FunnelRow = {
  gkey?: string;
  label?: string;
  leads: number;
  replied: number;
  booked: number;
  attended: number;
  trial: number;
  won: number;
  lost: number;
  revenue: number;
  ltv: number;
  spend: number;
};

/** Цена заявки и клиента, окупаемость; null — считать не из чего. */
export function funnelMoney(row: Pick<FunnelRow, "leads" | "won" | "ltv" | "spend">) {
  const spend = Number(row.spend) || 0;
  return {
    /** Стоимость заявки. */
    cpl: spend > 0 && row.leads > 0 ? spend / row.leads : null,
    /** Стоимость клиента (купившего). */
    cac: spend > 0 && row.won > 0 ? spend / row.won : null,
    /** Окупаемость: (выручка − расход) / расход, %. */
    romi: spend > 0 ? Math.round(((Number(row.ltv) - spend) / spend) * 100) : null,
  };
}

/** Шаги воронки по порядку: подпись и число. */
export function funnelSteps(row: FunnelRow): { key: string; label: string; count: number }[] {
  return [
    { key: "leads", label: "Заявки", count: row.leads },
    { key: "replied", label: "Ответили", count: row.replied },
    { key: "booked", label: "Записаны", count: row.booked },
    { key: "attended", label: "Пришли", count: row.attended },
    { key: "won", label: "Купили", count: row.won },
  ];
}

/** Первое число месяца даты yyyy-MM-dd. */
export const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;

/** «Ноябрь 2026» по первому числу месяца. */
export function monthLabel(month: string): string {
  const names = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ];
  const [y, m] = month.split("-").map(Number);
  return `${names[(m || 1) - 1]} ${y}`;
}
