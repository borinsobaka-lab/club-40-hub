import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { Mic, Play, RefreshCw, Square } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { CarriedAgreements, DayAgreements } from "@/components/audio/agreements";
import { useDayActions } from "@/hooks/use-audio-day-actions";
import { DialogCard } from "@/components/audio/dialog-card";
import { AaCard, AaKpiTile, AaStatusBadge, NotesPanel, ScoreChip } from "@/components/audio/parts";
import { AudioPlayer, type PlayerHandle } from "@/components/audio/player";
import { AudioReportBodySkeleton, AudioReportPageSkeleton } from "@/components/page-skeletons";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { plural } from "@/lib/academy/logic";
import { aaReportQuery, myUserIdQuery } from "@/lib/audio/data";
import { AUDIO_TITLES, DAY_ACTION_TEXT, DIALOG_TYPES, DIALOG_TYPE_LABEL } from "@/lib/audio/labels";
import {
  DEFAULT_TIMEZONE,
  clockTime,
  dayActions,
  formatConversion,
  formatCost,
  formatDuration,
  formatScore,
  isInFlight,
  isStale,
  metricStats,
} from "@/lib/audio/logic";
import { aaViewAll, type AaDialogType } from "@/lib/audio/types";
import { formatDateTime, formatNumber } from "@/lib/format";

const UUID = /^[0-9a-f-]{36}$/;

export const Route = createFileRoute("/_authenticated/audio/$recordingId")({
  validateSearch: (search: Record<string, unknown>): { dialog?: string } => ({
    // Ссылка на разговор (несогласие в «Метриках», договорённость) — прокрутить и подсветить.
    dialog:
      typeof search.dialog === "string" && UUID.test(search.dialog) ? search.dialog : undefined,
  }),
  head: () => ({ meta: [{ title: "Отчёт смены — Аудиоаналитика — Base40 Admin" }] }),
  pendingComponent: AudioReportPageSkeleton,
  component: ReportPage,
});

type TypeFilter = AaDialogType | "all";

/**
 * Отчёт смены: шапка, плеер всей смены, договорённости с прошлых смен
 * («Сделали?»), итоги и показатели, договорённости этой смены, разговоры с
 * оценками и расшифровкой. Метка времени в тексте разбора и ▶ у разговора
 * управляют плеером.
 */
