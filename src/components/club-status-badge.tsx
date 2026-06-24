import { cn } from "@/lib/utils";
import { CLUB_STATUS_FULL, CLUB_STATUS_LABEL, type ClubStatus } from "@/lib/client-status";

const STYLES: Record<ClubStatus, string> = {
  chk: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  pchk: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  bchk: "bg-muted text-muted-foreground border-border",
};

export function ClubStatusBadge({
  status,
  className,
  withFull,
}: {
  status: ClubStatus;
  className?: string;
  withFull?: boolean;
}) {
  return (
    <span
      title={CLUB_STATUS_FULL[status]}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        STYLES[status],
        className,
      )}
    >
      {CLUB_STATUS_LABEL[status]}
      {withFull && <span className="ml-1 font-normal opacity-80">· {CLUB_STATUS_FULL[status]}</span>}
    </span>
  );
}
