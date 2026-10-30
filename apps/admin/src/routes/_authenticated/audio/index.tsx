import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { Loader2, Play, RefreshCw } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useDayActions } from "@/hooks/use-audio-day-actions";
import { LocationsFilter } from "@/components/audio/locations-filter";
import { AaStatusBadge, MetricChips } from "@/components/audio/parts";
import { AudioDaysListSkeleton, AudioDaysPageSkeleton } from "@/components/page-skeletons";
import { RowContextMenu, type RowAction } from "@/components/row-context-menu";
import { TableToolbar, ToolbarReset } from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useAudioLocations } from "@/hooks/use-audio-locations";
import { plural } from "@/lib/academy/logic";
import { AUDIO_KEY, aaDaysQuery, aaLocationsQuery } from "@/lib/audio/data";
import { AUDIO_TITLES, DAY_ACTION_TEXT } from "@/lib/audio/labels";
import { clockTime, dayActions, formatCost, formatDuration, isInFlight } from "@/lib/audio/logic";
import type { AaDay } from "@/lib/audio/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/audio/")({
  head: () => ({ meta: [{ title: "Смены — Аудиоаналитика — Base40 Admin" }] }),
  pendingComponent: AudioDaysPageSkeleton,
  component: DaysPage,
});

/**
 * Смены: каждая строка — один рабочий день у стойки (сессия записи
 * приложения): кто работал, что записалось, как разговоры оценены метриками.
 * Разбор запускается вручную («Обработать») — до нажатия смена ничего не
 * стоит. Пока что-то в очереди или разбирается, список обновляется сам.
 */
function DaysPage() {
  const navigate = useNavigate();
  const access = useAdminAccess();
  const manage = !!access?.audio?.manage;
  const [selected, setSelected] = useAudioLocations();
  const locationsQuery = useQuery(aaLocationsQuery);
  const locations = locationsQuery.data ?? [];
  // Удалённые точки в выборе не держим.
  const ids = selected.filter((id) => locations.some((l) => l.id === id));
  const days = useQuery({
    ...aaDaysQuery(ids),
    // Сначала точки: иначе первый запрос ушёл бы без выбора, второй — с ним.
    enabled: !locationsQuery.isLoading,
    refetchInterval: (q) => ((q.state.data ?? []).some(isInFlight) ? 10_000 : false),
  });
  const fetching = useIsFetching({ queryKey: [AUDIO_KEY, "days"] }) > 0;
  const { run, busyId, rowActions, confirmDialog } = useDayActions();

  const list = days.data ?? [];
  const live = list.filter((d) => d.status === "recording").length;
  const waiting = list.filter((d) => d.status === "uploaded").length;

  return (
    <AdminShell title={AUDIO_TITLES.days}>
      <div className="space-y-3">
        <TableToolbar>
          <LocationsFilter locations={locations} selected={ids} onChange={setSelected} />
          <ToolbarReset active={ids.length > 0} onReset={() => setSelected([])} />
          {fetching && !days.isLoading && (
            <span className="inline-flex h-10 items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              обновляем…
            </span>
          )}
        </TableToolbar>

        {live > 0 && (
          <InfoNote variant="info">
            Прямо сейчас пишется{" "}
            {live === 1 ? "одна смена" : `${live} ${plural(live, ["смена", "смены", "смен"])}`}.
            После «Завершить день» в приложении она получит статус «Ждёт разбора».
          </InfoNote>
        )}
        {waiting > 0 && manage && (
          <InfoNote variant="info">
            {waiting} {plural(waiting, ["смена ждёт", "смены ждут", "смен ждут"])} разбора. Разбор
            не запускается сам — нажмите «Обработать» у тех смен, которые хотите разобрать, за
            остальные платить не придётся.
          </InfoNote>
        )}

        {days.isError ? (
          <InfoNote variant="warning">Не удалось загрузить смены. Обновите страницу.</InfoNote>
        ) : days.isLoading || locationsQuery.isLoading ? (
          <AudioDaysListSkeleton />
        ) : list.length === 0 ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            {ids.length
              ? "На выбранных точках смен ещё не было — поменяйте выбор точек."
              : "Смен пока нет. Запустите запись в приложении на ресепшене — смена появится здесь сразу после начала записи."}
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((d) => (
              <DayRow
                key={d.id}
                day={d}
                showLocation={ids.length !== 1}
                manage={manage}
                busy={busyId === d.id}
                onOpen={() =>
                  void navigate({ to: "/audio/$recordingId", params: { recordingId: d.id } })
                }
                onRun={(a) => void run(d.id, a)}
                actions={manage ? rowActions(d, dayLabel(d)) : []}
              />
            ))}
          </div>
        )}

        {list.length > 0 && manage && (
          <p className="px-1 text-xs text-muted-foreground">
            «Обработать» запускает распознавание и разбор — до нажатия смена просто лежит и ничего
            не стоит. «Пересчитать» прогоняет ту же расшифровку по текущим метрикам и промптам: речь
            заново не распознаётся, но модель оплачивается снова. «Распознать заново» — платное
            повторное распознавание, если расшифровка плохая. «Завершить принудительно» закрывает
            смену, которую приложение не закрыло само. «Удалить» безвозвратно стирает и аудио, и
            разбор. Разбор, который не двигался 3 часа, помечается «Разбор завис». Все действия — в
            меню смены (правый клик или долгое нажатие).
          </p>
        )}
      </div>
      {confirmDialog}
    </AdminShell>
  );
}

