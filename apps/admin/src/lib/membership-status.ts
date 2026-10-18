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

/** Подписи статусов — бейдж и фильтр «Статус» в «Абонементах». */
export const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
  active: "Активен",
  frozen: "Заморожен",
  pending: "Ждёт начала",
  replaced: "Заменён",
  expired: "Истёк",
  cancelled: "Отменён",
  refunded: "Возврат",
  awaiting: "Ожидает посещения",
};

/**
 * Цветная точка статуса в фильтре «Статус» «Абонементов» — тот же оттенок,
 * что у бейджа (components/membership-status-badge.tsx), насыщенней.
 */
export const MEMBERSHIP_STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  frozen: "bg-blue-500",
  pending: "bg-violet-500",
  replaced: "bg-amber-500",
  expired: "bg-muted-foreground/50",
  cancelled: "bg-rose-500",
  refunded: "bg-orange-500",
  awaiting: "bg-yellow-400",
};

export type MembershipStatusInput = {
  status: CMStatus | null | undefined;
  ends_at?: string | null;
  auto_renew?: boolean | null;
  cancelled_at?: string | null;
  /** Пакетный клуб: срок от первого посещения и его начало (null — ещё не ходил). */
  starts_on_first_visit?: boolean | null;
  started_at?: string | null;
};

/** Та же логика — client_packages_list.membership_state (фильтр «Абонементов»). */
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

/**
 * Подсказка администратору «пора продлевать» в окне занятия (решение
 * владельца 2026-10-13): остаток посещений и дата окончания красным, когда
 * посещений меньше 5 или до конца срока меньше 14 дней.
 */
export const RENEWAL_HINT_VISITS = 5;
export const RENEWAL_HINT_DAYS = 14;

/** Посещений осталось меньше порога; безлимит (null) — нет. */
export function fewVisitsLeft(left: number | null | undefined) {
  return left != null && left < RENEWAL_HINT_VISITS;
}

/** До окончания срока меньше порога дней (и уже истёкший); без даты — нет. */
export function endsSoon(endsAt: string | null | undefined, today = todayISO()) {
  if (!endsAt) return false;
  const days = (Date.parse(endsAt.slice(0, 10)) - Date.parse(today)) / 86_400_000;
  return days < RENEWAL_HINT_DAYS;
}
