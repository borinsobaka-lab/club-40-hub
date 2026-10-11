// Общее для анкет обоих приложений (подписочной и пакетной): типы ответов
// member_profiles, заголовки вопросов, подписи. Компоненты —
// src/components/onboarding.tsx.

export type Experience = "beginner" | "occasional" | "regular" | "advanced";
export type HealthFlag =
  | "back_joints"
  | "cardio_pressure"
  | "recent_injury"
  | "pregnancy"
  | "chronic"
  | "none";
export type PrefTime = "morning" | "day" | "evening";
export type Referral = "instagram" | "referral" | "walk_by" | "search" | "other";

export const STEP_TITLES = {
  experience: { title: "Какой у вас опыт тренировок?" },
  activity: { title: "Сколько раз в неделю вы сейчас двигаетесь или тренируетесь?" },
  health: {
    title: "Есть что-то, о чём стоит знать тренеру?",
    subtitle:
      "Отметьте, если актуально — тренер скорректирует нагрузку. Это не заменяет консультацию врача.",
  },
  logistics: { title: "Как планируете заниматься?" },
  referral: { title: "Откуда вы о нас узнали?" },
};

export const FREQUENCY_LABEL = "Сколько раз в неделю хотите ходить?";
export const TIMES_LABEL = "Удобное время";
export const HEALTH_NOTES_LABEL = "Кратко опишите, что важно учесть";

/** Отмечено что-то, кроме «Ничего из перечисленного», — спросить подробности. */
export function hasHealthIssues(flags: HealthFlag[]) {
  return flags.some((f) => f !== "none");
}