const dayLabel = (d: AaDay) =>
  `${format(parseISO(d.date), "d MMMM", { locale: ru })}${d.manager_name ? `, ${d.manager_name}` : ""}`;

function DayRow({
  day: d,
  showLocation,
  manage,
  busy,
  onOpen,
  onRun,
  actions,
}: {
  day: AaDay;
  showLocation: boolean;
  manage: boolean;
  busy: boolean;
  onOpen: () => void;
  onRun: (action: "process" | "recalc") => void;
  actions: RowAction[];
}) {
  const [showError, setShowError] = useState(false);
  const date = parseISO(d.date);
  const a = dayActions(d.status, d.stale);
  const detail = d.status_detail?.trim();
  return (
    <RowContextMenu actions={actions}>
      <div
        role="link"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
        className={cn(
          "grid cursor-pointer gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:p-4",
          d.status === "recording" && "border-blue-200",
        )}
      >
        <div>
          <div className="font-semibold">{format(date, "d MMMM", { locale: ru })}</div>
          <div className="text-xs text-muted-foreground first-letter:uppercase">
            {format(date, "EEEE", { locale: ru })}
            {d.created_at && ` · с ${clockTime(d.created_at, 0)}`}
          </div>
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">
              {d.manager_name ?? <span className="text-muted-foreground">менеджер не указан</span>}
            </span>
            {showLocation && (
              <span className="text-sm text-muted-foreground">· {d.location_name}</span>
            )}
            <AaStatusBadge status={d.status} stale={d.stale} />
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {d.total_duration_s != null
              ? `${formatDuration(d.total_duration_s)} записи, из них речи ${formatDuration(d.speech_duration_s)}`
              : "длительность появится после разбора"}
            {` · ${d.segments} ${plural(d.segments, ["сегмент", "сегмента", "сегментов"])}`}
            {d.dialogs_total != null &&
              ` · ${d.dialogs_total} ${plural(d.dialogs_total, ["разговор", "разговора", "разговоров"])}, продаж ${d.sales_count ?? 0}`}
            {d.cost_usd != null && (
              <span title="Стоимость последней обработки: распознавание плюс модель">
                {` · обработка ${formatCost(d.cost_usd)}`}
              </span>
            )}
          </div>
          {d.stale ? (
            <p className="text-xs text-rose-700">
              Статус не менялся с {formatDateTime(d.status_changed_at)} — разбор потерян. Запустите
              его заново.
            </p>
          ) : d.status === "error" && detail ? (
            <p className="text-xs text-rose-700">
              {showError || detail.length <= 160 ? detail : `${detail.slice(0, 160)}…`}
              {detail.length > 160 && (
                <button
                  type="button"
                  className="ml-1 font-medium underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowError(!showError);
                  }}
                >
                  {showError ? "Свернуть" : "Подробнее"}
                </button>
              )}
            </p>
          ) : detail && d.status !== "uploaded" ? (
            <p className="truncate text-xs text-muted-foreground" title={detail}>
              {detail}
            </p>
          ) : null}
          <MetricChips stats={d.metric_stats} />
        </div>
        {manage && (a.process || a.recalc) && (
          <div className="flex items-start sm:justify-end">
            <Button
              size="sm"
              variant={a.process ? "default" : "outline"}
              disabled={busy}
              title={
                a.process
                  ? "Распознать речь и разобрать разговоры этой смены"
                  : "Прогнать ту же расшифровку через модель заново — например, после правки метрик"
              }
              onClick={(e) => {
                e.stopPropagation();
                onRun(a.process ? "process" : "recalc");
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : a.process ? <Play /> : <RefreshCw />}
              {a.process === "restart"
                ? DAY_ACTION_TEXT.restart
                : a.process
                  ? DAY_ACTION_TEXT.process
                  : DAY_ACTION_TEXT.recalc}
            </Button>
          </div>
        )}
      </div>
    </RowContextMenu>
  );
}
