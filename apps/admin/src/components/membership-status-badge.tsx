import { useActiveStudio } from "@/hooks/use-studios";
import { effectiveStatus, type MembershipStatusInput } from "@/lib/membership-status";
import { cn } from "@/lib/utils";

// Статусы и effectiveStatus — lib/membership-status.ts (их проверяют тесты).

const LABELS: Record<string, string> = {
  active: "Активен",
  frozen: "Заморожен",
  pending: "Ждёт начала",
  replaced: "Заменён",
  expired: "Истёк",
  cancelled: "Отменён",
  refunded: "Возврат",
  awaiting: "Ожидает посещения",
};

const CLASSES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  frozen: "bg-blue-100 text-blue-700",
  pending: "bg-violet-100 text-violet-700",
  replaced: "bg-amber-100 text-amber-700",
  expired: "bg-muted text-muted-foreground",
  cancelled: "bg-rose-100 text-rose-700",
  refunded: "bg-orange-100 text-orange-700",
  awaiting: "bg-yellow-100 text-yellow-800",
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

/** У пакетов тренировок автопродления нет — в пакетной студии бейдж не нужен. */
export function AutoRenewBadge({ on }: { on: boolean | null | undefined }) {
  const format = useActiveStudio()?.format;
  if (format === "packages") return null;
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
