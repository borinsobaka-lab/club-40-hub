import { forwardRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Play } from "lucide-react";

import { CueText, ScoreChip } from "@/components/audio/parts";
import { FeedbackControl } from "@/components/audio/feedback";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { aaTurnsQuery } from "@/lib/audio/data";
import { DIALOG_TYPE_COLOR, DIALOG_TYPE_LABEL } from "@/lib/audio/labels";
import { clockTime, formatOffset, scoreTone, formatScore } from "@/lib/audio/logic";
import type { AaDialog, AaEvaluation, AaFeedback } from "@/lib/audio/types";
import { cn } from "@/lib/utils";

const CLOCK_TIP = "Время на часах: начало смены плюс смещение в записи";

/**
 * Разговор смены: время на часах студии и в записи, тип, суть, ▶ (плеер с
 * начала разговора), оценки по метрикам с «Согласен / не согласен» и
 * расшифровка (реплики грузятся при раскрытии). Личные разговоры — только
 * время: их текст не сохраняется.
 */
export const DialogCard = forwardRef<
  HTMLDivElement,
  {
    dialog: AaDialog;
    startedAt: string;
    timeZone: string;
    evaluations: AaEvaluation[];
    feedback: AaFeedback[];
    myId: string | null;
    highlighted?: boolean;
    onSeek: (s: number) => void;
  }
>(function DialogCard(
  { dialog, startedAt, timeZone, evaluations, feedback, myId, highlighted, onSeek },
  ref,
) {
  const [open, setOpen] = useState(!!highlighted);
  const [turnsOpen, setTurnsOpen] = useState(false);
  const turns = useQuery(aaTurnsQuery(dialog.id, turnsOpen));
  const clock = clockTime(startedAt, dialog.start_s, timeZone);
  const offset = `${formatOffset(dialog.start_s)}–${formatOffset(dialog.end_s)}`;

  if (dialog.type === "irrelevant")
    return (
      <div
        ref={ref}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground"
      >
        <span title={CLOCK_TIP} className="font-medium tabular-nums">
          {clock}
        </span>
        <span className="text-xs tabular-nums">{offset}</span>
        <span>Личный разговор — текст не сохраняется</span>
      </div>
    );

  const evals = evaluations.filter((e) => e.applicable);
  const disagreed = feedback.some((f) => f.dialog_id === dialog.id && !f.agree);

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border bg-background transition-shadow",
        highlighted && "ring-2 ring-ring",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: DIALOG_TYPE_COLOR[dialog.type] }}
          aria-hidden
        />
        <span title={CLOCK_TIP} className="font-semibold tabular-nums">
          {clock}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{offset}</span>
        <StatusChip tone="neutral">{DIALOG_TYPE_LABEL[dialog.type]}</StatusChip>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Слушать разговор"
          title="Слушать разговор"
          onClick={() => onSeek(dialog.start_s)}
        >
          <Play />
        </Button>
        {evals.map((e) =>
          e.score != null ? (
            <StatusChip
              key={e.metric_id}
              tone={scoreTone(e.score, e.scale_max)}
              className="tabular-nums"
            >
              {formatScore(e.score)}/{e.scale_max} · {e.metric_name}
            </StatusChip>
          ) : null,
        )}
        {disagreed && <StatusChip tone="warning">есть несогласие</StatusChip>}
      </div>
      {dialog.brief && <p className="px-3 pt-2 text-sm">{dialog.brief}</p>}
      {dialog.outcome && (
        <p className="px-3 pt-1 text-xs text-muted-foreground">Итог: {dialog.outcome}</p>
      )}
      <div className="flex flex-wrap gap-2 px-3 py-2">
        <Button
          size="sm"
          variant={open ? "secondary" : "outline"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Свернуть разбор" : "Смотреть разбор"}
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
        <Button
          size="sm"
          variant={turnsOpen ? "secondary" : "ghost"}
          aria-expanded={turnsOpen}
          onClick={() => setTurnsOpen(!turnsOpen)}
        >
          Расшифровка
          <ChevronDown className={cn("transition-transform", turnsOpen && "rotate-180")} />
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {evals.length > 0 ? (
            evals.map((e) => (
              <div key={e.metric_id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{e.metric_name}</span>
                  <ScoreChip score={e.score} scale={e.scale_max} />
                </div>
                {e.comment && (
                  <p className="text-sm">
                    <CueText text={e.comment} onSeek={onSeek} />
                  </p>
                )}
                {e.good.length > 0 && (
                  <List title="Сработало" tone="good" items={e.good} onSeek={onSeek} />
                )}
                {e.bad.length > 0 && (
                  <List title="Упущено" tone="bad" items={e.bad} onSeek={onSeek} />
                )}
                <FeedbackControl
                  key={`${e.metric_id}-${myId ?? ""}`}
                  dialogId={dialog.id}
                  metricId={e.metric_id}
                  items={feedback}
                  myId={myId}
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {evaluations.length > 0
                ? "Ни одна метрика не сработала на этом разговоре."
                : dialog.type === "service"
                  ? "Сервисные разговоры по метрикам не оцениваются."
                  : "Разговор по метрикам не оценивался: в нём слишком мало реплик."}
            </p>
          )}
        </div>
      )}

      {turnsOpen && (
        <div className="space-y-1.5 border-t px-3 py-3">
          {turns.isLoading ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)
          ) : (turns.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Реплик нет.</p>
          ) : (
            (turns.data ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSeek(t.start_s)}
                title="Слушать с этой реплики"
                className="grid w-full grid-cols-[4rem_minmax(0,1fr)] gap-x-2 rounded-md px-1 py-0.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[4rem_8rem_minmax(0,1fr)]"
              >
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatOffset(t.start_s)}
                </span>
                <span className="truncate text-xs font-medium text-muted-foreground max-sm:hidden">
                  {t.speaker_label}
                </span>
                <span>
                  <span className="font-medium sm:hidden">{t.speaker_label}: </span>
                  {t.text}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
});

function List({
  title,
  tone,
  items,
  onSeek,
}: {
  title: string;
  tone: "good" | "bad";
  items: string[];
  onSeek: (s: number) => void;
}) {
  return (
    <div>
      <p
        className={cn(
          "mb-1 text-xs font-medium uppercase",
          tone === "good" ? "text-emerald-700" : "text-rose-700",
        )}
      >
        {title}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((x, i) => (
          <li key={i}>
            <CueText text={x} onSeek={onSeek} />
          </li>
        ))}
      </ul>
    </div>
  );
}
