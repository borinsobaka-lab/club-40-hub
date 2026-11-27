import type { Translator } from "@/i18n/translate";

/**
 * Тексты диагностики для показа (чистые функции).
 *
 * «Основной акцент» рекомендаций: тренер выбрал направления — фраза
 * собирается на языке клиента; написал свой текст (rec_focus) — показывается
 * как есть.
 */
export function recFocusText(directions: string[], t: Translator) {
  if (directions.length === 0) return "";
  return t("Рекомендую вам направления: {list}.", { list: directions.join(", ") });
}

export function recFocusOf(
  d: { rec_focus: string | null; rec_directions: string[] },
  t: Translator,
) {
  return d.rec_focus?.trim() || recFocusText(d.rec_directions, t);
}

/** Число с десятыми без лишнего нуля: 64 → «64», 60.5 → «60,5» (по языку). */
export function num(n: number, t: Translator) {
  return t.number(n, { maximumFractionDigits: 1 });
}

/** Дата диагностики «12 октября 2026» (дата без времени — полдень, чтобы не съехал день). */
export function diagDate(date: string, t: Translator, withYear = true) {
  return t.date(`${date}T12:00:00`, {
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** Короткая подпись оси «12 окт». */
export function diagShortDate(date: string, t: Translator) {
  return t.date(`${date}T12:00:00`, { day: "numeric", month: "short" });
}
