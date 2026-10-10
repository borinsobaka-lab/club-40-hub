import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronLeft, ChevronRight, Loader2, Trash2, Copy, X } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { clientName, formatDate, toDateTimeLocalValue } from "@/lib/format";
import { DAY_TYPES, dayTypeColor } from "@/lib/workout-types";
import { Button } from "@/components/ui/button";
import { CheckboxOption, FormField, InfoNote } from "@/components/ui/form-field";
import { TableToolbar, ToolbarReset } from "@/components/table-toolbar";
import { ClientNameLink } from "@/components/client-name-link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({ meta: [{ title: "Расписание — Base40 Admin" }] }),
  component: SchedulePage,
});

type Workout = { id: string; name: string; type?: string | null; capacity?: number | null };
type Trainer = { id: string; full_name: string };
type Entry = {
  id: string;
  studio_id: string;
  workout_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  booked_count: number;
  waitlist_count?: number | null;
  workout?: { name: string; type?: string; capacity?: number | null } | null;
  schedule_entry_trainers?: { trainer_id: string; trainer: Trainer | null }[];
};

/** Занятие к созданию: строка schedule_entries и тренеры, которых к ней привязать. */
type EntryDraft = { workout_id: string; starts_at: string; ends_at: string; trainerIds: string[] };

const ENTRY_SELECT =
  "*, workout:workouts(name, type, capacity), schedule_entry_trainers(trainer_id, trainer:trainers(id, full_name))";
// Колонки справочников входят в ключ запроса: разделы «Тренировки» и «Сотрудники»
// грузят те же таблицы целиком, и общий ключ подсовывал бы им наш урезанный кэш.
const WORKOUT_COLS = "id, name, type, capacity";
const TRAINER_COLS = "id, full_name";

const ADMIN_CANCEL_REASONS = [
  "Клиент отменил",
  "Клиент не пришёл",
  "Замена или перенос",
  "Технические причины",
  "Другое",
];
const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7..22
const SLOT_PX_FULL = 88;
const SLOT_PX_EMPTY = 28;
const ALL_FILTER_VALUE = "all";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfWeek(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function nextFullHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Ячейка сетки «день + час». */
function cellKey(day: Date, hour: number) {
  return `${day.toDateString()}|${hour}`;
}

/** «Тренировка + начало» — так узнаём одно и то же занятие в разных выборках. */
function entryKey(workoutId: string, startsAt: string) {
  return `${workoutId}|${new Date(startsAt).toISOString()}`;
}

function trainerIdsOf(e: Entry) {
  return e.schedule_entry_trainers?.map((x) => x.trainer_id) ?? [];
}

/**
 * Вместимость занятия: своя или по умолчанию из тренировки; 0 и пусто — без
 * лимита. Одна на сетку и панель записей: панель раньше брала только свою и
 * при вместимости из тренировки показывала «3» вместо «3 / 12».
 */
function entryCapacity(e: Entry) {
  return (e.capacity ?? e.workout?.capacity) || null;
}

/** Копия занятия с новым началом: та же тренировка, длительность и тренеры. */
function copyDraft(e: Entry, start: Date): EntryDraft {
  const duration = new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime();
  return {
    workout_id: e.workout_id,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + duration).toISOString(),
    trainerIds: trainerIdsOf(e),
  };
}

/** Привязывает тренеров к занятиям; возвращает текст ошибки или null. */
async function linkTrainers(links: { entry_id: string; trainer_id: string }[]) {
  if (links.length === 0) return null;
  const { error } = await supabase.from("schedule_entry_trainers").insert(links);
  return error?.message ?? null;
}

type InsertResult =
  | { ok: false; error: string }
  | { ok: true; count: number; trainersError: string | null };

/**
 * Создаёт занятия вместе с привязками тренеров — общий путь для «Нового
 * занятия», вставки скопированного и «Дублировать неделю». Ошибку привязки
 * тренеров отдаём отдельно: занятия к этому моменту уже созданы, и повторная
 * вставка дала бы дубли.
 */
