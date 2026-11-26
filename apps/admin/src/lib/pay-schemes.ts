/**
 * Прогрессивная ставка тренера — оплата групповых по числу людей (решение
 * владельца 2026-11-11; с 2026-11-24 — по тренеру, суммы у каждого свои:
 * db/migrations/2026-11-24_trainer_progressive_pay.sql). Здесь — то же
 * правило, что в базе (pay_scheme_amount), для примеров в «Ставках», и
 * стартовые схемы купленной студии. Без React — тест рядом.
 */

export type PayBonus = { from: number; amount: number };

export type PayScheme = {
  id: string;
  trainer_id: string;
  name: string;
  /** Схема для тренировок без своей схемы (одна у тренера). */
  is_default: boolean;
  /** Оплата при малой группе. */
  min_amount: number;
  /** До скольких человек включительно — минимальная оплата. */
  min_up_to: number;
  /** ₾ за человека, когда людей больше min_up_to. */
  per_person: number;
  /** Бонус за наполняемость: «от N человек +X ₾» (берётся самый крупный порог). */
  bonuses: PayBonus[];
  sort_order: number;
};

/** Тренировка → схема тренера (trainer_pay_scheme_workouts). */
export type SchemeWorkout = { trainer_id: string; scheme_id: string; workout_id: string };

/** «До 3 чел. — 15 ₾, больше — 4 ₾ за человека; от 7 чел. +5 ₾». */
export function schemeSummary(s: SchemeTerms, money: (n: number) => string): string {
  const bonuses = s.bonuses.map((b) => `от ${b.from} чел. +${money(Number(b.amount))}`).join(", ");
  return (
    `До ${s.min_up_to} чел. — ${money(Number(s.min_amount))}, больше — ${money(Number(s.per_person))} за человека` +
    (bonuses ? `; ${bonuses}` : "")
  );
}

export type SchemeTerms = Pick<PayScheme, "min_amount" | "min_up_to" | "per_person" | "bonuses">;

/** Оплата тренеру за занятие, где «Посетил» — people (как pay_scheme_amount в базе). */
export function schemeAmount(s: SchemeTerms, people: number): number {
  const n = Math.max(0, Math.floor(people));
  const base = n <= s.min_up_to ? Number(s.min_amount) : Number(s.per_person) * n;
  const bonus = [...s.bonuses].filter((b) => b.from <= n).sort((a, b) => b.from - a.from)[0];
  return Math.round((base + (bonus ? Number(bonus.amount) : 0)) * 100) / 100;
}

/** Бонусы по порогу; пустые и повторяющиеся пороги убраны. */
export function cleanBonuses(list: PayBonus[]): PayBonus[] {
  const byFrom = new Map<number, number>();
  for (const b of list) {
    if (!Number.isInteger(b.from) || b.from < 1 || !(b.amount > 0)) continue;
    byFrom.set(b.from, b.amount);
  }
  return [...byFrom.entries()]
    .sort(([a], [b]) => a - b)
    .map(([from, amount]) => ({ from, amount }));
}

/** Примеры для подсказки: «1–3 чел. — 15 ₾ · 4 — 16 ₾ · 7 — 33 ₾ · 10 — 50 ₾». */
export function schemeExamples(s: SchemeTerms, max = 12): { people: string; amount: number }[] {
  const out: { people: string; amount: number }[] = [];
  if (s.min_up_to > 0) out.push({ people: `1–${s.min_up_to}`, amount: schemeAmount(s, 1) });
  const points = new Set<number>([s.min_up_to + 1, ...s.bonuses.map((b) => b.from), max]);
  for (const p of [...points].sort((a, b) => a - b)) {
    if (p < 1 || p > max) continue;
    out.push({ people: String(p), amount: schemeAmount(s, p) });
  }
  return out;
}

/**
 * Условия купленной студии (Палиашвили, от старшего тренера 2026-11-11):
 * до 3 человек — 15 ₾; больше — 4 ₾ за человека на коврике, 6 ₾ на TRX и
 * гамаках; 7+ человек — +5 ₾, 10+ — +10 ₾ на всех; +10 ₾ тренеру пробного
 * за абонемент после пробного.
 */
const OCCUPANCY: PayBonus[] = [
  { from: 7, amount: 5 },
  { from: 10, amount: 10 },
];
export const PRESET_SCHEMES: (SchemeTerms & {
  name: string;
  is_default: boolean;
  /** Тренировки каталога, которые сразу идут по этой схеме, — по слову в названии. */
  match?: RegExp;
})[] = [
  {
    name: "Обычная группа",
    is_default: true,
    min_amount: 15,
    min_up_to: 3,
    per_person: 4,
    bonuses: OCCUPANCY,
  },
  {
    name: "TRX",
    match: /trx/i,
    is_default: false,
    min_amount: 15,
    min_up_to: 3,
    per_person: 6,
    bonuses: OCCUPANCY,
  },
  {
    name: "Гамаки",
    match: /гамак|hammock/i,
    is_default: false,
    min_amount: 15,
    min_up_to: 3,
    per_person: 6,
    bonuses: OCCUPANCY,
  },
];
export const PRESET_TRIAL_SALE_BONUS = 10;

/**
 * Как получилась сумма за занятие: «минимум 15 ₾», «7 чел. × 6 ₾ + 5 ₾ за
 * наполняемость» — для сверки с тренером в «Зарплатах».
 */
export function schemeBreakdown(
  s: SchemeTerms,
  people: number,
  money: (n: number) => string,
): string {
  const n = Math.max(0, Math.floor(people));
  const base =
    n <= s.min_up_to
      ? `минимум ${money(Number(s.min_amount))} (до ${s.min_up_to} чел.)`
      : `${n} чел. × ${money(Number(s.per_person))}`;
  const bonus = [...s.bonuses].filter((b) => b.from <= n).sort((a, b) => b.from - a.from)[0];
  return bonus ? `${base} + ${money(Number(bonus.amount))} за наполняемость` : base;
}

/** Схема тренера для тренировки: своя схема тренировки, иначе — «для остальных». */
export function schemeFor(
  schemes: PayScheme[],
  links: SchemeWorkout[],
  trainerId: string,
  workoutId: string | null,
): PayScheme | null {
  const own = schemes.filter((s) => s.trainer_id === trainerId);
  const link = workoutId
    ? links.find((l) => l.trainer_id === trainerId && l.workout_id === workoutId)
    : null;
  return (
    (link && own.find((s) => s.id === link.scheme_id)) ?? own.find((s) => s.is_default) ?? null
  );
}
