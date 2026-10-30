/**
 * «Аудиоаналитика» — логика без React: время на часах студии, длительности,
 * стоимость, статусы смен и доступные действия, периоды дашборда и сравнение
 * с прошлым, подписи метрик, версии сборок, ошибки базы. Тест — logic.test.ts.
 */
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";

import type { StatusTone } from "@/components/ui/status-chip-styles";
import type { AaAgreementStatus, AaDay, AaMetricStat, AaStatus } from "./types";

export const DEFAULT_TIMEZONE = "Asia/Tbilisi";

// --- Время и длительности ------------------------------------------------------

/**
 * Время разговора на часах студии: начало смены (created_at) плюс смещение в
 * записи. Запись идёт по часам — паузы пишутся тишиной, поэтому сумма и есть
 * настоящее время у стойки.
 */
export function clockTime(
  startedAt: string | null | undefined,
  offsetS: number,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!startedAt) return "";
  const ms = new Date(startedAt).getTime();
  if (Number.isNaN(ms)) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(new Date(ms + offsetS * 1000));
  } catch {
    return clockTime(startedAt, offsetS, DEFAULT_TIMEZONE);
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Смещение в записи: «05:09», «1:05:09». */
export function formatOffset(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Длительность словами: «5 ч 12 мин», «12 мин», «40 с». */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Часы речи с одной цифрой после запятой: «12,4 ч». */
export function formatHours(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  return `${(seconds / 3600).toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ч`;
}

/** Стоимость обработки в долларах, три знака: «$0.123». */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  return `$${usd.toFixed(3)}`;
}

/** Конверсия долей → «23%». */
export function formatConversion(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Размер файла: «850 КБ», «12,3 МБ». */
export function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  return `${(mb / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ГБ`;
}

/** Метки времени, которые промпты просят у модели: [ЧЧ:ММ:СС] или [ММ:СС]. */
const CUE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

export function cueSeconds(stamp: string): number {
  return stamp.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

export type CuePart = { text: string } | { cue: string; seconds: number };

/** Текст разбора по кусочкам: метки времени — отдельно (кнопки «слушать»). */
export function splitCues(text: string): CuePart[] {
  const parts: CuePart[] = [];
  let last = 0;
  for (const m of text.matchAll(CUE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ cue: m[1], seconds: cueSeconds(m[1]) });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// --- Статусы и действия смены -------------------------------------------------------

export function statusView(status: AaStatus, stale: boolean): { label: string; tone: StatusTone } {
  if (stale) return { label: "Разбор завис", tone: "negative" };
  switch (status) {
    case "recording":
      return { label: "Идёт запись", tone: "info" };
    case "uploaded":
      return { label: "Ждёт разбора", tone: "warning" };
    case "queued":
      return { label: "В очереди", tone: "info" };
    case "processing":
      return { label: "Разбирается", tone: "info" };
    case "done":
      return { label: "Готово", tone: "positive" };
    case "error":
      return { label: "Ошибка", tone: "negative" };
  }
}

/** Разбор завис: в очереди или в работе, а статус не двигался 3 часа (как aa_is_stale). */
export function isStale(status: AaStatus, changedAt: string | null | undefined, now = Date.now()) {
  if (status !== "queued" && status !== "processing") return false;
  const t = changedAt ? new Date(changedAt).getTime() : NaN;
  return Number.isFinite(t) && now - t > 3 * 3600 * 1000;
}

/** Разбор ещё идёт — список смен обновляется сам. */
export function isInFlight(d: Pick<AaDay, "status" | "stale">): boolean {
  return (d.status === "queued" || d.status === "processing") && !d.stale;
}

export type DayActions = {
  /** «Обработать» (или «Запустить заново» у зависшей / с ошибкой). */
  process: "process" | "restart" | null;
  /** «Пересчитать» — у разобранной: расшифровка берётся с прошлого раза. */
  recalc: boolean;
  /** «Распознать заново» — платное распознавание речи. */
  full: boolean;
  forceFinish: boolean;
  remove: boolean;
};

/** Что можно сделать со сменой (право «настройки» проверяет страница). */
export function dayActions(status: AaStatus, stale: boolean): DayActions {
  return {
    process: status === "uploaded" ? "process" : status === "error" || stale ? "restart" : null,
    recalc: status === "done",
    full: status === "done" || status === "error" || stale,
    forceFinish: status === "recording",
    remove: status !== "processing" || stale,
  };
}

// --- Метрики ----------------------------------------------------------------------

/** Цвет оценки: зелёная от 70% шкалы, жёлтая от 50%, ниже — красная. */
export function scoreTone(score: number | null | undefined, scale: number): StatusTone {
  if (score == null || !scale) return "neutral";
  const r = score / scale;
  return r >= 0.7 ? "positive" : r >= 0.5 ? "warning" : "negative";
}

/** Оценка с одной цифрой после запятой, без лишнего нуля: «7.2», «8». */
export function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(Number(score))) return "—";
  const n = Math.round(Number(score) * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Чип метрики в списке смен: «Качество продажи: 4 · ★ 7.2/10». */
export function metricChipText(s: Pick<AaMetricStat, "name" | "triggered" | "avg" | "scale_max">) {
  const head = `${s.name}: ${s.triggered}`;
  return s.avg == null ? head : `${head} · ★ ${formatScore(s.avg)}/${s.scale_max}`;
}

/** Среднее и число срабатываний по оценкам смены. */
export function metricStats(
  evals: {
    metric_id: string;
    metric_name: string;
    scale_max: number;
    position: number;
    applicable: boolean;
    score: number | null;
  }[],
): AaMetricStat[] {
  const by = new Map<string, { s: AaMetricStat; pos: number; sum: number; n: number }>();
  for (const e of evals) {
    const cur = by.get(e.metric_id) ?? {
      s: {
        metric_id: e.metric_id,
        name: e.metric_name,
        scale_max: e.scale_max,
        triggered: 0,
        avg: null,
      },
      pos: e.position,
      sum: 0,
      n: 0,
    };
    if (e.applicable) {
      cur.s.triggered += 1;
      if (e.score != null) {
        cur.sum += e.score;
        cur.n += 1;
      }
    }
    by.set(e.metric_id, cur);
  }
  return [...by.values()]
    .sort((a, b) => a.pos - b.pos || a.s.name.localeCompare(b.s.name))
    .map(({ s, sum, n }) => ({ ...s, avg: n ? Math.round((sum / n) * 10) / 10 : null }));
}

// --- Периоды дашборда ---------------------------------------------------------------

export type PresetKey = "7" | "30" | "month" | "prev-month";
export type Period = { from: string; to: string };

export const PRESETS: { value: PresetKey; label: string }[] = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "month", label: "Этот месяц" },
  { value: "prev-month", label: "Прошлый месяц" },
];

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Готовый период относительно сегодняшней даты (yyyy-MM-dd). */
export function presetPeriod(key: PresetKey, today: string): Period {
  const t = parseISO(today);
  switch (key) {
    case "7":
      return { from: iso(addDays(t, -6)), to: today };
    case "30":
      return { from: iso(addDays(t, -29)), to: today };
    case "month":
      return { from: iso(startOfMonth(t)), to: today };
    case "prev-month": {
      const p = subMonths(t, 1);
      return { from: iso(startOfMonth(p)), to: iso(endOfMonth(p)) };
    }
  }
}

/** Какой готовый период совпадает с выбранным (null — свой). */
export function matchPreset(p: Period, today: string): PresetKey | null {
  return (
    PRESETS.find((x) => {
      const q = presetPeriod(x.value, today);
      return q.from === p.from && q.to === p.to;
    })?.value ?? null
  );
}

/** Предыдущий период такой же длины — как в aa_summary. */
export function previousPeriod(p: Period): Period {
  const len = differenceInCalendarDays(parseISO(p.to), parseISO(p.from)) + 1;
  const to = addDays(parseISO(p.from), -1);
  return { from: iso(addDays(to, -(len - 1))), to: iso(to) };
}

// --- Сравнение с прошлым периодом ---------------------------------------------------

/** Изменение к прошлому периоду: текст и хорошо ли это (null — без оценки). */
export type Delta = { text: string; good: boolean | null } | null;

const flat: Delta = { text: "без изменений", good: null };

/** Счётчики (смены, разговоры, продажи): нет базы — без сравнения. */
export function deltaCount(cur: number, prev: number): Delta {
  if (!prev) return null;
  const diff = cur - prev;
  if (diff === 0) return flat;
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`, good: diff > 0 };
}

/** Конверсия — в процентных пунктах, а не «на сколько процентов выросли проценты». */
export function deltaPoints(cur: number | null, prev: number | null): Delta {
  if (cur == null || prev == null) return null;
  const diff = Math.round((cur - prev) * 100);
  if (diff === 0) return flat;
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} п. п.`, good: diff > 0 };
}

