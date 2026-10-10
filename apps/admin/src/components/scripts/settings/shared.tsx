/** Общие кусочки вкладок «Настроек скриптов»: чипы, полосы, плитки, подгрузка. */
import type { ReactNode, RefObject } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHIP_TONES = {
  emerald: "bg-emerald-100 text-emerald-700",
  blue: "bg-blue-100 text-blue-700",
  rose: "bg-rose-100 text-rose-700",
  amber: "bg-amber-100 text-amber-800",
  muted: "bg-muted text-muted-foreground",
} as const;

export type ChipTone = keyof typeof CHIP_TONES;

/** Пилюля статуса — та же геометрия, что у Badge и статусов в разделах клуба. */
export function Chip({
  tone,
  children,
  className,
}: {
  tone: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        CHIP_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Полоса доли: числа рядом всегда видны текстом — полоса только помогает глазу. */
export function Bar({
  value,
  max,
  tone = "blue",
  className,
}: {
  value: number;
  max: number;
  tone?: "blue" | "emerald";
  className?: string;
}) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span
      aria-hidden
      className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          tone === "emerald" ? "bg-emerald-500" : "bg-blue-500",
        )}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

/** Плитка с числом — как KPI в NPS и на дашборде. */
export function StatTile({
  label,
  value,
  dim,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Не выбранный язык — приглушён, но виден. */
  dim?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border bg-background p-4", dim && "opacity-50")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** Пустое состояние вкладки: что здесь будет и откуда оно берётся. */
export function EmptyCard({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

/** Низ порционного списка: сюда доезжает прокрутка — грузится следующая порция. */
export function LoadMore({
  sentinel,
  hasMore,
  loading,
  onMore,
}: {
  sentinel: RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div ref={sentinel} className="flex justify-center py-2">
      <Button variant="outline" disabled={loading} onClick={onMore}>
        {loading && <Loader2 className="animate-spin" />}
        {loading ? "Загружаем…" : "Показать ещё"}
      </Button>
    </div>
  );
}

/** Название скрипта: жив — ссылка, удалён — зачёркнуто. */
export function ScriptTitle({
  title,
  onOpen,
  className,
}: {
  title: string;
  /** null — скрипт удалён. */
  onOpen: (() => void) | null;
  className?: string;
}) {
  if (!onOpen)
    return (
      <span className={cn("text-muted-foreground line-through", className)} title="Скрипт удалён">
        {title}
      </span>
    );
  return (
    <button
      type="button"
      title="Открыть скрипт"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={cn(
        "cursor-pointer text-left font-medium underline-offset-4 hover:underline",
        className,
      )}
    >
      {title}
    </button>
  );
}
