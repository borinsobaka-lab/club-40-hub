import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({ meta: [{ title: "Расписание — CLUB 40 Admin" }] }),
  component: SchedulePage,
});

type Workout = { id: string; name: string; type?: string | null };
type Trainer = { id: string; full_name: string };
type Entry = {
  id: string;
  studio_id: string;
  workout_id: string;
  starts_at: string;
  ends_at: string;
  workout?: { name: string; type?: string } | null;
  schedule_entry_trainers?: { trainer_id: string; trainer: Trainer | null }[];
};

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7..22
const SLOT_PX = 64;
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
          "*, workout:workouts(name, type), schedule_entry_trainers(trainer_id, trainer:trainers(id, full_name))",
        )
        .eq("studio_id", studioId)
        .gte("starts_at", weekStart.toISOString())
        .lt("starts_at", weekEnd.toISOString())
        .order("starts_at"),
      supabase.from("workouts").select("id, name, type").eq("studio_id", studioId).order("name"),
      supabase.from("trainers").select("id, full_name").eq("studio_id", studioId).order("full_name"),
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

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, weekStart]);

  const openSlot = (day: Date, hour: number) => {
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    setEditing(null);
    setPresetStart(d);
    setDialogOpen(true);
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
    if (!confirm("Удалить занятие из расписания?")) return;
    const { error } = await supabase.from("schedule_entries").delete().eq("id", e.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Занятие удалено");
    fetchData();
  };

  const weekLabel = `${fmtDate(weekStart)} — ${fmtDate(addDays(weekStart, 6))}`;
  const isCurrentWeek =
    startOfWeek(new Date()).toDateString() === weekStart.toDateString();

  return (
    <AdminShell
      title="Расписание"
      description="Недельное расписание занятий"
      actions={
        <Button size="sm" onClick={openAdd} disabled={!studioId || workouts.length === 0}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить занятие
        </Button>
      }
    >
      <div className="mx-auto max-w-7xl space-y-4">
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
                {loading && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Тип:</span>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="h-8 w-40 text-xs">
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
                    <SelectTrigger className="h-8 w-48 text-xs">
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
                    className="h-8 text-xs"
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

            <div className="overflow-x-auto rounded-lg border bg-background">
              <div className="grid min-w-[900px]" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
                <div className="border-b border-r bg-muted/30" />
                {weekDays.map((d, i) => {
                  const today = d.toDateString() === new Date().toDateString();
                  return (
                    <div
                      key={i}
                      className={`border-b border-r p-2 text-center text-xs ${
                        today ? "bg-primary/10 font-semibold" : "bg-muted/30"
                      }`}
                    >
                      <div className="uppercase tracking-wide text-muted-foreground">
                        {DAY_NAMES[i]}
                      </div>
                      <div>{d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</div>
                    </div>
                  );
                })}

                {HOURS.map((hour) => (
                  <div key={`row-${hour}`} className="contents">
                    <div
                      className="border-b border-r px-2 text-right text-xs text-muted-foreground"
                      style={{ height: SLOT_PX, lineHeight: "1rem", paddingTop: 4 }}
                    >
                      {pad(hour)}:00
                    </div>
                    {weekDays.map((day, di) => {
                      const slotEntries = entries.filter((e) => {
                        const s = new Date(e.starts_at);
                        const matchesDayHour =
                          s.toDateString() === day.toDateString() &&
                          s.getHours() === hour;
                        if (!matchesDayHour) return false;
                        if (filterType !== ALL_FILTER_VALUE && e.workout?.type !== filterType) return false;
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
                          style={{ height: SLOT_PX }}
                        >
                          {slotEntries.map((e) => {
                            const names =
                              e.schedule_entry_trainers
                                ?.map((x) => x.trainer?.full_name)
                                .filter(Boolean)
                                .join(", ") ?? "";
                            return (
                              <div
                                key={e.id}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  openEdit(e);
                                }}
                                className="absolute inset-x-1 top-1 cursor-pointer overflow-hidden rounded-md bg-primary px-2 py-1 text-[11px] leading-tight text-primary-foreground shadow-sm hover:opacity-90"
                              >
                                <div className="opacity-80">
                                  {fmtTime(e.starts_at)}–{fmtTime(e.ends_at)}
                                </div>
                                <div className="truncate font-medium">
                                  {e.workout?.name ?? "Занятие"}
                                </div>
                                {names && (
                                  <div className="truncate opacity-80">{names}</div>
                                )}
                              </div>
                            );
                          })}
                        </button>
                      );
                    })}
                  </div>
                ))}
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
      setTrainerIds(
        entry.schedule_entry_trainers?.map((x) => x.trainer_id) ?? [],
      );
    } else {
      setWorkoutId(workouts[0]?.id ?? "");
      const start = presetStart ?? (() => {
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
    setTrainerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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
      const { error } = await supabase
        .from("schedule_entries")
        .update(payload)
        .eq("id", entry.id);
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "Редактировать занятие" : "Новое занятие"}</DialogTitle>
          <DialogDescription>Выберите тренировку, время и тренеров.</DialogDescription>
        </DialogHeader>

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
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleTrainer(t.id)}
                      />
                      <span>{t.full_name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

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
