/**
 * Оплата групповых по числу людей (пакетные клубы, решение владельца
 * 2026-11-11; схема — db/migrations/2026-11-11_studio_per_person_pay.sql).
 * Здесь — то же правило, что в базе (pay_scheme_amount), для примеров в
 * «Ставках», и стартовые схемы купленной студии. Без React — тест рядом.
 */

export type PayBonus = { from: number; amount: number };

export type PayScheme = {
  id: string;
  studio_id: string;
  name: string;
  /** Схема для тренировок без своей схемы (одна на клуб). */
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

export type StudioPaySettings = {
  studio_id: string;
  per_person: boolean;
  /** ₾ тренеру пробного за абонемент после пробного; null — 5 % тренеру при продаже. */
  trial_sale_bonus: number | null;
};

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
export const PRESET_SCHEMES: (SchemeTerms & { name: string; is_default: boolean })[] = [
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
    is_default: false,
    min_amount: 15,
    min_up_to: 3,
    per_person: 6,
    bonuses: OCCUPANCY,
  },
  {
    name: "Гамаки",
    is_default: false,
    min_amount: 15,
    min_up_to: 3,
    per_person: 6,
    bonuses: OCCUPANCY,
  },
];
export const PRESET_TRIAL_SALE_BONUS = 10;
