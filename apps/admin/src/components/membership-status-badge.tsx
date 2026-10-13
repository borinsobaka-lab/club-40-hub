import { useActiveStudio } from "@/hooks/use-studios";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * pending — продление пакетной студии ждёт, пока закончится текущий абонемент;
 * refunded — по продаже оформлен возврат (пакетные клубы, 2026-10-13);
 * awaiting — не статус базы: действующий абонемент пакетного клуба, по
 * которому ещё не было посещений (срок — с первого посещения).
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

export function effectiveStatus(m: MembershipStatusInput): CMStatus {
  if (!m.status) return "expired";
  if (m.status === "active" && m.starts_on_first_visit && !m.started_at) return "awaiting";
  if (m.status === "active" && m.ends_at && m.ends_at < todayISO()) return "expired";
  return m.status;
}

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
