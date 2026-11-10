/**
 * Абонемент переноса (пакетные клубы, 2026-11-10): проверка формы выдачи и
 * вид баланса — как в базе
 * (db/migrations/2026-11-10_packages_carryover_membership.sql:
 * sales_carryover_terms_check, activate_membership_from_sale).
 */

/** Поля формы «Перенос» (строки — как в полях ввода). */
export type CarryoverFields = {
  clientId: string;
  membershipId: string;
  /** Остаток групповых тренировок. */
  visits: string;
  /** Остаток персональных. */
  personal: string;
  /** Остаток диагностик тела. */
  diagnostics: string;
  /** Начало срока, yyyy-MM-dd. */
  startsOn: string;
  /** Окончание срока, yyyy-MM-dd. */
  endsOn: string;
  /** Долг за абонемент, ₾ (пусто — нет). */
  debt: string;
  /** Срок внесения долга, yyyy-MM-dd. */
  debtDue: string;
};

/** Целое ≥ 0 из поля; пусто — 0; иначе null (ошибка). */
function count(value: string): number | null {
  const v = value.trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Первая ошибка заполнения (текст для тоста) или null. */
export function carryoverError(f: CarryoverFields): string | null {
  if (!f.clientId) return "Выберите клиента";
  if (!f.membershipId) return "Выберите абонемент переноса";
  const visits = count(f.visits);
  const personal = count(f.personal);
  const diagnostics = count(f.diagnostics);
  if (visits == null || personal == null || diagnostics == null) {
    return "Остаток — целое число тренировок, 0 или больше";
  }
  if (visits + personal + diagnostics === 0) return "Укажите остаток тренировок";
  if (!f.startsOn) return "Укажите начало срока";
  if (!f.endsOn) return "Укажите, до какого дня действует абонемент";
  if (f.endsOn < f.startsOn) return "Окончание срока раньше начала";
  const debt = f.debt.trim() ? Number(f.debt) : 0;
  if (!Number.isFinite(debt) || debt < 0) return "Долг — сумма 0 или больше";
  if (debt > 0 && !f.debtDue) return "Укажите, до какого дня внести долг";
  return null;
}

/**
 * Вид баланса абонемента переноса: только персональные — пакет
 * персональных, иначе групповой (персональные — остатком при нём, как
 * подарочные у пакета тренировок).
 */
export function carryoverBalanceKind(f: Pick<CarryoverFields, "visits" | "personal">) {
  return (count(f.visits) ?? 0) === 0 && (count(f.personal) ?? 0) > 0 ? "personal" : "group";
}
