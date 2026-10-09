import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useEffect, useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Loader2, Trash2, Copy, X } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ClientNameLink } from "@/components/client-name-link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { dayTypeColor } from "@/lib/workout-types";
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

function toLocalISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function SchedulePage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [presetStart, setPresetStart] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<string>(ALL_FILTER_VALUE);
  const [filterTrainerId, setFilterTrainerId] = useState<string>(ALL_FILTER_VALUE);
  const [copySource, setCopySource] = useState<Entry | null>(null);
  const [pasting, setPasting] = useState(false);
  const [duplicateWeekOpen, setDuplicateWeekOpen] = useState(false);
  const [duplicatingWeek, setDuplicatingWeek] = useState(false);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEnd = addDays(weekStart, 7);

  const fetchData = async () => {
    if (!studioId) {
      setEntries([]);
      setWorkouts([]);
      setTrainers([]);
      return;
    }
    setLoading(true);
    const [eRes, wRes, tRes] = await Promise.all([
      supabase
        .from("schedule_entries")
        .select(
          "*, workout:workouts(name, type, capacity), schedule_entry_trainers(trainer_id, trainer:trainers(id, full_name))",
        )
        .eq("studio_id", studioId)
        .gte("starts_at", weekStart.toISOString())
        .lt("starts_at", weekEnd.toISOString())
        .order("starts_at"),
      supabase
        .from("workouts")
        .select("id, name, type, capacity")
        .eq("studio_id", studioId)
        .order("name"),
      supabase
        .from("trainers")
        .select("id, full_name")
        .eq("studio_id", studioId)
        .order("full_name"),
    ]);
    setLoading(false);
    if (eRes.error) {
      toast.error("Ошибка загрузки расписания: " + eRes.error.message);
      return;
    }
    if (wRes.error) {
      toast.error("Ошибка загрузки тренировок: " + wRes.error.message);
      return;
    }
    if (tRes.error) {
      toast.error("Ошибка загрузки тренеров: " + tRes.error.message);
      return;
    }
    setEntries((eRes.data as Entry[]) ?? []);
    setWorkouts((wRes.data as Workout[]) ?? []);
    setTrainers((tRes.data as Trainer[]) ?? []);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, weekStart, refreshSignal]);

  const openSlot = (day: Date, hour: number) => {
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    if (copySource) {
      pasteCopy(d);
      return;
    }
    setEditing(null);
    setPresetStart(d);
    setDialogOpen(true);
  };

  const pasteCopy = async (newStart: Date) => {
    if (!copySource || !studioId || pasting) return;
    const origStart = new Date(copySource.starts_at);
    const origEnd = new Date(copySource.ends_at);
    const durationMs = origEnd.getTime() - origStart.getTime();
    const newEnd = new Date(newStart.getTime() + durationMs);
    setPasting(true);
    const { data, error } = await supabase
      .from("schedule_entries")
      .insert({
        studio_id: studioId,
        workout_id: copySource.workout_id,
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) {
      setPasting(false);
      toast.error("Ошибка копирования: " + (error?.message ?? ""));
      return;
    }
    const trainerIds = copySource.schedule_entry_trainers?.map((x) => x.trainer_id) ?? [];
    if (trainerIds.length > 0) {
      const { error: tErr } = await supabase
        .from("schedule_entry_trainers")
        .insert(trainerIds.map((tid) => ({ entry_id: data.id, trainer_id: tid })));
      if (tErr) {
        setPasting(false);
        toast.error("Занятие создано, но тренеры не привязаны: " + tErr.message);
        setCopySource(null);
        fetchData();
        return;
      }
    }
    setPasting(false);
    setCopySource(null);
    toast.success("Занятие скопировано");
    fetchData();
  };

  const duplicateWeek = async () => {
    if (!studioId || duplicatingWeek) return;
    if (entries.length === 0) {
      toast.error("На текущей неделе нет занятий для копирования");
      setDuplicateWeekOpen(false);
      return;
    }
    setDuplicatingWeek(true);
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const nextWeekStart = addDays(weekStart, 7);
    const nextWeekEnd = addDays(nextWeekStart, 7);
    // Check existing entries on the target week to avoid duplicates
    const { data: existing, error: exErr } = await supabase
      .from("schedule_entries")
      .select("workout_id, starts_at")
      .eq("studio_id", studioId)
      .gte("starts_at", nextWeekStart.toISOString())
      .lt("starts_at", nextWeekEnd.toISOString());
    if (exErr) {
      setDuplicatingWeek(false);
      toast.error("Ошибка проверки следующей недели: " + exErr.message);
      return;
    }
    const existingKeys = new Set(
      (existing ?? []).map((e) => `${e.workout_id}|${new Date(e.starts_at).toISOString()}`),
    );

    const rows = entries
      .map((e) => {
        const newStartMs = new Date(e.starts_at).getTime() + WEEK_MS;
        const newEndMs = new Date(e.ends_at).getTime() + WEEK_MS;
        const newStartIso = new Date(newStartMs).toISOString();
        const key = `${e.workout_id}|${newStartIso}`;
        if (existingKeys.has(key)) return null;
        return {
          studio_id: studioId,
          workout_id: e.workout_id,
          starts_at: newStartIso,
          ends_at: new Date(newEndMs).toISOString(),
          _trainer_ids: e.schedule_entry_trainers?.map((x) => x.trainer_id) ?? [],
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (rows.length === 0) {
      setDuplicatingWeek(false);
      setDuplicateWeekOpen(false);
      toast.info("Все занятия уже скопированы на следующую неделю");
      return;
    }

    const insertRows = rows.map(({ _trainer_ids, ...rest }) => rest);
    const { data: inserted, error: insErr } = await supabase
      .from("schedule_entries")
      .insert(insertRows)
      .select("id, workout_id, starts_at");
    if (insErr || !inserted) {
      setDuplicatingWeek(false);
      toast.error("Ошибка копирования недели: " + (insErr?.message ?? ""));
      return;
    }

    // Map inserted rows back to trainer ids
    const trainerLinks: { entry_id: string; trainer_id: string }[] = [];
    for (const ins of inserted) {
      const key = `${ins.workout_id}|${new Date(ins.starts_at).toISOString()}`;
      const src = rows.find((r) => `${r.workout_id}|${r.starts_at}` === key);
      if (!src) continue;
      for (const tid of src._trainer_ids) {
        trainerLinks.push({ entry_id: ins.id, trainer_id: tid });
      }
    }
    if (trainerLinks.length > 0) {
      const { error: tErr } = await supabase.from("schedule_entry_trainers").insert(trainerLinks);
      if (tErr) {
        setDuplicatingWeek(false);
        setDuplicateWeekOpen(false);
        toast.error("Занятия скопированы, но тренеры не привязаны: " + tErr.message);
        setWeekStart(nextWeekStart);
        return;
      }
    }
    setDuplicatingWeek(false);
    setDuplicateWeekOpen(false);
    toast.success(`Скопировано занятий: ${inserted.length}`);
    setWeekStart(nextWeekStart);
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

  const handleDelete = async (e: Entry) => {
    if (
      !(await confirm({
        title: "Удалить занятие?",
        description: "Занятие пропадёт из расписания, записи на него будут отменены.",
      }))
    )
      return;
    const { error } = await supabase.from("schedule_entries").delete().eq("id", e.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Занятие удалено");
    fetchData();
  };

  const weekLabel = `${fmtDate(weekStart)} — ${fmtDate(addDays(weekStart, 6))}`;
  const isCurrentWeek = startOfWeek(new Date()).toDateString() === weekStart.toDateString();

  return (
    <AdminShell
      title="Расписание"
      description="Недельное расписание занятий"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="default"
            onClick={() => setDuplicateWeekOpen(true)}
            disabled={!studioId || entries.length === 0 || loading}
          >
            <Copy className="mr-1 h-4 w-4" />
            Дублировать неделю
          </Button>
          <Button size="default" onClick={openAdd} disabled={!studioId || workouts.length === 0}>
            <Plus className="mr-1 h-4 w-4" />
            Добавить занятие
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background px-3 py-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setWeekStart(addDays(weekStart, -7))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWeekStart(startOfWeek(new Date()))}
                  disabled={isCurrentWeek}
                >
                  Текущая неделя
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setWeekStart(addDays(weekStart, 7))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="ml-1 text-sm font-medium">{weekLabel}</span>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Тип:</span>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Все типы" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTER_VALUE}>Все типы</SelectItem>
                      <SelectItem value="strength">Силовая</SelectItem>
                      <SelectItem value="cardio">Кардио</SelectItem>
                      <SelectItem value="hybrid">Гибрид</SelectItem>
                      <SelectItem value="recovery">Восстановление</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Тренер:</span>
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
                </div>
                {(filterType !== ALL_FILTER_VALUE || filterTrainerId !== ALL_FILTER_VALUE) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFilterType(ALL_FILTER_VALUE);
                      setFilterTrainerId(ALL_FILTER_VALUE);
                    }}
                  >
                    Сбросить
                  </Button>
                )}
              </div>
            </div>

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
                  className="h-7"
                  onClick={() => setCopySource(null)}
                  disabled={pasting}
                >
                  <X className="mr-1 h-3 w-3" /> Отмена
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
                        today
                          ? "border-b-4 border-b-yellow-400 font-semibold text-primary"
                          : "border-b"
                      }`}
                    >
                      <div className="uppercase tracking-wide text-muted-foreground">
                        {DAY_NAMES[i]}
                      </div>
                      <div>
                        {d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                      </div>
                    </div>
                  );
                })}

                {HOURS.map((hour) => {
                  const hasAnyForHour = weekDays.some((day) =>
                    entries.some((e) => {
                      const s = new Date(e.starts_at);
                      const matchesDayHour =
                        s.toDateString() === day.toDateString() && s.getHours() === hour;
                      if (!matchesDayHour) return false;
                      if (filterType !== ALL_FILTER_VALUE && e.workout?.type !== filterType)
                        return false;
                      if (filterTrainerId !== ALL_FILTER_VALUE) {
                        const hasTrainer = e.schedule_entry_trainers?.some(
                          (x) => x.trainer_id === filterTrainerId,
                        );
                        if (!hasTrainer) return false;
                      }
                      return true;
                    }),
                  );
                  const rowHeight = hasAnyForHour ? SLOT_PX_FULL : SLOT_PX_EMPTY;
                  return (
                    <div key={`row-${hour}`} className="contents">
                      <div
                        className="border-b border-r px-2 text-right text-xs text-muted-foreground"
                        style={{ height: rowHeight, lineHeight: "1rem", paddingTop: 4 }}
                      >
                        {pad(hour)}:00
                      </div>
                      {weekDays.map((day, di) => {
                        const slotEntries = entries.filter((e) => {
                          const s = new Date(e.starts_at);
                          const matchesDayHour =
                            s.toDateString() === day.toDateString() && s.getHours() === hour;
                          if (!matchesDayHour) return false;
                          if (filterType !== ALL_FILTER_VALUE && e.workout?.type !== filterType)
                            return false;
                          if (filterTrainerId !== ALL_FILTER_VALUE) {
                            const hasTrainer = e.schedule_entry_trainers?.some(
                              (x) => x.trainer_id === filterTrainerId,
                            );
                            if (!hasTrainer) return false;
                          }
                          return true;
                        });
                        return (
                          <button
                            key={`${hour}-${di}`}
                            type="button"
                            onClick={() => openSlot(day, hour)}
                            className="relative border-b border-r text-left transition hover:bg-accent/40"
                            style={{ height: rowHeight }}
                          >
                            {slotEntries.map((e) => {
                              const names =
                                e.schedule_entry_trainers
                                  ?.map((x) => x.trainer?.full_name)
                                  .filter(Boolean)
                                  .join(", ") ?? "";
                              const color = dayTypeColor(e.workout?.type);
                              const colorClasses = color
                                ? `${color.bg} ${color.text}`
                                : "bg-primary text-primary-foreground";
                              return (
                                <div
                                  key={e.id}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    openEdit(e);
                                  }}
                                  className={`absolute inset-1 cursor-pointer overflow-hidden rounded-md px-2 py-1 text-[11px] leading-tight hover:opacity-90 flex flex-col ${colorClasses}`}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <span className="whitespace-nowrap opacity-80">
                                      {fmtTime(e.starts_at)}–{fmtTime(e.ends_at)}
                                    </span>
                                    {(() => {
                                      const cap = e.capacity ?? e.workout?.capacity ?? 0;
                                      if (!cap) return null;
                                      const left = Math.max(0, cap - e.booked_count);
                                      const waiting = e.waitlist_count ?? 0;
                                      const tone =
                                        left === 0
                                          ? "bg-red-500/90 text-white"
                                          : left <= 5
                                            ? "bg-amber-500/90 text-white"
                                            : "bg-black/25 text-white";
                                      return (
                                        <div className="flex shrink-0 items-center gap-1">
                                          <span
                                            className={`rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums ${tone}`}
                                          >
                                            {e.booked_count}/{cap}
                                          </span>
                                          {waiting > 0 && (
                                            <span
                                              title="Люди в листе ожидания — записались, когда мест уже не было"
                                              className="rounded bg-blue-500/90 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-white"
                                            >
                                              +{waiting}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  <div className="font-medium line-clamp-2">
                                    {e.workout?.name ?? "Занятие"}
                                  </div>
                                  {names && <div className="truncate opacity-80">{names}</div>}
                                  <div className="mt-auto flex justify-end">
                                    <button
                                      type="button"
                                      aria-label="Копировать занятие"
                                      title="Копировать занятие"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        setCopySource(e);
                                        toast.message(
                                          "Выберите пустой слот, куда скопировать занятие",
                                        );
                                      }}
                                      className="rounded bg-black/25 p-0.5 text-white hover:bg-black/40"
                                    >
                                      <Copy className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {workouts.length === 0 && (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                Чтобы добавить занятие, сначала создайте тренировки в разделе «Тренировки».
              </div>
            )}
          </>
        )}
      </div>

      <EntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        studioId={studioId}
        workouts={workouts}
        trainers={trainers}
        entry={editing}
        presetStart={presetStart}
        onSaved={fetchData}
        onDelete={editing ? () => handleDelete(editing) : undefined}
      />

      <AlertDialog
        open={duplicateWeekOpen}
        onOpenChange={(v) => !duplicatingWeek && setDuplicateWeekOpen(v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Дублировать неделю?</AlertDialogTitle>
            <AlertDialogDescription>
              Все занятия с недели {weekLabel} ({entries.length}) будут скопированы на следующую
              неделю ({fmtDate(addDays(weekStart, 7))} — {fmtDate(addDays(weekStart, 13))}) в те же
              дни и время, с теми же тренерами. Записи клиентов не копируются. Уже существующие на
              следующей неделе занятия (тот же тип и время) пропускаются.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={duplicatingWeek}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={duplicateWeek} disabled={duplicatingWeek}>
              {duplicatingWeek && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Дублировать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {confirmDialog}
    </AdminShell>
  );
}

function EntryDialog({
  open,
  onOpenChange,
  studioId,
  workouts,
  trainers,
  entry,
  presetStart,
  onSaved,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  workouts: Workout[];
  trainers: Trainer[];
  entry: Entry | null;
  presetStart: Date | null;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [workoutId, setWorkoutId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [trainerIds, setTrainerIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setWorkoutId(entry.workout_id);
      setStartsAt(toLocalISO(new Date(entry.starts_at)).slice(0, 16));
      setEndsAt(toLocalISO(new Date(entry.ends_at)).slice(0, 16));
      setTrainerIds(entry.schedule_entry_trainers?.map((x) => x.trainer_id) ?? []);
    } else {
      setWorkoutId(workouts[0]?.id ?? "");
      const start =
        presetStart ??
        (() => {
          const d = new Date();
          d.setMinutes(0, 0, 0);
          d.setHours(d.getHours() + 1);
          return d;
        })();
      const end = new Date(start);
      end.setHours(end.getHours() + 1);
      setStartsAt(toLocalISO(start).slice(0, 16));
      setEndsAt(toLocalISO(end).slice(0, 16));
      setTrainerIds([]);
    }
  }, [open, entry, presetStart, workouts]);

  const toggleTrainer = (id: string) => {
    setTrainerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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
    setSaving(true);
    const payload = {
      studio_id: studioId,
      workout_id: workoutId,
      starts_at: startDate.toISOString(),
      ends_at: endDate.toISOString(),
    };
    let entryId = entry?.id;
    if (entry) {
      const { error } = await supabase.from("schedule_entries").update(payload).eq("id", entry.id);
      if (error) {
        setSaving(false);
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("schedule_entries")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast.error("Ошибка сохранения: " + (error?.message ?? ""));
        return;
      }
      entryId = data.id;
    }

    // Sync trainers
    if (entryId) {
      const { error: delErr } = await supabase
        .from("schedule_entry_trainers")
        .delete()
        .eq("entry_id", entryId);
      if (delErr) {
        setSaving(false);
        toast.error("Ошибка обновления тренеров: " + delErr.message);
        return;
      }
      if (trainerIds.length > 0) {
        const { error: insErr } = await supabase
          .from("schedule_entry_trainers")
          .insert(trainerIds.map((tid) => ({ entry_id: entryId!, trainer_id: tid })));
        if (insErr) {
          setSaving(false);
          toast.error("Ошибка добавления тренеров: " + insErr.message);
          return;
        }
      }
    }

    setSaving(false);
    toast.success(entry ? "Занятие обновлено" : "Занятие добавлено");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={entry ? "max-w-4xl" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle>{entry ? "Редактировать занятие" : "Новое занятие"}</DialogTitle>
          <DialogDescription>
            {entry
              ? "Слева — настройки занятия, справа — записанные участники."
              : "Выберите тренировку, время и тренеров."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className={entry ? "grid gap-6 md:grid-cols-2" : ""}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Тренировка</Label>
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Начало</Label>
                  <Input
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Окончание</Label>
                  <Input
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Тренеры</Label>
                {trainers.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    Добавьте тренеров в разделе «Тренеры», чтобы прикрепить их к занятию.
                  </div>
                ) : (
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
                    {trainers.map((t) => {
                      const checked = trainerIds.includes(t.id);
                      return (
                        <label
                          key={t.id}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggleTrainer(t.id)} />
                          <span>{t.full_name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {entry && <BookingsPanel entry={entry} open={open} onChanged={onSaved} />}
          </div>
        </DialogBody>
        <DialogFooter className="flex sm:justify-between">
          <div>
            {entry && onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onDelete();
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Удалить
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
};

type ActiveMembershipRow = {
  client_id: string;
  started_at: string | null;
  ends_at: string | null;
  visits_left: number | null;
  membership: { name: string | null } | null;
};

function BookingsPanel({
  entry,
  open,
  onChanged,
}: {
  entry: Entry;
  open: boolean;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [clients, setClients] = useState<Record<string, ClientRow>>({});
  const [memberships, setMemberships] = useState<Record<string, ActiveMembershipRow>>({});
  const [confirmBooking, setConfirmBooking] = useState<BookingRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [attendingId, setAttendingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: bData, error: bErr } = await supabase
      .from("schedule_bookings")
      .select("id, user_id, status, created_at")
      .eq("entry_id", entry.id)
      .in("status", ["booked", "attended", "waitlist"])
      .order("created_at");
    if (bErr) {
      setLoading(false);
      toast.error("Ошибка загрузки записей: " + bErr.message);
      return;
    }
    const rows = (bData as BookingRow[]) ?? [];
    setBookings(rows);
    const userIds = Array.from(new Set(rows.map((r) => r.user_id))).filter(Boolean);
    if (userIds.length === 0) {
      setClients({});
      setMemberships({});
      setLoading(false);
      return;
    }
    const { data: cData } = await supabase
      .from("clients")
      .select("id, user_id, first_name, last_name, full_name, phone, email")
      .eq("studio_id", entry.studio_id)
      .in("user_id", userIds);
    const cMap: Record<string, ClientRow> = {};
    const clientIds: string[] = [];
    ((cData as ClientRow[]) ?? []).forEach((c) => {
      if (c.user_id) cMap[c.user_id] = c;
      clientIds.push(c.id);
    });
    setClients(cMap);
    if (clientIds.length > 0) {
      const { data: mData } = await supabase
        .from("client_memberships")
        .select("client_id, started_at, ends_at, visits_left, membership:memberships(name)")
        .eq("status", "active")
        .in("client_id", clientIds);
      const mMap: Record<string, ActiveMembershipRow> = {};
      ((mData as unknown as ActiveMembershipRow[]) ?? []).forEach((m) => {
        mMap[m.client_id] = m;
      });
      setMemberships(mMap);
    } else {
      setMemberships({});
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry.id]);

  const handleCancel = async () => {
    if (!confirmBooking) return;
    setCancelling(true);
    const { data, error } = await supabase.rpc("cancel_schedule_booking_admin", {
      p_booking_id: confirmBooking.id,
      p_reason: cancelReason || null,
    });
    setCancelling(false);
    if (error) {
      toast.error("Ошибка отмены: " + error.message);
      return;
    }
    const result = data as { ok?: boolean; reason?: string } | null;
    if (!result?.ok) {
      toast.error("Не удалось отписать: " + (result?.reason ?? "неизвестно"));
      return;
    }
    toast.success("Запись отклонена");
    setConfirmBooking(null);
    setCancelReason("");
    await load();
    onChanged();
  };

  const handleAttend = async (b: BookingRow) => {
    setAttendingId(b.id);
    const { data, error } = await supabase.rpc("mark_booking_attended", {
      p_booking_id: b.id,
    });
    setAttendingId(null);
    if (error) {
      toast.error("Ошибка: " + error.message);
      return;
    }
    const result = data as { ok?: boolean; reason?: string } | null;
    if (!result?.ok) {
      toast.error("Не удалось отметить: " + (result?.reason ?? "неизвестно"));
      return;
    }
    toast.success("Посещение зафиксировано");
    await load();
    onChanged();
  };

  // Лист ожидания держим отдельно от записанных: он не занимает мест и не
  // должен путаться со счётчиком заполненности.
  const booked = bookings.filter((b) => b.status !== "waitlist");
  const waitlisted = bookings.filter((b) => b.status === "waitlist");

  const fmtMembershipDates = (m: ActiveMembershipRow) => {
    const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("ru-RU") : "—");
    return `${fmt(m.started_at)} – ${m.ends_at ? fmt(m.ends_at) : "∞"}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Записанные участники</Label>
        <span className="text-xs text-muted-foreground">
          {booked.length}
          {entry.capacity != null ? ` / ${entry.capacity}` : ""}
          {waitlisted.length > 0 && (
            <span className="ml-2 text-blue-600">+{waitlisted.length} в очереди</span>
          )}
        </span>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center rounded-md border">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : booked.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          Пока никто не записан.
        </div>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {booked.map((b) => {
            const c = clients[b.user_id];
            const m = c ? memberships[c.id] : undefined;
            const name = c
              ? [c.last_name, c.first_name].filter(Boolean).join(" ") || c.full_name
              : "Пользователь без анкеты";
            return (
              <div key={b.id} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    {c ? (
                      <ClientNameLink clientId={c.id}>{name}</ClientNameLink>
                    ) : (
                      <span className="font-medium">{name}</span>
                    )}
                    {b.status === "attended" && (
                      <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
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
                        {attendingId === b.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Посетил
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setConfirmBooking(b)}>
                        Отклонить
                      </Button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {c?.phone && <div>📞 {c.phone}</div>}
                  {c?.email && <div>✉ {c.email}</div>}
                  {m ? (
                    <div>
                      🎟 {m.membership?.name ?? "Абонемент"} ·{" "}
                      {m.visits_left != null ? `осталось ${m.visits_left}` : "безлимит"} ·{" "}
                      {fmtMembershipDates(m)}
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

      {waitlisted.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-blue-700">Лист ожидания</Label>
            <span
              className="text-xs text-muted-foreground"
              title="Записались, когда свободных мест уже не было"
            >
              {waitlisted.length} ждут места
            </span>
          </div>
          <div className="space-y-2">
            {waitlisted.map((b) => {
              const c = clients[b.user_id];
              const name = c
                ? [c.last_name, c.first_name].filter(Boolean).join(" ") || c.full_name
                : "Пользователь без анкеты";
              return (
                <div
                  key={b.id}
                  className="rounded-md border border-blue-200 bg-blue-50/60 p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      {c ? (
                        <ClientNameLink clientId={c.id}>{name}</ClientNameLink>
                      ) : (
                        <span className="font-medium">{name}</span>
                      )}
                      <span className="mt-0.5 text-xs text-muted-foreground">
                        {c?.phone ?? c?.email ?? "—"}
                      </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setConfirmBooking(b)}>
                      Убрать
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AlertDialog open={!!confirmBooking} onOpenChange={(v) => !v && setConfirmBooking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отклонить?</AlertDialogTitle>
            <AlertDialogDescription>
              Бронирование будет отменено со статусом «Отклонена». Пользователь сможет записаться
              снова, если останутся места.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label>Причина отмены</Label>
            <Select value={cancelReason} onValueChange={setCancelReason}>
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
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} disabled={cancelling}>
              {cancelling && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Отклонить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
