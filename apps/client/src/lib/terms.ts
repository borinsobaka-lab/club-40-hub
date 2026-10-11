import { APP_FORMAT } from "@/lib/app-format";

/** Пакетное приложение (pack.base40.fit). */
export const IS_PACKAGES = APP_FORMAT === "packages";

/**
 * «Клуб» в текстах приложения: в пакетном — «студия» (решение владельца
 * 2026-10-11), в подписочном — по-прежнему «клуб». Падежи — для подстановки
 * в строки: `клиентов ${CLUB.gen}`.
 */
export const CLUB = IS_PACKAGES
  ? { nom: "студия", gen: "студии", dat: "студии", prep: "студии", Nom: "Студия" }
  : { nom: "клуб", gen: "клуба", dat: "клубу", prep: "клубе", Nom: "Клуб" };

/** Раздел записи на занятия: «Расписание» в пакетном, «Бронь» в подписочном. */
export const SCHEDULE_TITLE = IS_PACKAGES ? "Расписание" : "Бронь";