/** Средняя оценка метрики. */
export function deltaScore(cur: number | null, prev: number | null): Delta {
  if (cur == null || prev == null) return null;
  const diff = Math.round((cur - prev) * 10) / 10;
  if (diff === 0) return flat;
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)}`, good: diff > 0 };
}

/** Часы речи — без оценки (больше речи — не хорошо и не плохо). */
export function deltaHours(cur: number, prev: number): Delta {
  if (!prev) return null;
  const diff = Math.round(((cur - prev) / 3600) * 10) / 10;
  if (diff === 0) return flat;
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("ru-RU")} ч`, good: null };
}

/** Рост расходов — не достижение: стрелка вверх, но красная. */
export function deltaCost(cur: number, prev: number): Delta {
  if (!prev) return null;
  const diff = cur - prev;
  if (Math.abs(diff) < 0.0005) return flat;
  return { text: `${diff > 0 ? "+" : "−"}${formatCost(Math.abs(diff))}`, good: diff < 0 };
}

// --- Договорённости ----------------------------------------------------------------

export const AGREEMENT_TONE: Record<AaAgreementStatus, StatusTone> = {
  open: "warning",
  done: "positive",
  missed: "negative",
  cancelled: "neutral",
};

// --- Приложение ------------------------------------------------------------------

