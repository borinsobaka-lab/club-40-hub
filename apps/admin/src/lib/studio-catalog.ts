/**
 * Общий каталог клубов (db/migrations/2026-10-13_zzzz_packages_shared_catalog.sql):
 * тренировки и номенклатура — один список на все клубы сети (решение
 * владельца 2026-10-13). Строка по-прежнему с studio_id клуба, где её
 * завели, поэтому список грузится по клубам каталога:
 * `.in("studio_id", catalogStudioIds(...))`.
 * Модуль без React: его читает и сервер (инструменты Kate).
 */

export type CatalogStudio = {
  id: string;
  /** studios.format: в сеть входят клубы с пакетами тренировок (packages). */
  format: string;
  /** Название — где нужно показать клуб сети (фильтр «Клуб» в «Абонементах»). */
  name?: string;
};

/** Формат клубов сети (studios.format). */
const NETWORK_FORMAT = "packages";

/**
 * Клубы, чьи тренировки и номенклатура видны в клубе studioId: все клубы
 * сети. Клуб не из сети (или ещё не загружен) — только он сам.
 */
export function catalogStudioIds(studios: CatalogStudio[], studioId: string): string[] {
  const own = studios.find((s) => s.id === studioId);
  if (!own || own.format !== NETWORK_FORMAT) return [studioId];
  return studios.filter((s) => s.format === NETWORK_FORMAT).map((s) => s.id);
}

/**
 * Клубы общей базы клиентов клуба studioId
 * (db/migrations/2026-10-17_packages_shared_clients.sql, решение владельца
 * 2026-10-17): все клубы сети — одна карточка клиента на сеть, её видят и
 * ведут сотрудники любого клуба. Это те же клубы, что у общего каталога
 * (сеть в базе — studios_same_network). Списки и поиск клиентов —
 * `.in("studio_id", …)`; продажа — по-прежнему в активном клубе.
 */
export function networkStudioIds(studios: CatalogStudio[], studioId: string): string[] {
  return catalogStudioIds(studios, studioId);
}

/** Клубы a и b — одна база клиентов (тот же клуб или оба в сети). */
export function sameNetwork(studios: CatalogStudio[], a: string, b: string): boolean {
  return a === b || networkStudioIds(studios, a).includes(b);
}
