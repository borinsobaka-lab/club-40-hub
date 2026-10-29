/**
 * Статусы посещений. Канон — booked | waitlist | attended | no_show | cancelled
 * (db/booking_hygiene.sql); completed/rejected — старые значения, которые
 * ещё встречаются в истории.
 */
export type BookingStatus =
  | "booked"
  | "waitlist"
  | "attended"
  | "no_show"
  | "cancelled"
  | "rejected"
  | "completed";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  booked: "Забронировано",
  waitlist: "Лист ожидания",
  attended: "Посещено",
  no_show: "Пропущено",
  cancelled: "Отменено",
  rejected: "Отклонена",
  completed: "Проведено",
};

/** Статусы для фильтра — только канонические. */
export const BOOKING_STATUS_FILTER: BookingStatus[] = [
  "booked",
  "waitlist",
  "attended",
  "no_show",
  "cancelled",
];

/**
 * Кем отменена запись (`cancelled_by_kind`, решение владельца 2026-10-29;
 * ставит база — db/migrations/2026-10-29_booking_cancelled_by.sql): сам
 * клиент или администратор (сотрудник, отмена или удаление занятия клубом).
 * null — отменено раньше, кем — неизвестно.
 */
export type CancelledByKind = "client" | "admin";

export const CANCELLED_BY_LABEL: Record<CancelledByKind, string> = {
  client: "Отменено клиентом",
  admin: "Отменено администратором",
};

/** Подпись статуса с учётом того, кем отменена запись. */
export function bookingStatusLabel(
  status: BookingStatus,
  cancelledBy?: CancelledByKind | null,
): string {
  if (status === "cancelled" && cancelledBy) return CANCELLED_BY_LABEL[cancelledBy];
  return BOOKING_STATUS_LABEL[status] ?? status;
}
