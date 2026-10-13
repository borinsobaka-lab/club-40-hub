import { msg } from "@/i18n/translate";

/**
 * Кем работает сотрудник (trainers.role, «Сотрудники» в админке): у каждой
 * роли своя вкладка «Студии»; массажисты — с 2026-10-12
 * (db/migrations/2026-10-12_zzzzzzz_staff_masseurs.sql).
 */
export type StaffRole = "trainer" | "admin" | "masseur";

/**
 * Вкладка строки; неизвестная или пустая роль — тренер. Старший
 * администратор (`senior_admin`, 2026-10-13) — во вкладке «Админы» вместе с
 * администраторами, подпись своя (`staffRoleLabel`).
 */
export function staffRole(row: { role: string | null }): StaffRole {
  if (row.role === "admin" || row.role === "senior_admin") return "admin";
  return row.role === "masseur" ? "masseur" : "trainer";
}

/** Подпись роли в карточке и списке (переводится при показе — t(…)). */
export function staffRoleLabel(row: { role: string | null }): string {
  return row.role === "senior_admin"
    ? msg("Старший администратор")
    : STAFF_ROLE_TEXT[staffRole(row)].label;
}

/** Рейтинг и оценки — у тренеров и массажистов; администраторов не оценивают. */
export const staffHasRating = (role: StaffRole) => role !== "admin";

/** Подписи карточки сотрудника по роли (переводятся при показе — t(…)). */
export const STAFF_ROLE_TEXT: Record<
  StaffRole,
  { label: string; tip: string; rate: string | null; noBio: string }
> = {
  trainer: {
    label: msg("Тренер"),
    tip: msg("Поблагодарить тренера"),
    rate: msg("Оцените тренера"),
    noBio: msg("Рассказ о тренере скоро появится."),
  },
  admin: {
    label: msg("Администратор"),
    tip: msg("Поблагодарить администратора"),
    rate: null,
    noBio: msg("Рассказ об администраторе скоро появится."),
  },
  masseur: {
    label: msg("Массажист"),
    tip: msg("Поблагодарить массажиста"),
    rate: msg("Оцените массажиста"),
    noBio: msg("Рассказ о массажисте скоро появится."),
  },
};
