import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { Loader2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { LocationsFilter } from "@/components/audio/locations-filter";
import { AaKpiTile, DeltaLine, ScoreChip } from "@/components/audio/parts";
import { ChartArea, ChartPanel, TrendPlot } from "@/components/dashboard/chart-panel";
import { SERIES_COLORS } from "@/components/dashboard/colors";
import { DateRangeFilter } from "@/components/date-range-filter";
import {
  AudioDashboardBodySkeleton,
  AudioDashboardPageSkeleton,
  DashboardFilterField,
} from "@/components/page-skeletons";
import { ToolbarReset } from "@/components/table-toolbar";
import { InfoNote } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useAudioLocations } from "@/hooks/use-audio-locations";
import { useTableSort } from "@/hooks/use-table-sort";
import { plural } from "@/lib/academy/logic";
import { AUDIO_KEY, aaLocationsQuery, aaManagersQuery, aaSummaryQuery } from "@/lib/audio/data";
import {
  AUDIO_FILTERS,
  AUDIO_KPI,
  AUDIO_TITLES,
  DASHBOARD_MANAGER_COLUMNS,
} from "@/lib/audio/labels";
import {
  PRESETS,
  deltaCost,
  deltaCount,
  deltaHours,
  deltaPoints,
  deltaScore,
  formatConversion,
  formatCost,
  formatHours,
  formatScore,
  matchPreset,
  presetPeriod,
  type Period,
  type PresetKey,
} from "@/lib/audio/logic";
import { aaViewAll, type AaSummary } from "@/lib/audio/types";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { sortRows } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/audio/dashboard")({
  head: () => ({ meta: [{ title: "Дашборд — Аудиоаналитика — Base40 Admin" }] }),
  pendingComponent: AudioDashboardPageSkeleton,
  component: DashboardPage,
});

const CHART_HEIGHT = 180;
const iso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Дашборд: растёт менеджер или проседает. Каждый показатель за период — рядом
 * со значением за предыдущий период такой же длины. Динамика — малыми
 * кратными: по графику на метрику, своя шкала у каждой (5- и 10-балльные на
 * одной оси дали бы ложное сравнение). У «своих смен» — только свои менеджеры.
 */
function DashboardPage() {
  const today = todayISO();
  const access = useAdminAccess();
  const viewAll = aaViewAll(access?.audio);
  const myManagers = access?.audio?.manager_ids ?? [];
  const [period, setPeriod] = useState<Period>(() => presetPeriod("30", today));
  const [managerId, setManagerId] = useState<string | null>(null);
  const [selected, setSelected] = useAudioLocations();
  const locationsQuery = useQuery(aaLocationsQuery);
  const locations = locationsQuery.data ?? [];
  const ids = selected.filter((id) => locations.some((l) => l.id === id));
  const { data: allManagers = [] } = useQuery(aaManagersQuery);
  const managers = viewAll ? allManagers : allManagers.filter((m) => myManagers.includes(m.id));
  // «Свои смены»: менеджер — только из своих (RLS и так отрежет чужое).
  const manager = managerId && managers.some((m) => m.id === managerId) ? managerId : null;
  const summary = useQuery({
    ...aaSummaryQuery(period.from, period.to, manager, ids),
    enabled: !locationsQuery.isLoading,
  });
  const fetching = useIsFetching({ queryKey: [AUDIO_KEY, "summary"] }) > 0;
  const preset = matchPreset(period, today);
  const changed = preset !== "30" || !!manager || ids.length > 0;

  return (
    <AdminShell title={AUDIO_TITLES.dashboard}>
      <div className="space-y-3">
        <div className="table-toolbar flex flex-wrap items-end gap-2 rounded-lg border bg-background p-2 sm:px-3">
          <SegmentedControl
            aria-label="Готовый период"
            value={(preset ?? "") as PresetKey}
            onChange={(k) => setPeriod(presetPeriod(k, today))}
            options={PRESETS}
          />
          <DashboardFilterField {...AUDIO_FILTERS.period}>
            <DateRangeFilter
              placeholder="Выберите период"
              showLabel={false}
              value={{ from: parseISO(period.from), to: parseISO(period.to) }}
              onChange={(r) => {
                if (!r?.from) return;
                setPeriod({ from: iso(r.from), to: iso(r.to ?? r.from) });
              }}
              className="w-full"
            />
          </DashboardFilterField>
          {(viewAll || managers.length > 1) && (
            <DashboardFilterField {...AUDIO_FILTERS.manager}>
              <Select
                value={manager ?? "all"}
                onValueChange={(v) => setManagerId(v === "all" ? null : v)}
              >
                <SelectTrigger aria-label="Менеджер" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{viewAll ? "Все менеджеры" : "Все мои смены"}</SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name}
                      {!m.active && " (отключён)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DashboardFilterField>
          )}
          {locations.length > 1 && (
            <DashboardFilterField {...AUDIO_FILTERS.locations}>
              <LocationsFilter
                locations={locations}
                selected={ids}
                onChange={setSelected}
                className="w-full"
              />
            </DashboardFilterField>
          )}
          <ToolbarReset
            active={changed}
            onReset={() => {
              setPeriod(presetPeriod("30", today));
              setManagerId(null);
              setSelected([]);
            }}
          />
          {fetching && !summary.isLoading && (
            <div className="inline-flex h-10 items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              обновляем…
            </div>
          )}
        </div>

        {!viewAll && myManagers.length === 0 && (
          <InfoNote variant="info">
            Ваша учётная запись не связана ни с одним менеджером — смен для вас нет. Попросите
            связать вас в «Аудиоаналитике» → «Менеджеры».
          </InfoNote>
        )}

        {summary.isError ? (
          <InfoNote variant="warning">Не удалось загрузить дашборд. Обновите страницу.</InfoNote>
        ) : summary.isLoading || !summary.data ? (
          <AudioDashboardBodySkeleton />
        ) : (
          <DashboardBody data={summary.data} />
        )}
      </div>
    </AdminShell>
  );
}

