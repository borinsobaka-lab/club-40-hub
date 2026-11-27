/**
 * Результаты диагностики тела во вкладке «Диагностика» карточки клиента
 * (решение владельца 2026-11-27). Заполняет тренер в мобильном приложении,
 * схема — db/migrations/2026-11-27_body_diagnostics.sql; варианты ответов
 * хранятся по-русски (как в форме), поэтому показываются как есть.
 * Чистая логика — тест рядом.
 */

export type BodyDiagnosticRow = {
  id: string;
  diagnostic_date: string;
  studio_id: string | null;
  trainer_name: string | null;
  trainer: { full_name: string | null } | null;
  studio: { name: string | null } | null;
  birth_date: string | null;
  activity_level: number | null;
  emotional_level: number | null;
  emotional_comment: string | null;
  directions: string[] | null;
  no_restrictions: boolean;
  restrictions: string[] | null;
  restrictions_other: string | null;
  goals: string[] | null;
  priority_today: string | null;
  measure_skipped: boolean;
  chest_cm: number | string | null;
  waist_cm: number | string | null;
  hips_cm: number | string | null;
  weight_kg: number | string | null;
  balance_test: string | null;
  balance_comment: string | null;
  forward_bend: string | null;
  forward_bend_cm: number | string | null;
  forward_bend_comment: string | null;
  split_right_cm: number | string | null;
  split_left_cm: number | string | null;
  split_middle_cm: number | string | null;
  photo_paths: string[] | null;
  stage: number | null;
  rec_trainings: string | null;
  rec_directions: string[] | null;
  rec_focus: string | null;
  updated_at: string;
};

export const BODY_DIAGNOSTIC_COLUMNS =
  "id, diagnostic_date, studio_id, trainer_name, birth_date, activity_level, emotional_level, emotional_comment, directions, no_restrictions, restrictions, restrictions_other, goals, priority_today, measure_skipped, chest_cm, waist_cm, hips_cm, weight_kg, balance_test, balance_comment, forward_bend, forward_bend_cm, forward_bend_comment, split_right_cm, split_left_cm, split_middle_cm, photo_paths, stage, rec_trainings, rec_directions, rec_focus, updated_at, trainer:trainers(full_name), studio:studios(name)";

export const DIAGNOSTIC_PHOTO_BUCKET = "body-diagnostics";

export const STAGE_TITLES: Record<number, string> = {
  1: "Адаптационный (20–30 тренировок)",
  2: "Получение результата (30–50 тренировок)",
  3: "Поддержание и сохранение результата (50+ тренировок)",
};

const BEND_NOT_REACH = "До пола не достаёт";

export function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** «64», «60,5». */
export function fmtNum(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

/** Наклон вперёд словами: «Пальцы касаются пола», «12 см до пола». */
export function bendText(d: Pick<BodyDiagnosticRow, "forward_bend" | "forward_bend_cm">) {
  if (!d.forward_bend) return null;
  const cm = num(d.forward_bend_cm);
  return d.forward_bend === BEND_NOT_REACH && cm != null
    ? `${fmtNum(cm)} см до пола`
    : d.forward_bend;
}

/** «Основной акцент»: свой текст тренера или фраза из выбранных направлений. */
export function recFocusText(d: Pick<BodyDiagnosticRow, "rec_focus" | "rec_directions">) {
  if (d.rec_focus?.trim()) return d.rec_focus.trim();
  const dirs = d.rec_directions ?? [];
  return dirs.length ? `Рекомендую вам направления: ${dirs.join(", ")}.` : null;
}

type MetricKey =
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

/** Показатели таблицы динамики: подпись, единица, что считать улучшением. */
export const DYNAMICS_METRICS: {
  key: MetricKey;
  label: string;
  unit: string;
  better: "lower" | "higher" | null;
}[] = [
  { key: "waist_cm", label: "Талия", unit: "см", better: null },
  { key: "hips_cm", label: "Бёдра", unit: "см", better: null },
  { key: "chest_cm", label: "Грудь", unit: "см", better: null },
  { key: "weight_kg", label: "Вес", unit: "кг", better: null },
  { key: "split_right_cm", label: "Правый шпагат, до пола", unit: "см", better: "lower" },
  { key: "split_left_cm", label: "Левый шпагат, до пола", unit: "см", better: "lower" },
  { key: "split_middle_cm", label: "Поперечный шпагат, до пола", unit: "см", better: "lower" },
  { key: "bend_gap_cm", label: "Наклон, до пола", unit: "см", better: "lower" },
  { key: "emotional_level", label: "Эмоциональное состояние", unit: "из 10", better: "higher" },
  { key: "activity_level", label: "Активность", unit: "из 10", better: "higher" },
];

/** Значение показателя; наклон — см до пола, «достаёт» — 0. */
export function metricValue(d: BodyDiagnosticRow, key: MetricKey): number | null {
  if (key === "bend_gap_cm") {
    if (!d.forward_bend) return null;
    return d.forward_bend === BEND_NOT_REACH ? num(d.forward_bend_cm) : 0;
  }
  return num(d[key]);
}

export type DynamicsRow = {
  key: MetricKey;
  label: string;
  unit: string;
  /** Значение по каждой диагностике (в порядке дат), null — не измеряли. */
  values: (number | null)[];
  /** Последнее − первое из измеренных; null — меньше двух значений. */
  diff: number | null;
  trend: "better" | "worse" | "same" | "changed" | null;
};

/**
 * Таблица динамики: диагностики по дате (старые слева), строки — только
 * показатели, измеренные хотя бы раз.
 */
export function dynamicsTable(list: BodyDiagnosticRow[]) {
  const sorted = [...list].sort((a, b) => a.diagnostic_date.localeCompare(b.diagnostic_date));
  const rows: DynamicsRow[] = [];
  for (const m of DYNAMICS_METRICS) {
    const values = sorted.map((d) => metricValue(d, m.key));
    const present = values.filter((v): v is number => v != null);
    if (present.length === 0) continue;
    const diff =
      present.length >= 2 ? Math.round((present[present.length - 1] - present[0]) * 10) / 10 : null;
    const trend =
      diff == null
        ? null
        : diff === 0
          ? "same"
          : !m.better
            ? "changed"
            : diff < 0 === (m.better === "lower")
              ? "better"
              : "worse";
    rows.push({ key: m.key, label: m.label, unit: m.unit, values, diff, trend });
  }
  return { dates: sorted.map((d) => d.diagnostic_date), rows };
}

/** «−4 см», «+1,5 кг», «без изменений». */
export function diffText(diff: number, unit: string) {
  if (diff === 0) return "без изменений";
  const u = unit === "из 10" ? "" : ` ${unit}`;
  return `${diff > 0 ? "+" : "−"}${fmtNum(Math.abs(diff))}${u}`;
}