/** Сравнение версий «1.2.10» и «1.2.9» по числам; хвост («-beta») — строкой. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    const c =
      Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== ""
        ? nx - ny
        : x.localeCompare(y);
    if (c !== 0) return c > 0 ? 1 : -1;
  }
  return 0;
}

/** Воркер жив, если отзывался последние 2 минуты. */
export function workerAlive(heartbeatAgeS: number | null | undefined): boolean {
  return heartbeatAgeS != null && Number.isFinite(heartbeatAgeS) && heartbeatAgeS < 120;
}

// --- Ошибки базы ------------------------------------------------------------------

const ERRORS: Record<string, string> = {
  aa_forbidden: "Нет прав на это действие в «Аудиоаналитике»",
  aa_not_found: "Не найдено — возможно, уже удалено",
  aa_busy: "Смена уже в очереди на разбор",
  aa_still_recording: "Запись ещё не завершена в приложении",
  aa_not_recording: "Смена уже закрыта",
  aa_no_segments: "На сервер не загружено ни одного сегмента — эту смену можно только удалить",
  aa_empty_prompt: "Промпт пустой",
  aa_empty_text: "Напишите, о чём договорились",
  aa_bad_status: "Неизвестный статус договорённости",
  aa_bad_period: "Неверный период",
  aa_location_has_recordings:
    "На точке есть смены — её можно только закрыть, иначе прошлые отчёты потеряют студию",
};

/**
 * Текст ошибки для человека: у ошибок aa_* база кладёт русское пояснение в
 * hint — его и показываем; иначе — по коду, уникальность, длина.
 */
export function aaErrorText(message: string, hint?: string | null, code?: string | null): string {
  if (hint && hint.trim()) return hint.trim();
  const key = message.trim();
  if (ERRORS[key]) return ERRORS[key];
  if (code === "42501" || /permission denied|row-level security/i.test(message))
    return ERRORS.aa_forbidden;
  if (code === "23505" || /duplicate key/i.test(message)) {
    if (/aa_locations/.test(message)) return "Точка с таким названием уже есть";
    if (/aa_app_releases|platform, version/.test(message)) return "Эта версия уже выложена";
    return "Такая запись уже есть";
  }
  if (/check constraint|value too long/i.test(message))
    return "Слишком длинное или неверное значение";
  return message;
}
