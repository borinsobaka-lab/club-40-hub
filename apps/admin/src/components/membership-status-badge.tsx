import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CMStatus = "active" | "frozen" | "replaced" | "expired" | "cancelled" | string;

export type MembershipStatusInput = {
  status: CMStatus | null | undefined;
  ends_at?: string | null;
  auto_renew?: boolean | null;
  cancelled_at?: string | null;
};

export function effectiveStatus(m: MembershipStatusInput): CMStatus {
  if (!m.status) return "expired";
  if (m.status === "active" && m.ends_at && m.ends_at < todayISO()) return "expired";
  return m.status;
}

const LABELS: Record<string, string> = {
  active: "Активен",
  frozen: "Заморожен",
  replaced: "Заменён",
  expired: "Истёк",
  cancelled: "Отменён",
};

const CLASSES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  frozen: "bg-blue-100 text-blue-700",
  replaced: "bg-amber-100 text-amber-700",
  expired: "bg-muted text-muted-foreground",
  cancelled: "bg-rose-100 text-rose-700",
};

export function MembershipStatusBadge({ m }: { m: MembershipStatusInput }) {
  const s = effectiveStatus(m);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        CLASSES[s] ?? CLASSES.expired,
      )}
    >
      {LABELS[s] ?? s}
    </span>
  );
}

export function AutoRenewBadge({ on }: { on: boolean | null | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        on ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground",
      )}
    >
      {on ? "Автопродление: вкл" : "Автопродление: выкл"}
    </span>
  );
}