function DashboardBody({ data }: { data: AaSummary }) {
  const t = data.totals;
  const p = data.previous;
  const sort = useTableSort();
  const rows = sortRows(data.managers, sort.sort, {
    name: (m) => m.full_name,
    shifts: (m) => m.totals.shifts,
    dialogs: (m) => m.totals.dialogs,
    sales: (m) => m.totals.sales,
    conversion: (m) => m.totals.conversion,
  });
  const keys = ["name", "shifts", "dialogs", "sales", "conversion", null];

  // Все дни периода (до трёх месяцев) — дни без смен остаются разрывом линии.
  const days = useMemo(() => {
    const from = parseISO(data.date_from);
    const len = differenceInCalendarDays(parseISO(data.date_to), from) + 1;
    const all =
      len <= 92
        ? Array.from({ length: len }, (_, i) => iso(addDays(from, i)))
        : data.trend.map((x) => x.date);
    const byDate = new Map(data.trend.map((x) => [x.date, x]));
    return all.map((date) => ({ date, row: byDate.get(date) ?? null }));
  }, [data]);
  const axis = (date: string) => {
    const d = parseISO(date);
    return { tick: format(d, "dd.MM"), label: format(d, "d MMMM, EEEEEE", { locale: ru }) };
  };

  const num = "text-right [&>span]:justify-end";

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-muted-foreground">
        Сравнение с периодом {formatDate(data.prev_date_from)} — {formatDate(data.prev_date_to)}.
        Считаются только разобранные смены (статус «Готово»).
      </p>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <AaKpiTile
          {...AUDIO_KPI.shifts}
          value={formatNumber(t.shifts)}
          delta={deltaCount(t.shifts, p.shifts)}
        />
        <AaKpiTile
          {...AUDIO_KPI.dialogs}
          value={formatNumber(t.dialogs)}
          delta={deltaCount(t.dialogs, p.dialogs)}
        />
        <AaKpiTile
          {...AUDIO_KPI.sales}
          value={formatNumber(t.sales)}
          delta={deltaCount(t.sales, p.sales)}
        />
        <AaKpiTile
          {...AUDIO_KPI.conversion}
          value={formatConversion(t.conversion)}
          delta={deltaPoints(t.conversion, p.conversion)}
        />
        <AaKpiTile
          {...AUDIO_KPI.speech}
          value={formatHours(t.speech_seconds)}
          delta={deltaHours(t.speech_seconds, p.speech_seconds)}
        />
        <AaKpiTile
          {...AUDIO_KPI.cost}
          value={formatCost(t.cost_usd)}
          delta={deltaCost(Number(t.cost_usd), Number(p.cost_usd))}
        />
      </div>

      {t.shifts === 0 ? (
        <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
          За этот период разобранных смен нет. Выберите другой период или снимите фильтры.
        </div>
      ) : (
        <>
          {data.metrics.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
              {data.metrics.map((m) => (
                <AaKpiTile
                  key={m.metric_id}
                  label={m.name}
                  tip="Средняя оценка разговоров, где метрика сработала; сравнение — со средней за прошлый период."
                  value={
                    m.avg == null ? (
                      "—"
                    ) : (
                      <>
                        {formatScore(m.avg)}
                        <span className="text-sm font-normal text-muted-foreground">
                          /{m.scale_max}
                        </span>
                      </>
                    )
                  }
                  note={`сработала ${m.triggered} ${plural(m.triggered, ["раз", "раза", "раз"])}`}
                  delta={deltaScore(m.avg, m.prev_avg)}
                />
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ChartPanel
              title="Разговоры и продажи"
              tip="Сколько разговоров с клиентами и продаж было в разобранных сменах каждого дня."
              summary={
                <span className="inline-flex flex-wrap gap-x-3 text-xs">
                  <Legend color={SERIES_COLORS[0]} label="Разговоры" />
                  <Legend color={SERIES_COLORS[2]} label="Продажи" />
                </span>
              }
            >
              <ChartArea height={CHART_HEIGHT} loading={false} empty={data.trend.length === 0}>
                <TrendPlot
                  data={days.map(({ date, row }) => ({
                    ...axis(date),
                    dialogs: row?.dialogs ?? null,
                    sales: row?.sales ?? null,
                  }))}
                  series={[
                    { key: "dialogs", label: "Разговоры", color: SERIES_COLORS[0] },
                    { key: "sales", label: "Продажи", color: SERIES_COLORS[2] },
                  ]}
                  format={formatNumber}
                />
              </ChartArea>
            </ChartPanel>
            {data.metrics.map((m) => (
              <ChartPanel
                key={m.metric_id}
                title={m.name}
                tip={`Средняя оценка по дням, шкала 0–${m.scale_max}. У каждой метрики своя шкала — поэтому отдельный график.`}
                summary={m.avg != null && `за период ${formatScore(m.avg)}/${m.scale_max}`}
              >
                <ChartArea
                  height={CHART_HEIGHT}
                  loading={false}
                  empty={!data.trend.some((x) => x.avg_scores[m.metric_id] != null)}
                  emptyText="Метрика не срабатывала"
                >
                  <TrendPlot
                    data={days.map(({ date, row }) => ({
                      ...axis(date),
                      value: row?.avg_scores[m.metric_id] ?? null,
                    }))}
                    series={[{ key: "value", label: m.name, color: "var(--brand)" }]}
                    max={m.scale_max}
                    format={(n) => `${formatScore(n)} из ${m.scale_max}`}
                  />
                </ChartArea>
              </ChartPanel>
            ))}
          </div>

          <section className="min-w-0 rounded-lg border bg-background">
            <div className="border-b px-3 py-2 sm:px-4">
              <h3 className="text-sm font-semibold">Менеджеры</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  {DASHBOARD_MANAGER_COLUMNS.map((c, i) => (
                    <TableHead
                      key={c}
                      className={i > 0 && i < 5 ? num : undefined}
                      tip={
                        i === 5
                          ? "Средняя оценка за период; рядом — изменение к прошлому периоду."
                          : undefined
                      }
                      {...(keys[i] ? sort.head(keys[i]!) : {})}
                    >
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Нет смен за период
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((m) => (
                    <TableRow key={m.manager_id ?? "none"}>
                      <TableCell className="font-medium">{m.full_name}</TableCell>
                      <TableCell className="text-right">{m.totals.shifts}</TableCell>
                      <TableCell className="text-right">{m.totals.dialogs}</TableCell>
                      <TableCell className="text-right">{m.totals.sales}</TableCell>
                      <TableCell className="text-right">
                        {formatConversion(m.totals.conversion)}
                      </TableCell>
                      <TableCell>
                        {m.metrics.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            метрики не срабатывали
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {m.metrics.map((x) => (
                              <div
                                key={x.metric_id}
                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                              >
                                <span className="text-muted-foreground">{x.name}</span>
                                <ScoreChip score={x.avg} scale={x.scale_max} />
                                <DeltaLine delta={deltaScore(x.avg, x.prev_avg)} label="" />
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
