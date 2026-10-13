/**
 * Общий каталог клубов (db/migrations/2026-10-13_zzzz_packages_shared_catalog.sql):
 * тренировки и номенклатура клубов с пакетами тренировок — один список на все
 * пакетные клубы (решение владельца 2026-10-13), у подписочного клуба — свой.
 * Строка по-прежнему с studio_id клуба, где её завели, поэтому список
 * грузится по клубам каталога: `.in("studio_id", catalogStudioIds(...))`.
 * Модуль без React: его читает и сервер (инструменты Kate).
 */
import type { StudioFormat } from "@/lib/studio-formats";

/** Форматы, у которых каталог общий для всех клубов формата. */
export const SHARED_CATALOG_FORMATS: readonly StudioFormat[] = ["packages"];

export type CatalogStudio = { id: string; format: StudioFormat };

/**
 * Клубы, чьи тренировки и номенклатура видны в клубе studioId: все клубы
 * того же формата, если каталог формата общий, иначе только он сам.
 */
export function catalogStudioIds(studios: CatalogStudio[], studioId: string): string[] {
  const own = studios.find((s) => s.id === studioId);
  if (!own || !SHARED_CATALOG_FORMATS.includes(own.format)) return [studioId];
  return studios.filter((s) => s.format === own.format).map((s) => s.id);
}

/** Общий ли каталог у клуба этого формата (подсказки «правка — во всех клубах»). */
export const isSharedCatalog = (format: StudioFormat | undefined | null) =>
  !!format && SHARED_CATALOG_FORMATS.includes(format);
