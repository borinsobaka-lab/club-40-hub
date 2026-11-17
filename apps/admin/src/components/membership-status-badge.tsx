import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  MEMBERSHIP_STATUS_LABEL,
  effectiveStatus,
  type MembershipStatusInput,
} from "@/lib/membership-status";

// Статусы и effectiveStatus — lib/membership-status.ts (их проверяют тесты).

const TONE: Record<string, StatusTone> = {
  active: "positive",
  frozen: "info",
  pending: "info",
  awaiting: "info",
  replaced: "neutral",
  expired: "neutral",
  cancelled: "negative",
  refunded: "negative",
};

export function MembershipStatusBadge({ m }: { m: MembershipStatusInput }) {
  const s = effectiveStatus(m);
  return <StatusChip tone={TONE[s] ?? "neutral"}>{MEMBERSHIP_STATUS_LABEL[s] ?? s}</StatusChip>;
}