function ReportPage() {
  const { recordingId } = Route.useParams();
  const { dialog: focusDialog } = Route.useSearch();
  const access = useAdminAccess();
  const manage = !!access?.audio?.manage;
  const viewAll = aaViewAll(access?.audio);
  const report = useQuery({
    ...aaReportQuery(recordingId),
    refetchInterval: (q) => {
      const r = q.state.data?.recording;
      return r && isInFlight({ status: r.status, stale: isStale(r.status, r.status_changed_at) })
        ? 15_000
        : false;
    },
  });
  const { data: myId = null } = useQuery(myUserIdQuery);
  const player = useRef<PlayerHandle>(null);
  const dialogRefs = useRef(new Map<string, HTMLDivElement>());
  const [type, setType] = useState<TypeFilter>("all");
  const { run, busyId, confirmDialog } = useDayActions();
  const seek = (s: number) => player.current?.seek(s);

  const data = report.data;
  const stats = useMemo(() => metricStats(data?.evaluations ?? []), [data?.evaluations]);

  // Ссылка на разговор: прокрутить к нему, когда отчёт загрузился.
  useEffect(() => {
    if (!focusDialog || !data) return;
    const el = dialogRefs.current.get(focusDialog);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusDialog, data]);

  const title = data
    ? `Смена ${format(parseISO(data.recording.date), "d MMMM yyyy", { locale: ru })}`
    : AUDIO_TITLES.report;

  if (report.isError)
    return (
      <AdminShell title={AUDIO_TITLES.report}>
        <InfoNote variant="warning">Не удалось загрузить отчёт смены. Обновите страницу.</InfoNote>
      </AdminShell>
    );
  if (report.isLoading)
    return (
      <AdminShell title={AUDIO_TITLES.report}>
        <AudioReportBodySkeleton />
      </AdminShell>
    );
  if (!data)
    return (
      <AdminShell title={AUDIO_TITLES.report}>
        <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
          Смена не найдена — её удалили или она вам не видна.{" "}
          <Link to="/audio" className="text-link hover:text-link-hover hover:underline">
            К списку смен
          </Link>
        </div>
      </AdminShell>
    );

  const r = data.recording;
  const tz = r.location?.timezone || DEFAULT_TIMEZONE;
  const stale = isStale(r.status, r.status_changed_at);
  const a = dayActions(r.status, stale);
  const busy = busyId === r.id;
  const summary = data.summary;
  const counts = new Map<TypeFilter, number>();
  for (const d of data.dialogs) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  const shown = data.dialogs.filter((d) => type === "all" || d.type === type);
  const evalsOf = (id: string) => data.evaluations.filter((e) => e.dialog_id === id);

  const actions = manage ? (
    <>
      {a.forceFinish && (
        <Button variant="outline" disabled={busy} onClick={() => void run(r.id, "finish")}>
          <Square />
          {DAY_ACTION_TEXT.finish}
        </Button>
      )}
      {a.full && (
        <Button variant="outline" disabled={busy} onClick={() => void run(r.id, "full")}>
          <Mic />
          {DAY_ACTION_TEXT.full}
        </Button>
      )}
      {(a.process || a.recalc) && (
        <Button disabled={busy} onClick={() => void run(r.id, a.process ? "process" : "recalc")}>
          {a.process ? <Play /> : <RefreshCw />}
          {a.process === "restart"
            ? DAY_ACTION_TEXT.restart
            : a.process
              ? DAY_ACTION_TEXT.process
              : DAY_ACTION_TEXT.recalc}
        </Button>
      )}
    </>
  ) : undefined;

  return (
    <AdminShell title={title} actions={actions}>
      <div className="space-y-3">
        <section className="space-y-1.5 rounded-lg border bg-background p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold first-letter:uppercase">
              {format(parseISO(r.date), "EEEE", { locale: ru })}
            </span>
            <span className="text-muted-foreground">·</span>
            <span>{r.location?.name ?? "Точка удалена"}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium">{r.manager?.full_name ?? "менеджер не указан"}</span>
            <AaStatusBadge status={r.status} stale={stale} />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            Начало в {clockTime(r.created_at, 0, tz)} · {formatDuration(r.total_duration_s)} записи,
            из них речи {formatDuration(r.speech_duration_s)}
            {manage && r.cost_usd != null && (
              <>
                {" · обработка "}
                <span className="font-medium text-foreground">{formatCost(r.cost_usd)}</span>
              </>
            )}
          </p>
          {manage && r.cost_usd != null && (
            <p className="text-xs text-muted-foreground tabular-nums">
              Распознавание {formatDuration(r.asr_seconds)} речи, обращений к модели{" "}
              {formatNumber(r.llm_calls)} ({formatNumber(r.llm_input_tokens)} вх. /{" "}
              {formatNumber(r.llm_output_tokens)} исх. токенов). Это стоимость последней обработки:
              «Пересчитать» тратит заново.
            </p>
          )}
          {r.status !== "done" && r.status_detail && (
            <p
              className={
                r.status === "error" ? "text-xs text-rose-700" : "text-xs text-muted-foreground"
              }
            >
              {r.status_detail}
              {r.status_changed_at && ` · ${formatDateTime(r.status_changed_at)}`}
            </p>
          )}
        </section>

        <div className="sticky top-0 z-20">
          <AudioPlayer
            ref={player}
            recordingId={r.id}
            dialogs={data.dialogs}
            totalDuration={r.total_duration_s}
            purged={!!r.audio_purged_at}
          />
        </div>

        <CarriedAgreements items={data.carried} recordingId={r.id} canResolve={viewAll} />

        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <AaKpiTile
            label="Конверсия"
            tip="Продажи / разговоры с клиентами за смену."
            value={formatConversion(summary?.conversion)}
          />
          <AaKpiTile label="Продажи" value={summary ? formatNumber(summary.sales_count) : "—"} />
          <AaKpiTile
            label="Разговоры с клиентами"
            value={summary ? formatNumber(summary.dialogs_total) : "—"}
          />
          <AaKpiTile label="Чистой речи" value={formatDuration(r.speech_duration_s)} />
        </div>

        {stats.length > 0 && (
          <AaCard title="Метрики за смену" hint="средняя оценка и сколько раз сработала">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {stats.map((s) => (
                <div key={s.metric_id} className="rounded-md border p-3">
                  <p className="truncate text-sm font-medium" title={s.name}>
                    {s.name}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xl font-semibold tabular-nums">
                      {s.avg == null ? "—" : formatScore(s.avg)}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{s.scale_max}
                      </span>
                    </span>
                    {s.avg != null && <ScoreChip score={s.avg} scale={s.scale_max} />}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    сработала {s.triggered} {plural(s.triggered, ["раз", "раза", "раз"])}
                  </p>
                  {s.avg != null && (
                    <div className="mt-2 h-1.5 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground/60"
                        style={{ width: `${Math.min(100, (s.avg / s.scale_max) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </AaCard>
        )}

        {summary?.summary && (
          <AaCard title="Итоги смены">
            {summary.summary.error ? (
              <InfoNote variant="warning">
                Итог смены не получился: {summary.summary.error}. Нажмите «Пересчитать».
              </InfoNote>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <NotesPanel
                  title="Главные отклонения"
                  items={summary.summary.top_deviations}
                  tone="bad"
                  onSeek={seek}
                />
                <NotesPanel
                  title="Удачные моменты"
                  items={summary.summary.highlights}
                  tone="good"
                  onSeek={seek}
                />
                <NotesPanel
                  title="Рекомендации менеджеру"
                  items={summary.summary.recommendations}
                  tone="info"
                  onSeek={seek}
                />
                <NotesPanel
                  title="Предложения по скрипту"
                  items={summary.summary.script_suggestions}
                  tone="neutral"
                  onSeek={seek}
                />
              </div>
            )}
          </AaCard>
        )}

        <DayAgreements
          items={data.agreements}
          recordingId={r.id}
          dialogs={data.dialogs}
          startedAt={r.created_at}
          timeZone={tz}
          canResolve={viewAll}
          myId={myId}
        />

        <AaCard
          title="Разговоры"
          hint={
            data.dialogs.length
              ? `${data.dialogs.length} ${plural(data.dialogs.length, ["разговор", "разговора", "разговоров"])} за смену`
              : undefined
          }
          actions={
            data.dialogs.length > 0 ? (
              <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
                <SelectTrigger aria-label="Тип разговора" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  {DIALOG_TYPES.filter((t) => counts.get(t)).map((t) => (
                    <SelectItem key={t} value={t}>
                      {DIALOG_TYPE_LABEL[t]} · {counts.get(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : undefined
          }
        >
          {data.dialogs.length === 0 ? (
            <InfoNote variant="empty">
              {r.status === "done"
                ? "Разговоров не найдено: либо в записи не было речи, либо смену стоит пересчитать."
                : "Разговоры появятся после разбора смены."}
            </InfoNote>
          ) : (
            <div className="space-y-2">
              {shown.map((d) => (
                <DialogCard
                  key={d.id}
                  ref={(el) => {
                    if (el) dialogRefs.current.set(d.id, el);
                    else dialogRefs.current.delete(d.id);
                  }}
                  dialog={d}
                  startedAt={r.created_at}
                  timeZone={tz}
                  evaluations={evalsOf(d.id)}
                  feedback={data.feedback}
                  myId={myId}
                  highlighted={d.id === focusDialog}
                  onSeek={seek}
                />
              ))}
            </div>
          )}
        </AaCard>
      </div>
      {confirmDialog}
    </AdminShell>
  );
}
