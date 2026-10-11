import { Shapes, UserRound, Users } from "lucide-react";

/**
 * Типы занятий в расписании (schedule_entries.kind, 2026-10-11, оба формата
 * студий): групповое — по тренировке, клиенты записываются из приложения;
 * персональное — ведёт один тренер (ставка за персональную — «Зарплатные
 * ставки»); прочая активность — своё название, тренеры по желанию и ставка,
 * введённая вручную. Персональные и прочие клиенты в приложении не видят.
 */
export type ActivityKind = "group" | "personal" | "other";

export const ACTIVITY_KINDS: {
  value: ActivityKind;
  label: string;
  /** Подпись во множественном числе — для фильтра. */
  plural: string;
  description: string;
  icon: typeof Users;
  /** Полоска на карточке и плашка иконки. */
  color: string;
}[] = [
  {
    value: "group",
    label: "Групповое занятие",
    plural: "Групповые",
    description: "Тренировка из раздела «Тренировки», клиенты записываются в приложении",
    icon: Users,
    color: "#3b82f6",
  },
  {
    value: "personal",
    label: "Персональное занятие",
    plural: "Персональные",
    description: "Тренер и время — ставка тренера за персональную тренировку",
    icon: UserRound,
    color: "#8b5cf6",
  },
  {
    value: "other",
    label: "Прочая активность",
    plural: "Прочие активности",
    description: "Своё название, тренеры по желанию и ставка вручную",
    icon: Shapes,
    color: "#f59e0b",
  },
];

export const ACTIVITY_KIND_VALUES = ACTIVITY_KINDS.map((k) => k.value);

export function activityKind(v: ActivityKind) {
  return ACTIVITY_KINDS.find((k) => k.value === v) ?? ACTIVITY_KINDS[0];
}
