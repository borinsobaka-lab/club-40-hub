/**
 * Фильтр «Клубы» дашборда: показатели считаются суммарно по выбранным
 * клубам. Варианты: один клуб, несколько, все клубы. Без выбора (null) —
 * клуб из шапки. Без React (тест — dashboard-clubs.test.ts).
 */

export type ClubLite = { id: string; name: string };

/** Клуб по умолчанию: выбранный в шапке, если дашборд в нём открыт, иначе первый. */
export function defaultClubId(clubs: ClubLite[], activeId: string | null): string | null {
  return clubs.find((c) => c.id === activeId)?.id ?? clubs[0]?.id ?? null;
}

/**
 * Выбранные клубы: сохранённый выбор без недоступных; пусто или не выбрано —
 * клуб по умолчанию.
 */
export function resolveClubIds(
  clubs: ClubLite[],
  activeId: string | null,
  chosen: string[] | null,
): string[] {
  const valid = new Set(chosen ?? []);
  const kept = clubs.filter((c) => valid.has(c.id)).map((c) => c.id);
  if (kept.length) return kept;
  const fallback = defaultClubId(clubs, activeId);
  return fallback ? [fallback] : [];
}

/** Отметить / снять клуб; последний снять нельзя — показатели всегда хотя бы по одному. */
export function toggleClub(clubs: ClubLite[], selected: string[], id: string): string[] {
  if (!clubs.some((c) => c.id === id)) return selected;
  if (selected.includes(id)) {
    const rest = selected.filter((x) => x !== id);
    return rest.length ? rest : selected;
  }
  return clubs.filter((c) => c.id === id || selected.includes(c.id)).map((c) => c.id);
}

/**
 * «Все клубы»: отметить все; если уже отмечены все — оставить один (клуб по
 * умолчанию, иначе первый).
 */
export function toggleAll(
  clubs: ClubLite[],
  selected: string[],
  activeId: string | null,
): string[] {
  const ids = clubs.map((c) => c.id);
  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
  if (!all) return ids;
  return [ids.includes(activeId ?? "") ? activeId! : ids[0]];
}

/** Подпись поля: название клуба, «Все клубы» или «N клуба». */
export function clubsLabel(clubs: ClubLite[], selected: string[]): string {
  const chosen = clubs.filter((c) => selected.includes(c.id));
  if (chosen.length === 0) return "—";
  if (chosen.length === 1) return chosen[0].name;
  if (chosen.length === clubs.length) return "Все клубы";
  const n = chosen.length;
  const word = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "клуба" : "клубов";
  return `${n} ${word}`;
}
