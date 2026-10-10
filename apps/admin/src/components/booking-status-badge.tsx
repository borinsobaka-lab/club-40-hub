import { Badge } from "@/components/ui/badge";
import { BOOKING_STATUS_LABEL, type BookingStatus } from "@/lib/bookings";

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const label = BOOKING_STATUS_LABEL[status] ?? status;
  if (status === "attended" || status === "completed") {
    return <Badge variant="default">{label}</Badge>;
  }
  if (status === "cancelled") return <Badge variant="destructive">{label}</Badge>;
  if (status === "rejected") {
    return (
      <Badge variant="outline" className="border-orange-600 text-orange-600">
        {label}
      </Badge>
    );
  }
  if (status === "no_show") return <Badge variant="outline">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}
