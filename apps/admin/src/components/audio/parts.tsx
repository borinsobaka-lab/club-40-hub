import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus, Play } from "lucide-react";

import { FieldHint } from "@/components/ui/field-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import {
  formatScore,
  metricChipText,
  scoreTone,
  splitCues,
  statusView,
  type Delta,
} from "@/lib/audio/logic";
import type { AaMetricStat, AaStatus } from "@/lib/audio/types";
import { cn } from "@/lib/utils";

/** Статус смены: «Ждёт разбора», «Готово», «Разбор завис»… */
export function AaStatusBadge({ status, stale }: { status: AaStatus; stale: boolean }) {
  const v = statusView(status, stale);
  return <StatusChip tone={v.tone}>{v.label}</StatusChip>;
}

/** Оценка «7.2/10» цветом зоны шкалы. */
export function ScoreChip({ score, scale }: { score: number | null; scale: number }) {
  if (score == null) return <span className="text-xs text-muted-foreground">не срабатывала</span>;
  return (
    <StatusChip tone={scoreTone(score, scale)} className="tabular-nums">
      {formatScore(score)}/{scale}
    </StatusChip>
  );
}

/** Чипы метрик смены: «Качество продажи: 4 · ★ 7.2/10». */
export function MetricChips({ stats }: { stats: AaMetricStat[] }) {
  if (stats.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {stats.map((s) => (
        <StatusChip
          key={s.metric_id}
          tone={s.avg == null ? "neutral" : scoreTone(s.avg, s.scale_max)}
          title="Сколько раз метрика сработала за смену и средняя оценка"
          className="tabular-nums"
        >
          {metricChipText(s)}
        </StatusChip>
      ))}
    </div>
  );
}

/** Сравнение с прошлым периодом: стрелка, текст, цвет — хорошо или плохо. */
export function DeltaLine({ delta, label = "к прошлому" }: { delta: Delta; label?: string }) {
  if (!delta) return <span className="text-xs text-muted-foreground">нет базы сравнения</span>;
  const Icon = delta.good === null ? Minus : delta.text.startsWith("+") ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs tabular-nums",
        delta.good === null
          ? "text-muted-foreground"
          : delta.good
            ? "text-emerald-700"
            : "text-rose-600",
      )}
    >
      <Icon className="h-3 w-3" />
      {delta.text}
      {delta.good !== null || delta.text !== "без изменений" ? (
        <span className="text-muted-foreground">{label}</span>
      ) : null}
    </span>
  );
}

/** Плитка показателя: подпись с «?», значение, сравнение. */
export function AaKpiTile({
  label,
  tip,
  value,
  note,
  delta,
  loading,
}: {
  label: string;
  tip?: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  delta?: Delta;
  loading?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-background px-3 py-2.5 sm:px-4 sm:py-3">
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground sm:text-sm">
        <span className="truncate">{label}</span>
        {tip && <FieldHint>{tip}</FieldHint>}
      </p>
      {loading ? (
        <>
          <Skeleton className="mt-1.5 h-6 w-24" />
          {delta !== undefined && <Skeleton className="mt-1.5 h-3 w-28" />}
        </>
      ) : (
        <>
          <p className="mt-0.5 truncate text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
          {note && <p className="truncate text-xs text-muted-foreground">{note}</p>}
          {delta !== undefined && (
            <div className="mt-1">
              <DeltaLine delta={delta} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Белая карточка блока страницы: заголовок, «?», справа — действия. */
export function AaCard({
  title,
  tip,
  hint,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  tip?: ReactNode;
  /** Мелкая подпись рядом с заголовком. */
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-background", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
        <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
          <span className="inline-flex items-center gap-1">
            {title}
            {tip && <FieldHint>{tip}</FieldHint>}
          </span>
          {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
        </h3>
        {actions}
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

/**
 * Текст разбора, где метки времени [ЧЧ:ММ:СС] — кнопки «слушать с этого
 * места» (без плеера — просто текст).
 */
export function CueText({ text, onSeek }: { text: string; onSeek?: (s: number) => void }) {
  return (
    <>
      {splitCues(text).map((p, i) =>
        "cue" in p ? (
          onSeek ? (
            <button
              key={i}
              type="button"
              title="Слушать с этого места"
              onClick={() => onSeek(p.seconds)}
              className="mx-0.5 inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 align-baseline text-xs font-medium tabular-nums text-foreground hover:bg-muted-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Play className="h-2.5 w-2.5" />
              {p.cue}
            </button>
          ) : (
            <span key={i} className="text-xs tabular-nums text-muted-foreground">
              [{p.cue}]
            </span>
          )
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Список выводов («Главные отклонения», «Удачные моменты»…) в плашке тона. */
export function NotesPanel({
  title,
  items,
  tone,
  onSeek,
}: {
  title: string;
  items: string[];
  tone: "good" | "bad" | "info" | "neutral";
  onSeek?: (s: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        tone === "good" && "border-emerald-200 bg-emerald-50/60",
        tone === "bad" && "border-rose-200 bg-rose-50/60",
        tone === "info" && "border-blue-200 bg-blue-50/60",
        tone === "neutral" && "bg-muted/40",
      )}
    >
      <p
        className={cn(
          "mb-1.5 text-xs font-medium uppercase",
          tone === "good" && "text-emerald-700",
          tone === "bad" && "text-rose-700",
          tone === "info" && "text-blue-700",
          tone === "neutral" && "text-muted-foreground",
        )}
      >
        {title}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((item, i) => (
          <li key={i}>
            <CueText text={item} onSeek={onSeek} />
          </li>
        ))}
      </ul>
    </div>
  );
}
