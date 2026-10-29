import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { bookingStatusLabel, type BookingStatus, type CancelledByKind } from "@/lib/bookings";

function toneOf(status: BookingStatus): StatusTone {
  switch (status) {
    case "attended":
    case "completed":
      return "positive";
    case "cancelled":
      return "negative";
    case "rejected":
      return "warning";
    case "no_show":
      return "neutral";
    default:
      // booked, waitlist
      return "info";
  }
}

/** cancelledBy — у отменённой: «Отменено клиентом» / «Отменено администратором». */
export function BookingStatusBadge({
  status,
  cancelledBy,
}: {
  status: BookingStatus;
  cancelledBy?: CancelledByKind | null;
}) {
  return <StatusChip tone={toneOf(status)}>{bookingStatusLabel(status, cancelledBy)}</StatusChip>;
}
