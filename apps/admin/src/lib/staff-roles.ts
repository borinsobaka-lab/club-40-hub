/**
 * Роли сотрудников справочника «Сотрудники» (trainers.role): тренер,
 * администратор, старший администратор (2026-10-13), массажист.
 */

export type TrainerRole = "trainer" | "admin" | "senior_admin" | "masseur";

/**
 * plural — подпись группы (фильтр «Роль» в «Зарплатах»). Старший
 * администратор (2026-10-13) — тот же администратор (смены, продажи,
 * вкладка «Админы» в приложении), только подпись своя.
 */
export const TRAINER_ROLES: Record<TrainerRole, { label: string; plural: string; badge: string }> =
  {
    trainer: { label: "Тренер", plural: "Тренеры", badge: "bg-sky-100 text-sky-700" },
    admin: {
      label: "Администратор",
      plural: "Администраторы",
      badge: "bg-violet-100 text-violet-700",
    },
    senior_admin: {
      label: "Старший администратор",
      plural: "Старшие администраторы",
      badge: "bg-indigo-100 text-indigo-700",
    },
    masseur: { label: "Массажист", plural: "Массажисты", badge: "bg-emerald-100 text-emerald-700" },
  };

/** Администратор или старший администратор: продают, выходят на смены. */
export const isAdminRole = (role: string | null | undefined) =>
  role === "admin" || role === "senior_admin";

/** Рейтинг в приложении (оценки клиентов) — у тренеров и массажистов, не у администраторов. */
export const hasRating = (role: string) => role === "trainer" || role === "masseur";

/**
 * Группа роли в списках сотрудников (расписание, прочая активность): старший
 * администратор — среди администраторов; неизвестная или пустая роль — тренер.
 */
export function roleGroup(role: string | null | undefined): "trainer" | "admin" | "masseur" {
  if (isAdminRole(role)) return "admin";
  return role === "masseur" ? "masseur" : "trainer";
}
