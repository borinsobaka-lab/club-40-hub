/**
 * Права сотрудника в админке («Доступы», db/migrations/2026-10-10_admin_permissions.sql).
 *
 * - Студии — роль сотрудника в user_roles: без неё студии нет в переключателе,
 *   а RLS не отдаёт её данные.
 * - Разделы рейки — admin_permissions.sections (RAIL_ACCESS_KEYS) и правка
 *   скриптов — 'scripts-edit' там же (ADMIN_SECTION_KEYS).
 * - Разделы клуба в студии — admin_studio_permissions.sections
 *   (CLUB_SECTION_KEYS — пункты меню клуба, см. CLUB_GROUPS в nav-sections.ts,
 *   и дашборд: он в рейке над студиями, но открывается по каждой студии).
 *
 * null — строки нет, доступно всё (сотрудники, заведённые до настройки
 * разделов). Владелец видит все разделы рейки, а в своей студии — все разделы
 * клуба. Модуль без React и иконок: его читает и сервер.
 */
import type { AcadAccessInfo } from "@/lib/academy/types";
import type { KbLevel } from "@/lib/kb/access";

export const RAIL_ACCESS_KEYS = ["club", "staff", "app", "scripts"] as const;
export type RailAccessKey = (typeof RAIL_ACCESS_KEYS)[number];

/**
 * Всё, что хранится в admin_permissions.sections: разделы рейки и право
 * правки «Скриптов LS» (без него скрипты только читают и копируют).
 */
export const ADMIN_SECTION_KEYS = [...RAIL_ACCESS_KEYS, "scripts-edit"] as const;
export type AdminSectionKey = (typeof ADMIN_SECTION_KEYS)[number];

export const RAIL_ACCESS_LABEL: Record<AdminSectionKey, string> = {
  club: "Клуб",
  staff: "Сотрудники",
  app: "Мобильное приложение",
  scripts: "Скрипты LS",
  "scripts-edit": "Скрипты LS: правка",
};

export const CLUB_SECTION_KEYS = [
  "dashboard",
  "schedule",
  "clients",
  "client-memberships",
  "workouts",
  "memberships",
  "promocodes",
  "sales",
  "other-sales",
  "bookings-log",
  "autorenew-cancellations",
  "cash",
  "feedback",
  "requests",
  "nps",
] as const;
export type ClubSectionKey = (typeof CLUB_SECTION_KEYS)[number];

/** Права одного сотрудника — как их читает меню и guard. */
export type AdminAccess = {
  /**
   * Базы знаний, доступные сотруднику, и уровень (lib/kb/access.ts); нет
   * поля — баз нет. Владельцу открыты все, в том числе ещё не загруженные.
   */
  kb?: Record<string, KbLevel>;
  /**
   * «Академия»: права («Создаёт курсы», «Проверяет ответы») и счётчики (свои
   * курсы, ответы на проверку) — RPC acad_access. Нет поля — раздела нет.
   */
  academy?: AcadAccessInfo;
  /** Владелец хоть одной студии: все разделы рейки, «Доступы». */
  isOwner: boolean;
  /** Разделы рейки (и 'scripts-edit'); null — все. */
  rail: AdminSectionKey[] | null;
  /** По студиям, где есть роль сотрудника. */
  studios: Record<string, { owner: boolean; sections: ClubSectionKey[] | null }>;
};

export function canOpenRail(access: AdminAccess, key: RailAccessKey): boolean {
  return access.isOwner || access.rail === null || access.rail.includes(key);
}

/**
 * Раздел клуба в студии. Без студии (ещё не выбрана) — только раздел
 * «Клуб» целиком: страница сама попросит выбрать студию.
 */
export function canOpenClubSection(
  access: AdminAccess,
  studioId: string | null,
  key: ClubSectionKey,
): boolean {
  if (!canOpenRail(access, "club")) return false;
  if (!studioId) return true;
  const studio = access.studios[studioId];
  if (!studio) return false;
  return studio.owner || studio.sections === null || studio.sections.includes(key);
}

/**
 * Студии, где сотруднику открыт раздел клуба: роль в студии и раздел в ней.
 * Разделы, собирающие данные всех клубов сразу (дашборд, «Обратная связь»,
 * «Заявки», «NPS-опросы», «Касса»), показывают именно эти студии.
 */
export function sectionStudioIds(access: AdminAccess, key: ClubSectionKey): string[] {
  return Object.keys(access.studios).filter((id) => canOpenClubSection(access, id, key));
}

/**
 * Студии, чьи показатели сотрудник видит на дашборде (раздел рейки над
 * студиями): роль в студии и открытый в ней раздел dashboard.
 */
export function dashboardStudioIds(access: AdminAccess): string[] {
  return sectionStudioIds(access, "dashboard");
}
