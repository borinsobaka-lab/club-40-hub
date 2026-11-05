import { msg } from "@/i18n";

/**
 * Подписи ответов анкеты для тренера (карточка записанного клиента). Тексты —
 * те же, что в самой анкете (formats/packages/onboarding.tsx,
 * components/onboarding.tsx): ключи словарей совпадают, переводы общие.
 */

export const GOAL_LABEL: Record<string, string> = {
  flexibility: msg("Стать гибче"),
  stress_relief: msg("Снять напряжение и стресс"),
  body_shape: msg("Подтянуть фигуру"),
  other: msg("Другое"),
};

export const EXPERIENCE_LABEL: Record<string, string> = {
  beginner: msg("Новичок или большой перерыв"),
  occasional: msg("Тренируюсь время от времени"),
  regular: msg("Регулярно, 2–3 раза в неделю"),
  advanced: msg("Опытный, тренируюсь интенсивно"),
};

export const ACTIVITY_LABEL: Record<number, string> = {
  0: msg("Почти не двигаюсь"),
  1: msg("1 раз в неделю"),
  3: msg("2–3 раза в неделю"),
  5: msg("4 и больше"),
};

export const HEALTH_LABEL: Record<string, string> = {
  back_joints: msg("Спина или суставы"),
  cardio_pressure: msg("Сердце или давление"),
  recent_injury: msg("Недавняя травма или операция"),
  pregnancy: msg("Беременность"),
  chronic: msg("Хроническое заболевание"),
};

export const TIME_LABEL: Record<string, string> = {
  morning: msg("Утро"),
  day: msg("День"),
  evening: msg("Вечер"),
};

/** Ограничения по здоровью: отмеченное (без «Ничего из перечисленного») и комментарий. */
export function healthRestrictions(
  flags: string[] | null | undefined,
  notes: string | null | undefined,
) {
  const list = (flags ?? []).filter((f) => f !== "none");
  const text = notes?.trim() || null;
  return { flags: list, notes: text, any: list.length > 0 || !!text };
}
