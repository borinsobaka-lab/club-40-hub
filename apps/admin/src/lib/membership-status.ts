import { todayISO } from "@/lib/format";

/**
 * Статус абонемента клиента для бейджа (components/membership-status-badge.tsx).
 *
 * pending — продление пакетной студии ждёт, пока закончится текущий абонемент;
 * refunded — по продаже оформлен возврат (пакетные клубы, 2026-10-13);
 * awaiting — не статус базы: действующий абонемент пакетного клуба, по
 * которому ещё не было посещений (срок — с первого посещения, 2026-10-13).
 */
export type CMStatus =
  | "active"
  | "frozen"
  | "pending"
  | "replaced"
  | "expired"
  | "cancelled"
  | "refunded"
  | "awaiting"
  | string;

export type MembershipStatusInput = {
  status: CMStatus | null | undefined;
  ends_at?: string | null;
  auto_renew?: boolean | null;
  cancelled_at?: string | null;
  /** Пакетный клуб: срок от первого посещения и его начало (null — ещё не ходил). */
  starts_on_first_visit?: boolean | null;
  started_at?: string | null;
};

export function effectiveStatus(m: MembershipStatusInput, today = todayISO()): CMStatus {
  if (!m.status) return "expired";
  if (m.status === "active" && m.starts_on_first_visit && !m.started_at) return "awaiting";
  if (m.status === "active" && m.ends_at && m.ends_at < today) return "expired";
  return m.status;
}

/** Абонемент действует (в том числе ждёт первого посещения). */
export function isLiveStatus(s: CMStatus) {
  return s === "active" || s === "awaiting";
}
