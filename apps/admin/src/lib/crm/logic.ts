/**
 * CRM — логика без React: порядок этапов, раскладка сделок по колонкам,
 * состояние задач, подписи событий ленты. Тест — logic.test.ts.
 */
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
      return `Задача выполнена: ${e.body ?? ""}`.trim();
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