async function insertEntries(studioId: string, drafts: EntryDraft[]): Promise<InsertResult> {
  const { data, error } = await supabase
    .from("schedule_entries")
    .insert(
      drafts.map((d) => ({
        studio_id: studioId,
        workout_id: d.workout_id,
        starts_at: d.starts_at,
        ends_at: d.ends_at,
      })),
    )
    .select("id, workout_id, starts_at");
  if (error || !data) return { ok: false, error: error?.message ?? "" };
  // Тренеров сопоставляем по «тренировка + начало», а не по порядку строк:
  // порядок строк в ответе на вставку база не гарантирует.
  const trainersByKey = new Map(
    drafts.map((d) => [entryKey(d.workout_id, d.starts_at), d.trainerIds]),
  );
  const links = data.flatMap((row: { id: string; workout_id: string; starts_at: string }) =>
    (trainersByKey.get(entryKey(row.workout_id, row.starts_at)) ?? []).map((trainer_id) => ({
      entry_id: row.id,
      trainer_id,
    })),
  );
  return { ok: true, count: data.length, trainersError: await linkTrainers(links) };
}

function SchedulePage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [presetStart, setPresetStart] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<string>(ALL_FILTER_VALUE);
  const [filterTrainerId, setFilterTrainerId] = useState<string>(ALL_FILTER_VALUE);
  const [copySource, setCopySource] = useState<Entry | null>(null);
  const [pasting, setPasting] = useState(false);
  const [duplicatingWeek, setDuplicatingWeek] = useState(false);

  // Справочники зависят только от студии, занятия — ещё и от недели: листание
  // недель не перезапрашивает тренировки и тренеров.
  const { data: workouts = [], isFetching: workoutsFetching } = useQuery({
    queryKey: ["workouts", studioId, WORKOUT_COLS],
    queryFn: () =>
      unwrap<Workout[]>(
        supabase.from("workouts").select(WORKOUT_COLS).eq("studio_id", studioId!).order("name"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Ошибка загрузки тренировок" },
  });
  const { data: trainers = [], isFetching: trainersFetching } = useQuery({
    queryKey: ["trainers", studioId, TRAINER_COLS],
    queryFn: () =>
      unwrap<Trainer[]>(
        supabase
          .from("trainers")
          .select(TRAINER_COLS)
          .eq("studio_id", studioId!)
          .order("full_name"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Ошибка загрузки тренеров" },
  });
  // Без placeholderData: пока грузится новая неделя, занятий нет вовсе, а не
  // занятия прошлой — иначе «Дублировать неделю» скопировал бы чужую неделю.
  // Ответ, пришедший после перелистывания, ложится в кэш своей недели.
  const weekFrom = weekStart.toISOString();
  const { data: entries = [], isFetching: entriesFetching } = useQuery({
    queryKey: ["schedule_entries", studioId, weekFrom],
    queryFn: () =>
      unwrap<Entry[]>(
        supabase
          .from("schedule_entries")
          .select(ENTRY_SELECT)
          .eq("studio_id", studioId!)
          .gte("starts_at", weekFrom)
          .lt("starts_at", addDays(weekStart, 7).toISOString())
          .order("starts_at"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Ошибка загрузки расписания" },
  });
  const loading = workoutsFetching || trainersFetching || entriesFetching;
  const reloadEntries = () => queryClient.invalidateQueries({ queryKey: ["schedule_entries"] });

  const weekLabel = `${fmtDate(weekStart)} — ${fmtDate(addDays(weekStart, 6))}`;
  const isCurrentWeek = startOfWeek(new Date()).toDateString() === weekStart.toDateString();
  const filtersActive = filterType !== ALL_FILTER_VALUE || filterTrainerId !== ALL_FILTER_VALUE;

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // Видимые занятия раскладываем по ячейкам один раз, а не сканируем весь
  // список для каждой ячейки и каждого часа.
  const grid = useMemo(() => {
    const cells = new Map<string, Entry[]>();
    const busyHours = new Set<number>();
    for (const e of entries) {
      if (filterType !== ALL_FILTER_VALUE && e.workout?.type !== filterType) continue;
      if (
        filterTrainerId !== ALL_FILTER_VALUE &&
        !e.schedule_entry_trainers?.some((x) => x.trainer_id === filterTrainerId)
      )
        continue;
      const start = new Date(e.starts_at);
      const key = cellKey(start, start.getHours());
      cells.set(key, [...(cells.get(key) ?? []), e]);
      busyHours.add(start.getHours());
    }
    return { cells, busyHours };
  }, [entries, filterType, filterTrainerId]);

  const openSlot = (day: Date, hour: number) => {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    if (copySource) {
      pasteCopy(copySource, start);
      return;
    }
    setEditing(null);
    setPresetStart(start);
    setDialogOpen(true);
  };

  const startCopy = (e: Entry) => {
    setCopySource(e);
    toast.message("Выберите пустой слот, куда скопировать занятие");
  };

  const pasteCopy = async (source: Entry, start: Date) => {
    if (!studioId || pasting) return;
    setPasting(true);
    try {
      const res = await insertEntries(studioId, [copyDraft(source, start)]);
      if (!res.ok) {
        toast.error("Ошибка копирования: " + res.error);
        return;
      }
      setCopySource(null);
      if (res.trainersError) {
        toast.error("Занятие создано, но тренеры не привязаны: " + res.trainersError);
      } else {
        toast.success("Занятие скопировано");
      }
      reloadEntries();
    } finally {
      setPasting(false);
    }
  };

  const duplicateWeek = async () => {
    if (!studioId || duplicatingWeek) return;
    if (entries.length === 0) {
      toast.error("На текущей неделе нет занятий для копирования");
      return;
    }
    const nextWeekStart = addDays(weekStart, 7);
    // Подтверждение — до копирования; само копирование идёт со спиннером на
    // кнопке в шапке, при ошибке её можно нажать снова.
    if (
      !(await confirm({
        title: "Дублировать неделю?",
        description: `Все занятия с недели ${weekLabel} (${entries.length}) будут скопированы на следующую неделю (${fmtDate(nextWeekStart)} — ${fmtDate(addDays(nextWeekStart, 6))}) в те же дни и время, с теми же тренерами. Записи клиентов не копируются. Уже существующие на следующей неделе занятия (тот же тип и время) пропускаются.`,
        confirmLabel: "Дублировать",
        destructive: false,
      }))
    )
      return;
    setDuplicatingWeek(true);
    try {
      // Уже стоящие на следующей неделе занятия (та же тренировка и время) не дублируем.
      const { data: existing, error: exErr } = await supabase
        .from("schedule_entries")
        .select("workout_id, starts_at")
        .eq("studio_id", studioId)
        .gte("starts_at", nextWeekStart.toISOString())
        .lt("starts_at", addDays(nextWeekStart, 7).toISOString());
      if (exErr) {
        toast.error("Ошибка проверки следующей недели: " + exErr.message);
        return;
      }
      const existingKeys = new Set(
        (existing ?? []).map((e: { workout_id: string; starts_at: string }) =>
          entryKey(e.workout_id, e.starts_at),
        ),
      );
      const drafts = entries
        .map((e) => copyDraft(e, new Date(new Date(e.starts_at).getTime() + WEEK_MS)))
        .filter((d) => !existingKeys.has(entryKey(d.workout_id, d.starts_at)));
      if (drafts.length === 0) {
        toast.info("Все занятия уже скопированы на следующую неделю");
        return;
      }

      const res = await insertEntries(studioId, drafts);
      if (!res.ok) {
        toast.error("Ошибка копирования недели: " + res.error);
        return;
      }
      if (res.trainersError) {
        toast.error("Занятия скопированы, но тренеры не привязаны: " + res.trainersError);
      } else {
        toast.success(`Скопировано занятий: ${res.count}`);
      }
      setWeekStart(nextWeekStart);
    } finally {
      setDuplicatingWeek(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setPresetStart(null);
    setDialogOpen(true);
  };

  const openEdit = (e: Entry) => {
    setEditing(e);
    setPresetStart(null);
    setDialogOpen(true);
  };

  /** true — занятие удалено (окно можно закрыть), false — отказ или ошибка. */
  const handleDelete = async (e: Entry) => {
    if (
      !(await confirm({
        title: "Удалить занятие?",
        // Брони (schedule_bookings) удаляются каскадом, а журнал переводит в
        // «Отменено» триггер db/schedule_entry_delete.sql.
        description:
          "Записи клиентов на него будут отменены — в истории записей они останутся со статусом «Отменено».",
      }))
    )
      return false;
    const { error } = await supabase.from("schedule_entries").delete().eq("id", e.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return false;
    }
    toast.success("Занятие удалено");
    reloadEntries();
    return true;
  };

  return (
    <AdminShell
      title="Расписание"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={duplicateWeek}
            disabled={!studioId || entries.length === 0 || loading || duplicatingWeek}
          >
            {duplicatingWeek ? <Loader2 className="animate-spin" /> : <Copy />}
            Дублировать неделю
          </Button>
          <Button onClick={openAdd} disabled={!studioId || workouts.length === 0}>
            <Plus />
            Добавить занятие
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Предыдущая неделя"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                onClick={() => setWeekStart(startOfWeek(new Date()))}
                disabled={isCurrentWeek}
              >
                Текущая неделя
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Следующая неделя"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
              >
                <ChevronRight />
              </Button>
              <span className="ml-1 text-sm font-medium">{weekLabel}</span>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Все типы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Все типы</SelectItem>
                  {DAY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterTrainerId} onValueChange={setFilterTrainerId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Все тренеры" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Все тренеры</SelectItem>
                  {trainers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ToolbarReset
                active={filtersActive}
                onReset={() => {
                  setFilterType(ALL_FILTER_VALUE);
                  setFilterTrainerId(ALL_FILTER_VALUE);
                }}
              />
            </div>
          </TableToolbar>

          {copySource && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                {pasting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>
                  Копирование «{copySource.workout?.name ?? "Занятие"}» — кликните на свободный
                  слот, чтобы вставить.
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCopySource(null)}
                disabled={pasting}
              >
                <X />
                Отмена
              </Button>
            </div>
          )}

          <div className="max-h-[calc(100vh-220px)] overflow-auto rounded-lg border bg-background">
            <div
              className="grid min-w-[1200px]"
              style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}
            >
              <div className="sticky top-0 z-20 border-b border-r bg-background" />
              {weekDays.map((d, i) => {
                const today = d.toDateString() === new Date().toDateString();
                return (
                  <div
                    key={i}
                    className={`sticky top-0 z-20 border-r bg-background p-2 text-center text-xs ${
                      today ? "border-b-4 border-b-brand font-semibold text-primary" : "border-b"
                    }`}
                  >
                    <div className="uppercase tracking-wide text-muted-foreground">
                      {DAY_NAMES[i]}
                    </div>
                    <div>{d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</div>
                  </div>
                );
              })}

              {HOURS.map((hour) => {
                const rowHeight = grid.busyHours.has(hour) ? SLOT_PX_FULL : SLOT_PX_EMPTY;
                return (
                  <div key={`row-${hour}`} className="contents">
                    <div
                      className="border-b border-r px-2 text-right text-xs text-muted-foreground"
                      style={{ height: rowHeight, lineHeight: "1rem", paddingTop: 4 }}
                    >
                      {pad(hour)}:00
                    </div>
                    {weekDays.map((day, di) => (
                      <div
                        key={`${hour}-${di}`}
                        className="relative border-b border-r"
                        style={{ height: rowHeight }}
                      >
                        {/*
                          Кнопка слота лежит под карточками, а не оборачивает их:
                          кнопка внутри кнопки — невалидный HTML и ломает доступность.
                        */}
                        <button
                          type="button"
                          aria-label={`${copySource ? "Вставить" : "Добавить"} занятие: ${DAY_NAMES[di]}, ${pad(hour)}:00`}
                          onClick={() => openSlot(day, hour)}
                          className="absolute inset-0 transition hover:bg-accent/40"
                        />
                        {grid.cells.get(cellKey(day, hour))?.map((e) => (
                          <EntryCard
                            key={e.id}
                            entry={e}
                            onOpen={() => openEdit(e)}
                            onCopy={() => startCopy(e)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {workouts.length === 0 && (
            <InfoNote variant="empty">
              Чтобы добавить занятие, сначала создайте тренировки в разделе «Тренировки».
            </InfoNote>
          )}
        </RequireStudio>
      </div>

      <EntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        studioId={studioId}
        workouts={workouts}
        trainers={trainers}
        entry={editing}
        presetStart={presetStart}
        onSaved={reloadEntries}
        onDelete={handleDelete}
      />

      {confirmDialog}
    </AdminShell>
  );
}

/** Бейдж «записано/мест» и очередь листа ожидания на карточке занятия. */
function CapacityBadge({ entry }: { entry: Entry }) {
  const cap = entryCapacity(entry);
  if (!cap) return null;
  const left = Math.max(0, cap - entry.booked_count);
  const waiting = entry.waitlist_count ?? 0;
  const tone =
    left === 0
      ? "bg-red-500/90 text-white"
      : left <= 5
        ? "bg-amber-500/90 text-white"
        : "bg-black/25 text-white";
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className={`rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums ${tone}`}>
        {entry.booked_count}/{cap}
      </span>
      {waiting > 0 && (
        <span
          title="Люди в листе ожидания — записались, когда мест уже не было"
          className="rounded bg-blue-500/90 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-white"
        >
          +{waiting}
        </span>
      )}
    </span>
  );
}

function EntryCard({
  entry,
  onOpen,
  onCopy,
}: {
  entry: Entry;
  onOpen: () => void;
  onCopy: () => void;
}) {
  const names =
    entry.schedule_entry_trainers
      ?.map((x) => x.trainer?.full_name)
      .filter(Boolean)
      .join(", ") ?? "";
  const color = dayTypeColor(entry.workout?.type);
  const colorClasses = color ? `${color.bg} ${color.text}` : "bg-primary text-primary-foreground";
  return (
    <div
      className={`absolute inset-1 overflow-hidden rounded-md text-[11px] leading-tight ${colorClasses}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full cursor-pointer flex-col px-2 py-1 text-left hover:opacity-90"
      >
        <span className="flex w-full items-start justify-between gap-1">
          <span className="whitespace-nowrap opacity-80">
            {fmtTime(entry.starts_at)}–{fmtTime(entry.ends_at)}
          </span>
          <CapacityBadge entry={entry} />
        </span>
        <span className="font-medium line-clamp-2">{entry.workout?.name ?? "Занятие"}</span>
        {names && <span className="block truncate opacity-80">{names}</span>}
      </button>
      {/* Соседняя кнопка поверх карточки, а не вложенная в неё — там же, где была. */}
      <button
        type="button"
        aria-label="Копировать занятие"
        title="Копировать занятие"
        onClick={onCopy}
        className="absolute bottom-1 right-2 rounded bg-black/25 p-0.5 text-white hover:bg-black/40"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

type EntryDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  workouts: Workout[];
  trainers: Trainer[];
  entry: Entry | null;
  presetStart: Date | null;
  onSaved: () => void;
  /** Спрашивает подтверждение и удаляет; true — удалено. */
  onDelete: (entry: Entry) => Promise<boolean>;
};

function EntryDialog({ open, ...formProps }: EntryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={formProps.onOpenChange}>
      {/* Одна ширина для создания и правки: записи идут под полями, в том же теле. */}
      <DialogContent className="max-w-2xl">
        {/*
          Форма монтируется при каждом открытии и сбрасывать её не нужно. Раньше
          поля сбрасывал эффект по списку тренировок, и любая перезагрузка
          («Посетил» в панели записей, «Обновить» в шапке) затирала правки.
        */}
        <EntryForm key={formProps.entry?.id ?? "new"} {...formProps} />
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({
  onOpenChange,
  studioId,
  workouts,
  trainers,
  entry,
  presetStart,
  onSaved,
  onDelete,
}: Omit<EntryDialogProps, "open">) {
  const [workoutId, setWorkoutId] = useState(entry?.workout_id ?? workouts[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState(() =>
    toDateTimeLocalValue(entry ? new Date(entry.starts_at) : (presetStart ?? nextFullHour())),
  );
  const [endsAt, setEndsAt] = useState(() => {
    if (entry) return toDateTimeLocalValue(new Date(entry.ends_at));
    const end = new Date(startsAt);
    end.setHours(end.getHours() + 1);
    return toDateTimeLocalValue(end);
  });
  const [trainerIds, setTrainerIds] = useState<string[]>(() => (entry ? trainerIdsOf(entry) : []));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;

  const toggleTrainer = (id: string) => {
    setTrainerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /** Правка занятия: строка и полный пересбор тренеров. Возвращает текст ошибки. */
  const updateEntry = async (id: string, row: Record<string, string>) => {
    const { error } = await supabase.from("schedule_entries").update(row).eq("id", id);
    if (error) return "Ошибка сохранения: " + error.message;
    const { error: delErr } = await supabase
      .from("schedule_entry_trainers")
      .delete()
      .eq("entry_id", id);
    if (delErr) return "Ошибка обновления тренеров: " + delErr.message;
    const linkErr = await linkTrainers(
      trainerIds.map((trainer_id) => ({ entry_id: id, trainer_id })),
    );
    return linkErr ? "Ошибка добавления тренеров: " + linkErr : null;
  };

  const handleSave = async () => {
    if (!studioId) return;
    if (!workoutId) {
      toast.error("Выберите тренировку");
      return;
    }
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (!(startDate.getTime() < endDate.getTime())) {
      toast.error("Время окончания должно быть позже начала");
      return;
    }
    const row = {
      workout_id: workoutId,
      starts_at: startDate.toISOString(),
      ends_at: endDate.toISOString(),
    };
    setSaving(true);
    try {
      if (entry) {
        const failure = await updateEntry(entry.id, { studio_id: studioId, ...row });
        if (failure) {
          toast.error(failure);
          return;
        }
        toast.success("Занятие обновлено");
      } else {
        const res = await insertEntries(studioId, [{ ...row, trainerIds }]);
        if (!res.ok) {
          toast.error("Ошибка сохранения: " + res.error);
          return;
        }
        // Занятие уже создано: окно закрываем и при ошибке тренеров, иначе
        // повторное «Сохранить» создало бы второе такое же.
        if (res.trainersError) {
          toast.error("Занятие добавлено, но тренеры не привязаны: " + res.trainersError);
        } else {
          toast.success("Занятие добавлено");
        }
      }
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  // Сначала подтверждение, потом закрытие: при отказе окно с правками остаётся.
  const handleDelete = async () => {
    if (!entry) return;
    setDeleting(true);
    try {
      if (await onDelete(entry)) onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{entry ? "Редактировать занятие" : "Новое занятие"}</DialogTitle>
        <DialogDescription>
          {entry
            ? "Настройки занятия, ниже — записанные участники."
            : "Выберите тренировку, время и тренеров."}
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Тренировка">
              <Select value={workoutId} onValueChange={setWorkoutId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите тренировку" />
                </SelectTrigger>
                <SelectContent>
                  {workouts.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Начало">
                <Input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </FormField>
              <FormField label="Окончание">
                <Input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Тренеры" optional htmlFor={null}>
              {trainers.length === 0 ? (
                <InfoNote variant="empty">
                  Добавьте тренеров в разделе «Сотрудники», чтобы прикрепить их к занятию.
                </InfoNote>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3">
                  {trainers.map((t) => (
                    <CheckboxOption
                      key={t.id}
                      checked={trainerIds.includes(t.id)}
                      onCheckedChange={() => toggleTrainer(t.id)}
                    >
                      {t.full_name}
                    </CheckboxOption>
                  ))}
                </div>
              )}
            </FormField>

            {entry && <BookingsPanel entry={entry} onChanged={onSaved} />}
          </div>
        </DialogBody>
        <DialogFooter>
          {entry && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleDelete}
              disabled={busy}
            >
              <Trash2 />
              Удалить
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

type BookingRow = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
};

type ClientRow = {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  crm_link: string | null;
};

type ActiveMembershipRow = {
  client_id: string;
  started_at: string | null;
  ends_at: string | null;
  visits_left: number | null;
  membership: { name: string | null } | null;
};

type BookingsData = {
  bookings: BookingRow[];
  clientsByUser: Map<string, ClientRow>;
  membershipsByClient: Map<string, ActiveMembershipRow>;
};

/** Записи на занятие + анкеты клиентов студии + их активные абонементы. */
async function fetchBookings(entry: Entry): Promise<BookingsData> {
  const bookings = await unwrap<BookingRow[]>(
    supabase
      .from("schedule_bookings")
      .select("id, user_id, status, created_at")
      .eq("entry_id", entry.id)
      .in("status", ["booked", "attended", "waitlist"])
      .order("created_at"),
  );
  const clientsByUser = new Map<string, ClientRow>();
  const membershipsByClient = new Map<string, ActiveMembershipRow>();
  const userIds = Array.from(new Set(bookings.map((r) => r.user_id))).filter(Boolean);
  if (userIds.length === 0) return { bookings, clientsByUser, membershipsByClient };

  // Анкеты и абонементы — дополнение: если они не загрузились, записи всё
  // равно показываем (с «Пользователь без анкеты»), а не ошибку на всю панель.
  const { data: cData } = await supabase
    .from("clients")
    .select("id, user_id, first_name, last_name, full_name, phone, email, crm_link")
    .eq("studio_id", entry.studio_id)
    .in("user_id", userIds);
  const clients: ClientRow[] = cData ?? [];
  for (const c of clients) if (c.user_id) clientsByUser.set(c.user_id, c);
  if (clients.length === 0) return { bookings, clientsByUser, membershipsByClient };

  const { data: mData } = await supabase
    .from("client_memberships")
    .select("client_id, started_at, ends_at, visits_left, membership:memberships(name)")
    .eq("status", "active")
    .in(
      "client_id",
      clients.map((c) => c.id),
    );
  // membership — связь «многие к одному», но разбор select без схемы базы
  // считает любую связь массивом.
  const memberships = (mData ?? []) as unknown as ActiveMembershipRow[];
  for (const m of memberships) membershipsByClient.set(m.client_id, m);
  return { bookings, clientsByUser, membershipsByClient };
}

/**
 * RPC записей отвечают { ok, reason }: ok=false — штатный отказ базы (запись
 * уже отменена и т. п.), а не ошибка запроса. Тост об ошибке показываем здесь;
 * true — успех.
 */
async function bookingRpc(
  fn: "mark_booking_attended" | "cancel_schedule_booking_admin",
  args: Record<string, string | null>,
  messages: { error: string; failed: string },
) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    toast.error(`${messages.error}: ${error.message}`);
    return false;
  }
  const result = data as { ok?: boolean; reason?: string } | null;
  if (!result?.ok) {
    toast.error(`${messages.failed}: ${result?.reason ?? "неизвестно"}`);
    return false;
  }
  return true;
}

function BookingClientName({ client }: { client: ClientRow | undefined }) {
  if (!client) return <span className="font-medium">Пользователь без анкеты</span>;
  return (
    <ClientNameLink clientId={client.id} crmLink={client.crm_link}>
      {clientName(client)}
    </ClientNameLink>
  );
}

function BookingsPanel({ entry, onChanged }: { entry: Entry; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [attendingId, setAttendingId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<BookingRow | null>(null);

  const queryKey = ["schedule_bookings", entry.id];
  const { data, isLoading: loading } = useQuery({
    queryKey,
    queryFn: () => fetchBookings(entry),
    meta: { errorMessage: "Ошибка загрузки записей" },
  });
  const bookings = data?.bookings ?? [];
  const reload = () => {
    queryClient.invalidateQueries({ queryKey });
    onChanged();
  };

  const askCancel = (b: BookingRow) => {
    setCancelTarget(b);
    setCancelOpen(true);
  };

  const handleAttend = async (b: BookingRow) => {
    setAttendingId(b.id);
    try {
      const ok = await bookingRpc(
        "mark_booking_attended",
        { p_booking_id: b.id },
        { error: "Ошибка", failed: "Не удалось отметить" },
      );
      if (!ok) return;
      toast.success("Посещение зафиксировано");
      reload();
    } finally {
      setAttendingId(null);
    }
  };

  // Лист ожидания держим отдельно от записанных: он не занимает мест и не
  // должен путаться со счётчиком заполненности.
  const booked = bookings.filter((b) => b.status !== "waitlist");
  const waitlisted = bookings.filter((b) => b.status === "waitlist");
  const capacity = entryCapacity(entry);

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">
            Записанные участники
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {booked.length}
            {capacity != null ? ` / ${capacity}` : ""}
            {waitlisted.length > 0 && ` · +${waitlisted.length} в очереди`}
          </span>
        </div>

        {loading ? (
          <div className="flex h-32 items-center justify-center rounded-md border">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : booked.length === 0 ? (
          <InfoNote variant="empty">Пока никто не записан.</InfoNote>
        ) : (
          <div className="space-y-2">
            {booked.map((b) => {
              const c = data?.clientsByUser.get(b.user_id);
              const m = c ? data?.membershipsByClient.get(c.id) : undefined;
              const contacts = [c?.phone, c?.email].filter(Boolean).join(" · ");
              return (
                <div key={b.id} className="space-y-1 rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col items-start gap-1">
                      <BookingClientName client={c} />
                      {b.status === "attended" && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Посещение зафиксировано
                        </span>
                      )}
                    </div>
                    {b.status === "booked" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleAttend(b)}
                          disabled={attendingId === b.id}
                        >
                          {attendingId === b.id && <Loader2 className="animate-spin" />}
                          Посетил
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => askCancel(b)}>
                          Отклонить
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    {contacts && <div>{contacts}</div>}
                    {m ? (
                      <div>
                        {m.membership?.name ?? "Абонемент"} ·{" "}
                        {m.visits_left != null ? `осталось ${m.visits_left}` : "безлимит"} ·{" "}
                        {formatDate(m.started_at)} – {m.ends_at ? formatDate(m.ends_at) : "∞"}
                      </div>
                    ) : (
                      <div className="italic">Нет активного абонемента</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {waitlisted.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase text-muted-foreground">Лист ожидания</div>
            <span
              className="text-xs text-muted-foreground"
              title="Записались, когда свободных мест уже не было"
            >
              {waitlisted.length} ждут места
            </span>
          </div>
          <div className="space-y-2">
            {waitlisted.map((b) => {
              const c = data?.clientsByUser.get(b.user_id);
              return (
                <div
                  key={b.id}
                  className="rounded-md border border-blue-200 bg-blue-50/60 p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <BookingClientName client={c} />
                      <span className="mt-0.5 text-xs text-muted-foreground">
                        {c?.phone ?? c?.email ?? "—"}
                      </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => askCancel(b)}>
                      Убрать
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        {/*
          Окно открыто из формы занятия, а React всплывает события сквозь
          портал по дереву компонентов: без stopPropagation отправка этой формы
          дошла бы до формы занятия и сохранила бы её.
        */}
        <DialogContent className="max-w-md" onSubmit={(e) => e.stopPropagation()}>
          {cancelTarget && (
            <CancelBookingForm
              key={cancelTarget.id}
              booking={cancelTarget}
              onClose={() => setCancelOpen(false)}
              onDone={reload}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CancelBookingForm({
  booking,
  onClose,
  onDone,
}: {
  booking: BookingRow;
  onClose: () => void;
  onDone: () => void;
}) {
  // Причина живёт в форме, а форма монтируется при каждом открытии окна:
  // «Отклонить» у другого клиента не наследует прошлую причину.
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Окно закрывается по успеху: на время запроса виден спиннер, при ошибке
  // можно повторить.
  const handleCancel = async () => {
    setCancelling(true);
    try {
      const ok = await bookingRpc(
        "cancel_schedule_booking_admin",
        { p_booking_id: booking.id, p_reason: reason || null },
        { error: "Ошибка отмены", failed: "Не удалось отписать" },
      );
      if (!ok) return;
      toast.success("Запись отклонена");
      onClose();
      onDone();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Отклонить запись?</DialogTitle>
        <DialogDescription>
          Бронирование будет отменено со статусом «Отклонена». Клиент сможет записаться снова, если
          останутся места.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleCancel}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Причина отмены" optional>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Не указана" />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_CANCEL_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cancelling}>
            Отмена
          </Button>
          <Button type="submit" variant="destructive" disabled={cancelling}>
            {cancelling && <Loader2 className="animate-spin" />}
            Отклонить запись
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
