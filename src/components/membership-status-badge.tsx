import { cn } from "@/lib/utils";

export type CMStatus = "active" | "replaced" | "expired" | "cancelled" | string;

export type MembershipStatusInput = {
  status: CMStatus | null | undefined;
  ends_at?: string | null;
  auto_renew?: boolean | null;
  cancelled_at?: string | null;
};

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function effectiveStatus(m: MembershipStatusInput): CMStatus {
  if (!m.status) return "expired";
  if (m.status === "active" && m.ends_at && m.ends_at < todayISO()) return "expired";
  return m.status;
}

const LABELS: Record<string, string> = {
  active: "Активен",
  replaced: "Заменён",
  expired: "Истёк",
  cancelled: "Отменён",
};

const CLASSES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  replaced: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  expired: "bg-muted text-muted-foreground",
  cancelled: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
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
        on
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : "bg-muted text-muted-foreground",
      )}
    >
      {on ? "Автопродление: вкл" : "Автопродление: выкл"}
    </span>
  );
}
