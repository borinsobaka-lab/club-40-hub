import { StatusChip } from "@/components/ui/status-chip";
import { KB_STATUS_LABEL, type KbStatus } from "@/lib/kb/types";
import type { StatusTone } from "@/components/ui/status-chip-styles";

const TONE: Record<KbStatus, StatusTone> = {
  published: "positive",
  draft: "warning",
  archived: "neutral",
};

/**
 * Черновики и правки базы знаний — цветом базы (решение владельца
 * 2026-10-25: внутри базы всё «фирменное» — в её цвет; --brand внутри базы
 * подменяет StudioBranding).
 */
const BRAND_CHIP = "bg-brand/15 text-brand-on-light";

/** Статус статьи или папки базы знаний — его видит только редактор. */
export function KbStatusBadge({ status, size }: { status: KbStatus; size?: "sm" }) {
  return (
    <StatusChip
      tone={TONE[status]}
      size={size === "sm" ? "sm" : "default"}
      className={status === "draft" ? BRAND_CHIP : undefined}
    >
      {KB_STATUS_LABEL[status]}
    </StatusChip>
  );
}

/** «Есть правки» — у опубликованной статьи копится черновик правок. */
export function KbDraftBadge({ size }: { size?: "sm" }) {
  return (
    <StatusChip tone="info" size={size === "sm" ? "sm" : "default"} className={BRAND_CHIP}>
      Есть правки
    </StatusChip>
  );
}
