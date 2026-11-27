import { msg } from "@/i18n/translate";
import { BEND_NOT_REACH } from "./options";

/**
 * Динамика диагностик клиента (чистая логика, тест — metrics.test.ts):
 * какие показатели меняются, ряды для графиков, изменение между первой и
 * последней диагностикой и «лучше / хуже».
 */

export type MetricKey =
  | "waist_cm"
  | "hips_cm"
  | "chest_cm"
  | "weight_kg"
  | "split_right_cm"
  | "split_left_cm"
  | "split_middle_cm"
  | "bend_gap_cm"
  | "emotional_level"
  | "activity_level";

export type Metric = {
  key: MetricKey;
  label: string;
  unit: "cm" | "kg" | "score";
  /**
   * Какое изменение — к лучшему. null — нейтрально: объёмы и вес у каждой
   * свои цели (кто-то худеет, кто-то набирает мышцы), не судим.
   */
  better: "lower" | "higher" | null;
};

export const METRICS: Record<MetricKey, Metric> = {
  waist_cm: { key: "waist_cm", label: msg("Талия"), unit: "cm", better: null },
  hips_cm: { key: "hips_cm", label: msg("Бёдра"), unit: "cm", better: null },
  chest_cm: { key: "chest_cm", label: msg("Грудь"), unit: "cm", better: null },
  weight_kg: { key: "weight_kg", label: msg("Вес"), unit: "kg", better: null },
  split_right_cm: {
    key: "split_right_cm",
    label: msg("Правый шпагат"),
    unit: "cm",
    better: "lower",
  },
  split_left_cm: { key: "split_left_cm", label: msg("Левый шпагат"), unit: "cm", better: "lower" },
  split_middle_cm: {
    key: "split_middle_cm",
    label: msg("Поперечный шпагат"),
    unit: "cm",
    better: "lower",
  },
  bend_gap_cm: { key: "bend_gap_cm", label: msg("Наклон вперёд"), unit: "cm", better: "lower" },
  emotional_level: {
    key: "emotional_level",
    label: msg("Эмоциональное состояние"),
    unit: "score",
    better: "higher",
  },
  activity_level: {
    key: "activity_level",
    label: msg("Активность"),
    unit: "score",
    better: "higher",
  },
};

/** Графики: показатели одной шкалы — на одном графике (не больше трёх линий). */
export const CHART_GROUPS: { key: string; label: string; metrics: MetricKey[] }[] = [
  { key: "volumes", label: msg("Объёмы"), metrics: ["waist_cm", "hips_cm", "chest_cm"] },
  { key: "weight", label: msg("Вес"), metrics: ["weight_kg"] },
  {
    key: "splits",
    label: msg("Шпагаты"),
    metrics: ["split_right_cm", "split_left_cm", "split_middle_cm"],
  },
  { key: "bend", label: msg("Наклон"), metrics: ["bend_gap_cm"] },
  { key: "wellbeing", label: msg("Самочувствие"), metrics: ["emotional_level", "activity_level"] },
];

/** Что нужно от диагностики для динамики. */
export type DiagnosticPoint = {
  id: string;
  diagnostic_date: string;
  chest_cm: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  weight_kg: number | null;
  split_right_cm: number | null;
  split_left_cm: number | null;
  split_middle_cm: number | null;
  forward_bend: string | null;
  forward_bend_cm: number | null;
  emotional_level: number | null;
  activity_level: number | null;
};

/**
 * Значение показателя. Наклон — сантиметры до пола: «пальцы касаются» и
 * «ладони на полу» — 0 (до пола достаёт), «не достаёт» без сантиметров —
 * нет значения.
 */
export function metricValue(d: DiagnosticPoint, key: MetricKey): number | null {
  if (key === "bend_gap_cm") {
    if (!d.forward_bend) return null;
    if (d.forward_bend === BEND_NOT_REACH) return d.forward_bend_cm ?? null;
    return 0;
  }
  const v = d[key];
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

export type SeriesPoint = { id: string; date: string; value: number };

/** Ряд показателя по диагностикам (по дате), без пустых. */
export function metricSeries(list: DiagnosticPoint[], key: MetricKey): SeriesPoint[] {
  return sortByDate(list).flatMap((d) => {
    const value = metricValue(d, key);
    return value == null ? [] : [{ id: d.id, date: d.diagnostic_date, value }];
  });
}

export function sortByDate<T extends { diagnostic_date: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.diagnostic_date.localeCompare(b.diagnostic_date));
}

export type Trend = "better" | "worse" | "same" | "changed";

export type MetricChange = {
  key: MetricKey;
  first: SeriesPoint;
  last: SeriesPoint;
  /** last − first, округлено до десятых. */
  diff: number;
  trend: Trend;
};

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Изменение показателя от первой до последней диагностики, где он есть (нужно ≥ 2). */
export function metricChange(list: DiagnosticPoint[], key: MetricKey): MetricChange | null {
  const s = metricSeries(list, key);
  if (s.length < 2) return null;
  const first = s[0];
  const last = s[s.length - 1];
  const diff = round1(last.value - first.value);
  return { key, first, last, diff, trend: trendOf(METRICS[key].better, diff) };
}

/** Изменение к предыдущему значению (карточка одной диагностики). */
export function changeFromPrevious(
  list: DiagnosticPoint[],
  id: string,
  key: MetricKey,
): { diff: number; trend: Trend } | null {
  const s = metricSeries(list, key);
  const i = s.findIndex((p) => p.id === id);
  if (i <= 0) return null;
  const diff = round1(s[i].value - s[i - 1].value);
  return { diff, trend: trendOf(METRICS[key].better, diff) };
}

export function trendOf(better: Metric["better"], diff: number): Trend {
  if (diff === 0) return "same";
  if (!better) return "changed";
  return diff < 0 === (better === "lower") ? "better" : "worse";
}

/** Группы графиков, где хоть один показатель есть хотя бы в двух диагностиках. */
export function chartGroupsWithData(list: DiagnosticPoint[]) {
  return CHART_GROUPS.map((g) => ({
    ...g,
    metrics: g.metrics.filter((k) => metricSeries(list, k).length >= 2),
  })).filter((g) => g.metrics.length > 0);
}

/**
 * Строки графика: одна на диагностику (по дате), колонка на показатель
 * (нет значения — undefined, линия соединяет соседние точки).
 */
export function chartRows(list: DiagnosticPoint[], keys: MetricKey[]) {
  return sortByDate(list)
    .map((d) => {
      const row: { id: string; date: string } & Partial<Record<MetricKey, number>> = {
        id: d.id,
        date: d.diagnostic_date,
      };
      let any = false;
      for (const k of keys) {
        const v = metricValue(d, k);
        if (v != null) {
          row[k] = v;
          any = true;
        }
      }
      return any ? row : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/** Все показатели с изменением (≥ 2 значения), в порядке METRICS. */
export function allChanges(list: DiagnosticPoint[]): MetricChange[] {
  return (Object.keys(METRICS) as MetricKey[])
    .map((k) => metricChange(list, k))
    .filter((c): c is MetricChange => c !== null);
}

/** «−4», «+1,5», «0» — знак всегда, кроме нуля (десятичный разделитель — снаружи). */
export function signed(diff: number, format: (n: number) => string = String) {
  if (diff === 0) return format(0);
  return `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))}`;
}
