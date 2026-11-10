/**
 * Баланс абонемента клиента «сколько из скольки» — для карточки клиента
 * (активный абонемент и история продаж, в том числе закончившиеся).
 *
 * Всего — из номенклатуры (`memberships`), осталось — из абонемента клиента
 * (`client_memberships`). Пакетный клуб: групповые (`visits_left` из
 * `visits_count`; у пакета персональных их нет), персональные
 * (`personal_left` из `personal_count`: у пакета персональных — сам пакет, у
 * пакета тренировок — подарочные) и диагностики, если входят.
 * Подписочный клуб: посещения (`visits_count` null — безлимит).
 */
export type BalanceSource = {
  kind?: string | null;
  visits_count?: number | null;
  personal_count?: number | null;
  diagnostics_count?: number | null;
  visits_left: number | null;
  personal_left?: number | null;
  diagnostics_left?: number | null;
};

export type BalanceLine = {
  label: string;
  /** null — безлимит или неизвестно. */
  left: number | null;
  total: number | null;
  /**
   * Использовано: всего − осталось; null — не посчитать (безлимит или
   * остаток больше номенклатуры: «Остаток из 1С», остаток добавили вручную).
   */
  used: number | null;
};

function line(label: string, left: number | null | undefined, total: number | null | undefined) {
  const l = left ?? null;
  const t = total ?? null;
  return { label, left: l, total: t, used: l != null && t != null && l <= t ? t - l : null };
}

/**
 * Вид баланса абонемента пакетного клуба: у пакета персональных —
 * персональные; у абонемента переноса (остатки — свои у каждого, 2026-11-10)
 * — по остаткам, как выдаёт база: только персональные — персональные; у
 * остальных — групповые.
 */
export function balanceKindOf(
  kind: string | null | undefined,
  visitsLeft: number | null | undefined,
  personalLeft: number | null | undefined,
): "group" | "personal" {
  if (kind === "personal") return "personal";
  if (kind === "carryover" && (visitsLeft ?? 0) === 0 && (personalLeft ?? 0) > 0) return "personal";
  return "group";
}

export function membershipBalance(src: BalanceSource, isPackages: boolean): BalanceLine[] {
  // Абонемент переноса: в номенклатуре количества нет — только «осталось»;
  // персональные и диагностики — если они есть.
  if (isPackages && src.kind === "carryover") {
    const personal = src.personal_left ?? 0;
    const diagnostics = src.diagnostics_left ?? 0;
    const lines: BalanceLine[] = [];
    if (balanceKindOf(src.kind, src.visits_left, personal) === "group") {
      lines.push(line("Групповые", src.visits_left, null));
    }
    if (personal > 0) lines.push(line("Персональные", personal, null));
    if (diagnostics > 0) lines.push(line("Диагностики", diagnostics, null));
    return lines;
  }
  if (!isPackages) {
    if (src.visits_count == null && src.visits_left == null) {
      return [{ label: "Посещения", left: null, total: null, used: null }];
    }
    return [line("Посещения", src.visits_left, src.visits_count)];
  }
  const lines: BalanceLine[] = [];
  const isPersonal = src.kind === "personal";
  const personalTotal = src.personal_count ?? 0;
  const diagnosticsTotal = src.diagnostics_count ?? 0;
  if (!isPersonal) lines.push(line("Групповые", src.visits_left, src.visits_count));
  if (isPersonal || personalTotal > 0) {
    lines.push(line("Персональные", src.personal_left ?? 0, personalTotal || null));
  }
  if (diagnosticsTotal > 0) {
    lines.push(line("Диагностики", src.diagnostics_left ?? 0, diagnosticsTotal));
  }
  return lines;
}

/** «Групповые: 6 из 8 использовано, осталось 2» / «Посещения: безлимит». */
export function balanceLineText(l: BalanceLine): string {
  if (l.left == null && l.total == null) return `${l.label}: безлимит`;
  if (l.left == null) return `${l.label}: ${l.total} всего`;
  if (l.used == null) return `${l.label}: осталось ${l.left}`;
  return `${l.label}: использовано ${l.used} из ${l.total}, осталось ${l.left}`;
}
