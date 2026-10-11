import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  Trash2,
  Copy,
  UserPlus,
  X,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useActiveStudio } from "@/hooks/use-studios";
import { EmployeePhoto } from "@/components/employee-photo";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { clientName, formatDate, toDateTimeLocalValue } from "@/lib/format";
import { DAY_TYPES, dayTypeColor } from "@/lib/workout-types";
import {
  ACTIVITY_KINDS,
  ACTIVITY_KIND_VALUES,
  activityKind,
  type ActivityKind,
} from "@/lib/schedule-activities";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckboxOption, FormField, InfoNote } from "@/components/ui/form-field";
import { TableToolbar, ToolbarReset } from "@/components/table-toolbar";
import { ClientNameLink } from "@/components/client-name-link";
import { ClientCombobox, type ClientOption } from "@/components/client-combobox";
import { ClientDialog } from "@/components/client-form-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { EntryCardSkeleton, SchedulePageSkeleton } from "@/components/page-skeletons";
import { SCHEDULE_SKELETON_HOURS, isScheduleSkeletonCell } from "@/lib/page-skeleton-layout";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({ meta: [{ title: "Расписание — Base40 Admin" }] }),
  pendingComponent: SchedulePageSkeleton,
  component: SchedulePage,
});

type Workout = { id: string; name: string; type?: string | null; capacity?: number | null };
type Trainer = {
  id: string;
  full_name: string;
  photo_url?: string | null;
  /** trainer | admin — справочник «Сотрудники». */
  role?: string;
};
type Entry = {
  id: string;
  studio_id: string;
  /** Групповое — по тренировке; персональное и прочее — без неё. */
  kind: ActivityKind;
  workout_id: string | null;
  /** Название прочей активности. */
  title: string | null;
  /** Ставка за прочую активность, лари каждому отмеченному сотруднику. */
  pay_rate: number | null;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  booked_count: number;
  waitlist_count?: number | null;
  workout?: {
    name: string;
    type?: string;
    capacity?: number | null;
    /** Пакетный формат: цвет полоски на карточке. */
    color?: string | null;
  } | null;
  schedule_entry_trainers?: { trainer_id: string; trainer: Trainer | null }[];
  /** Записи с карточками клиентов — для подписи персонального на карточке. */
  participants?: { status: string; client: ParticipantName | null }[];
};

type ParticipantName = { first_name: string | null; last_name: string | null; full_name: string };

/** Клиенты персонального занятия: «Фамилия Имя» записанных (не отменённых). */
function participantNames(e: Entry) {
  return (e.participants ?? [])
    .filter((p) => p.client && (p.status === "booked" || p.status === "attended"))
    .map((p) => clientName(p.client!))
    .join(", ");
}

/** Занятие к созданию: строка schedule_entries и тренеры, которых к ней привязать. */
type EntryDraft = {
  kind: ActivityKind;
  workout_id: string | null;
  title: string | null;
  pay_rate: number | null;
  starts_at: string;
  ends_at: string;
  trainerIds: string[];
};

const ENTRY_SELECT =
  "*, workout:workouts(name, type, capacity, color), schedule_entry_trainers(trainer_id, trainer:trainers(id, full_name, photo_url)), participants:schedule_bookings(status, client:clients(first_name, last_name, full_name))";
// Колонки справочников входят в ключ запроса: разделы «Тренировки» и «Сотрудники»
// грузят те же таблицы целиком, и общий ключ подсовывал бы им наш урезанный кэш.
const WORKOUT_COLS = "id, name, type, capacity";
// Сотрудники общие для студий: в расписание ставим тех, кто привязан к этой
// студии (trainer_studios). Занятия ведут тренеры; на прочую активность
// (например, фотосъёмку) можно отметить и администраторов.
const STAFF_COLS = "id, full_name, role, trainer_studios!inner(studio_id)";

/** Полоска на карточках персональных занятий и прочих активностей. */
const NON_GROUP_STRIPE = "#262626";

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
function todayIndex() {
  return (new Date().getDay() + 6) % 7;
}

function cellKey(day: Date, hour: number) {
  return `${day.toDateString()}|${hour}`;
}

/**
 * «Что + начало» — так узнаём одно и то же занятие на соседней неделе:
 * групповое — по тренировке, персональное — по тренеру, прочее — по названию.
 */
function entryKey(
  e: Pick<EntryDraft, "kind" | "workout_id" | "title" | "starts_at" | "trainerIds">,
) {
  const subject =
    e.kind === "group"
      ? e.workout_id
      : e.kind === "personal"
        ? [...e.trainerIds].sort().join(",")
        : e.title?.trim().toLowerCase();
  return `${e.kind}|${subject}|${new Date(e.starts_at).toISOString()}`;
}

function trainerIdsOf(e: Pick<Entry, "schedule_entry_trainers">) {
  return e.schedule_entry_trainers?.map((x) => x.trainer_id) ?? [];
}

/** Подпись занятия на карточке и в баннере копирования. */
function entryTitle(e: Entry) {
  if (e.kind === "personal") return "Персональное занятие";
  if (e.kind === "other") return e.title ?? "Прочая активность";
  return e.workout?.name ?? "Занятие";
}

/**
 * Вместимость занятия: своя или по умолчанию из тренировки; 0 и пусто — без
 * лимита. Одна на сетку и панель записей: панель раньше брала только свою и
 * при вместимости из тренировки показывала «3» вместо «3 / 12».
 */
function entryCapacity(e: Entry) {
  return (e.capacity ?? e.workout?.capacity) || null;
}

/** Копия занятия с новым началом: тот же тип, тренировка, длительность и тренеры. */
function copyDraft(e: Entry, start: Date): EntryDraft {
  const duration = new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime();
  return {
    kind: e.kind,
    workout_id: e.workout_id,
    title: e.title,
    pay_rate: e.pay_rate,
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
  | { ok: true; count: number; ids: string[]; trainersError: string | null };

/**
 * Создаёт занятия вместе с привязками тренеров — общий путь для «Нового
 * занятия», вставки скопированного и «Дублировать неделю». Ошибку привязки
 * тренеров отдаём отдельно: занятия к этому моменту уже созданы, и повторная
 * вставка дала бы дубли.
 */
async function insertEntries(studioId: string, drafts: EntryDraft[]): Promise<InsertResult> {
  // id задаём сами: тренеров привязываем по нему, а не по порядку строк в
  // ответе на вставку (его база не гарантирует) и не по «тренировка + начало»
  // (у персональных и прочих тренировки нет).
  const rows = drafts.map((d) => ({
    id: crypto.randomUUID(),
    studio_id: studioId,
    kind: d.kind,
    workout_id: d.workout_id,
    title: d.title,
    pay_rate: d.pay_rate,
    starts_at: d.starts_at,
    ends_at: d.ends_at,
  }));
  const { error } = await supabase.from("schedule_entries").insert(rows);
  if (error) return { ok: false, error: error.message };
  const links = rows.flatMap((row, i) =>
    drafts[i].trainerIds.map((trainer_id) => ({ entry_id: row.id, trainer_id })),
  );
  return {
    ok: true,
    count: rows.length,
    ids: rows.map((r) => r.id),
    trainersError: await linkTrainers(links),
  };
}

function SchedulePage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  // Пакетные студии: у тренировок нет типа — фильтра по типу нет, карточка
  // занятия светлая с полоской цвета тренировки и фото тренеров (2026-10-11).
  const packages = useActiveStudio()?.format === "packages";
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [presetStart, setPresetStart] = useState<Date | null>(null);
  // Новое занятие: сначала окно выбора типа, потом форма выбранного типа.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formKind, setFormKind] = useState<ActivityKind>("group");
  // Фильтр типов занятий не запоминается: при входе в раздел видны все типы.
  const [kindFilter, setKindFilter] = useState<ActivityKind[]>(ACTIVITY_KIND_VALUES);
  const [filterType, setFilterType] = useState<string>(ALL_FILTER_VALUE);
  const [filterTrainerId, setFilterTrainerId] = useState<string>(ALL_FILTER_VALUE);
  const [filterWorkoutId, setFilterWorkoutId] = useState<string>(ALL_FILTER_VALUE);
  const [copySource, setCopySource] = useState<Entry | null>(null);
  const [pasting, setPasting] = useState(false);
  const [duplicatingWeek, setDuplicatingWeek] = useState(false);
  // На телефоне сетка показывает один день недели (семь колонок по 1200px
  // не помещались): выбранный день — индекс 0..6 от понедельника.
  const isMobile = useIsMobile();
  const [dayIndex, setDayIndex] = useState(() => todayIndex());

  // Справочники зависят только от студии, занятия — ещё и от недели: листание
  // недель не перезапрашивает тренировки и тренеров.
  const {
    data: workouts = [],
    isFetching: workoutsFetching,
    isPending: workoutsPending,
  } = useQuery({
    queryKey: ["workouts", studioId, WORKOUT_COLS],
    queryFn: () =>
      unwrap<Workout[]>(
        supabase.from("workouts").select(WORKOUT_COLS).eq("studio_id", studioId!).order("name"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Ошибка загрузки тренировок" },
  });
  const { data: staff = [], isFetching: trainersFetching } = useQuery({
    queryKey: ["trainers", studioId, STAFF_COLS],
    queryFn: () =>
      unwrap<Trainer[]>(
        supabase
          .from("trainers")
          .select(STAFF_COLS)
          .eq("trainer_studios.studio_id", studioId!)
          .order("full_name"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Ошибка загрузки сотрудников" },
  });
  const trainers = useMemo(() => staff.filter((t) => t.role === "trainer"), [staff]);
  // Без placeholderData: пока грузится новая неделя, занятий нет вовсе, а не
  // занятия прошлой — иначе «Дублировать неделю» скопировал бы чужую неделю.
  // Ответ, пришедший после перелистывания, ложится в кэш своей недели.
  const weekFrom = weekStart.toISOString();
  const {
    data: entries = [],
    isFetching: entriesFetching,
    isPending: entriesPending,
  } = useQuery({
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
  // Фильтр типа, выбранный в подписочной студии, в пакетной не действует.
  const typeFilter = packages ? ALL_FILTER_VALUE : filterType;
  // Тренировки этой недели — для фильтра: в списке только то, что стоит в
  // расписании на экране, с цветом тренировки (у подписочных — цветом типа).
  const weekWorkouts = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; color: string | null }>();
    for (const e of entries) {
      if (e.kind !== "group" || !e.workout_id || byId.has(e.workout_id)) continue;
      byId.set(e.workout_id, {
        id: e.workout_id,
        name: e.workout?.name ?? "Тренировка",
        color: e.workout?.color ?? dayTypeColor(e.workout?.type)?.hex ?? null,
      });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [entries]);
  // Выбранной тренировки нет на этой неделе — фильтр не действует.
  const workoutFilter = weekWorkouts.some((w) => w.id === filterWorkoutId)
    ? filterWorkoutId
    : ALL_FILTER_VALUE;
  const filtersActive =
    typeFilter !== ALL_FILTER_VALUE ||
    workoutFilter !== ALL_FILTER_VALUE ||
    filterTrainerId !== ALL_FILTER_VALUE ||
    kindFilter.length !== ACTIVITY_KIND_VALUES.length;

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  // Колонки сетки: на телефоне — только выбранный день. Индекс дня храним,
  // чтобы подпись (Пн, Вт…) и ключ ячейки оставались прежними.
  const visibleDays = isMobile ? [dayIndex] : weekDays.map((_, i) => i);

  // Видимые занятия раскладываем по ячейкам один раз, а не сканируем весь
  // список для каждой ячейки и каждого часа.
  const grid = useMemo(() => {
    const cells = new Map<string, Entry[]>();
    const busyHours = new Set<number>();
    // Занятий по дням недели — точки под днями в переключателе на телефоне.
    const perDay = Array.from({ length: 7 }, () => 0);
    for (const e of entries) {
      if (!kindFilter.includes(e.kind)) continue;
      // Тип тренировки есть только у групповых: при выбранном типе прочие скрыты.
      if (typeFilter !== ALL_FILTER_VALUE && (e.kind !== "group" || e.workout?.type !== typeFilter))
        continue;
      // Тренировка есть только у групповых: при выбранной прочие скрыты.
      if (workoutFilter !== ALL_FILTER_VALUE && e.workout_id !== workoutFilter) continue;
      if (
        filterTrainerId !== ALL_FILTER_VALUE &&
        !e.schedule_entry_trainers?.some((x) => x.trainer_id === filterTrainerId)
      )
        continue;
      const start = new Date(e.starts_at);
      const key = cellKey(start, start.getHours());
      cells.set(key, [...(cells.get(key) ?? []), e]);
      busyHours.add(start.getHours());
      perDay[(start.getDay() + 6) % 7]++;
    }
    return { cells, busyHours, perDay };
  }, [entries, kindFilter, typeFilter, workoutFilter, filterTrainerId]);

  const openSlot = (day: Date, hour: number) => {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    if (copySource) {
      pasteCopy(copySource, start);
      return;
    }
    setEditing(null);
    setPresetStart(start);
    setPickerOpen(true);
  };

  const pickKind = (kind: ActivityKind) => {
    setFormKind(kind);
    setPickerOpen(false);
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
        description: `Все занятия с недели ${weekLabel} (${entries.length}) будут скопированы на следующую неделю (${fmtDate(nextWeekStart)} — ${fmtDate(addDays(nextWeekStart, 6))}) в те же дни и время, с теми же тренерами. Записи клиентов не копируются. Уже существующие на следующей неделе занятия (то же занятие и время) пропускаются.`,
        confirmLabel: "Дублировать",
        destructive: false,
      }))
    )
      return;
    setDuplicatingWeek(true);
    try {
      // Уже стоящие на следующей неделе занятия (то же занятие и время) не дублируем.
      const { data: existing, error: exErr } = await supabase
        .from("schedule_entries")
        .select("kind, workout_id, title, starts_at, schedule_entry_trainers(trainer_id)")
        .eq("studio_id", studioId)
        .gte("starts_at", nextWeekStart.toISOString())
        .lt("starts_at", addDays(nextWeekStart, 7).toISOString());
      if (exErr) {
        toast.error("Ошибка проверки следующей недели: " + exErr.message);
        return;
      }
      const existingKeys = new Set(
        (
          (existing ?? []) as Pick<
            Entry,
            "kind" | "workout_id" | "title" | "starts_at" | "schedule_entry_trainers"
          >[]
        ).map((e) => entryKey({ ...e, trainerIds: trainerIdsOf(e) })),
      );
      const drafts = entries
        .map((e) => copyDraft(e, new Date(new Date(e.starts_at).getTime() + WEEK_MS)))
        .filter((d) => !existingKeys.has(entryKey(d)));
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
    setPickerOpen(true);
  };

  const openEdit = (e: Entry) => {
    setEditing(e);
    setFormKind(e.kind);
    setPresetStart(null);
    setDialogOpen(true);
  };

  /** true — занятие удалено (окно можно закрыть), false — отказ или ошибка. */
  const handleDelete = async (e: Entry) => {
    if (
      !(await confirm({
        title: "Удалить занятие?",
        // Брони (schedule_bookings) удаляются каскадом, а журнал переводит в
        // «Отменено» триггер db/migrations/…_schedule_entry_delete.sql.
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
            {/* На телефоне — коротко, чтобы обе кнопки встали в одну строку. */}
            Дублировать<span className="max-sm:hidden"> неделю</span>
          </Button>
          <Button onClick={openAdd} disabled={!studioId}>
            <Plus />
            Добавить<span className="max-sm:hidden"> занятие</span>
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <div className="toolbar-full flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Предыдущая неделя"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
              >
                <ChevronLeft />
              </Button>
              {/*
                На телефоне кнопка между стрелками показывает саму неделю (места
                под отдельную подпись нет) и по-прежнему возвращает к текущей —
                вместе с сегодняшним днём.
              */}
              <Button
                variant="outline"
                className="max-sm:flex-1"
                onClick={() => {
                  setWeekStart(startOfWeek(new Date()));
                  setDayIndex(todayIndex());
                }}
                disabled={isCurrentWeek && !isMobile}
              >
                <span className="sm:hidden">{weekLabel}</span>
                <span className="max-sm:hidden">Текущая неделя</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Следующая неделя"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
              >
                <ChevronRight />
              </Button>
              <span className="ml-1 text-sm font-medium max-sm:hidden">{weekLabel}</span>
              {/* Первая загрузка недели — скелетон в сетке, спиннер — только для обновления. */}
              {loading && !entriesPending && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="toolbar-full flex flex-wrap items-center gap-2 sm:ml-auto">
              {!packages && (
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-40 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
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
              )}
              <KindFilter value={kindFilter} onChange={setKindFilter} />
              <Select value={workoutFilter} onValueChange={setFilterWorkoutId}>
                <SelectTrigger className="w-48 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
                  <SelectValue placeholder="Все тренировки" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Все тренировки</SelectItem>
                  {weekWorkouts.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: w.color ?? "var(--muted-foreground)" }}
                        />
                        {w.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterTrainerId} onValueChange={setFilterTrainerId}>
                <SelectTrigger className="w-48 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
                  <SelectValue placeholder="Все сотрудники" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Все сотрудники</SelectItem>
                  {/* С администраторами: их отмечают на прочих активностях. */}
                  {staff.map((t) => (
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
                  setFilterWorkoutId(ALL_FILTER_VALUE);
                  setFilterTrainerId(ALL_FILTER_VALUE);
                  setKindFilter(ACTIVITY_KIND_VALUES);
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
                  Копирование «{entryTitle(copySource)}» — кликните на свободный слот, чтобы
                  вставить.
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

          {/*
            Телефон: переключатель дня вместо шапки сетки. Точка под днём —
            в этот день есть занятия (с учётом фильтров); сегодня — розовым,
            как отметка «сегодня» в недельной сетке.
          */}
          {isMobile && (
            <div className="grid grid-cols-7 gap-1 rounded-lg border bg-background p-1">
              {weekDays.map((d, i) => {
                const today = d.toDateString() === new Date().toDateString();
                const selected = i === dayIndex;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={selected}
                    aria-label={d.toLocaleDateString("ru-RU", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                    onClick={() => setDayIndex(i)}
                    className={cn(
                      "flex flex-col items-center rounded-md py-1.5 text-xs transition-colors",
                      selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                      today && !selected && "text-brand",
                    )}
                  >
                    <span
                      className={cn("uppercase", !selected && !today && "text-muted-foreground")}
                    >
                      {DAY_NAMES[i]}
                    </span>
                    <span className="text-base font-semibold tabular-nums leading-tight">
                      {d.getDate()}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 size-1 rounded-full",
                        grid.perDay[i] > 0 ? "bg-current" : "bg-transparent",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          )}

          <div className="overflow-auto rounded-lg border bg-background md:max-h-[calc(100dvh-220px)]">
            <div
              className={cn("grid", !isMobile && "min-w-[1200px]")}
              style={{
                gridTemplateColumns: `${isMobile ? 52 : 60}px repeat(${visibleDays.length}, minmax(0, 1fr))`,
              }}
            >
              {!isMobile && (
                <>
                  <div className="sticky top-0 z-20 border-b border-r bg-background" />
                  {weekDays.map((d, i) => {
                    const today = d.toDateString() === new Date().toDateString();
                    return (
                      <div
                        key={i}
                        className={`sticky top-0 z-20 border-r bg-background p-2 text-center text-xs ${
                          today
                            ? "border-b-4 border-b-brand font-semibold text-primary"
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
                </>
              )}

              {HOURS.map((hour) => {
                const rowHeight =
                  grid.busyHours.has(hour) || (entriesPending && SCHEDULE_SKELETON_HOURS.has(hour))
                    ? SLOT_PX_FULL
                    : SLOT_PX_EMPTY;
                return (
                  <div key={`row-${hour}`} className="contents">
                    <div
                      className="border-b border-r px-2 text-right text-xs text-muted-foreground"
                      style={{ height: rowHeight, lineHeight: "1rem", paddingTop: 4 }}
                    >
                      {pad(hour)}:00
                    </div>
                    {visibleDays.map((di) => {
                      const day = weekDays[di];
                      return (
                        <div
                          key={`${hour}-${di}`}
                          className={cn(
                            "relative border-b border-r max-md:border-r-0",
                            // Пакетные студии: слоты — светлее подложки раздела (её цвет
                            // наполовину с белым фоном сетки), линии — обычные светло-серые
                            // (--border); шапка дней и столбец времени — белые.
                            packages && "bg-canvas/50",
                          )}
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
                            className={cn(
                              "absolute inset-0 transition",
                              packages ? "hover:bg-black/5" : "hover:bg-accent/40",
                            )}
                          />
                          {entriesPending && isScheduleSkeletonCell(hour, di, isMobile) && (
                            <EntryCardSkeleton />
                          )}
                          {grid.cells.get(cellKey(day, hour))?.map((e) => (
                            <EntryCard
                              key={e.id}
                              entry={e}
                              packages={packages}
                              onOpen={() => openEdit(e)}
                              onCopy={() => startCopy(e)}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {!workoutsPending && workouts.length === 0 && (
            <InfoNote variant="empty">
              Чтобы добавлять групповые занятия, сначала создайте тренировки в разделе «Тренировки».
              Персональные занятия и прочие активности тренировок не требуют.
            </InfoNote>
          )}
        </RequireStudio>
      </div>

      <KindPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        hasWorkouts={workouts.length > 0}
        onPick={pickKind}
      />

      <EntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        kind={formKind}
        studioId={studioId}
        workouts={workouts}
        trainers={trainers}
        staff={staff}
        entry={editing}
        presetStart={presetStart}
        onSaved={reloadEntries}
        onDelete={handleDelete}
      />

      {confirmDialog}
    </AdminShell>
  );
}

/**
 * Фильтр по типам занятий — галочки прямо в панели фильтров (решение
 * владельца 2026-10-11: на клик меньше, чем выпадающий список). По умолчанию
 * отмечены все; последний отмеченный тип снять нельзя — пустая сетка только
 * путает.
 */
function KindFilter({
  value,
  onChange,
}: {
  value: ActivityKind[];
  onChange: (v: ActivityKind[]) => void;
}) {
  const toggle = (kind: ActivityKind, checked: boolean) => {
    onChange(ACTIVITY_KIND_VALUES.filter((k) => (k === kind ? checked : value.includes(k))));
  };
  return (
    <div
      role="group"
      aria-label="Какие занятия показывать"
      className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-1.5 max-sm:w-full lg:min-h-9"
    >
      {ACTIVITY_KINDS.map((k) => {
        const checked = value.includes(k.value);
        return (
          <CheckboxOption
            key={k.value}
            checked={checked}
            disabled={checked && value.length === 1}
            onCheckedChange={(v) => toggle(k.value, v)}
            className="whitespace-nowrap"
          >
            {k.plural}
          </CheckboxOption>
        );
      })}
    </div>
  );
}

/** Выбор типа нового занятия — плитки с иконками; дальше форма этого типа. */
function KindPickerDialog({
  open,
  onOpenChange,
  hasWorkouts,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Групповое занятие ставится по тренировке — без тренировок плитка выключена. */
  hasWorkouts: boolean;
  onPick: (kind: ActivityKind) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Что добавить в расписание?</DialogTitle>
          <DialogDescription>Выберите тип занятия.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {ACTIVITY_KINDS.map((k) => {
              const disabled = k.value === "group" && !hasWorkouts;
              return (
                <button
                  key={k.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(k.value)}
                  className="group flex items-center gap-3 rounded-lg border p-3 text-left transition hover:border-foreground/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent sm:flex-col sm:items-start sm:p-4"
                >
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl sm:size-12"
                    style={{ backgroundColor: `${k.color}1f`, color: k.color }}
                  >
                    <k.icon className="size-6" />
                  </span>
                  <span className="space-y-1">
                    <span className="block text-sm font-semibold">{k.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {disabled
                        ? "Сначала создайте тренировки в разделе «Тренировки»"
                        : k.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Бейдж «записано/мест» и очередь листа ожидания на карточке занятия. */
function CapacityBadge({ entry, light }: { entry: Entry; light?: boolean }) {
  const cap = entryCapacity(entry);
  if (!cap) return null;
  const left = Math.max(0, cap - entry.booked_count);
  const waiting = entry.waitlist_count ?? 0;
  const tone =
    left === 0
      ? "bg-red-500/90 text-white"
      : left <= 5
        ? "bg-amber-500/90 text-white"
        : light
          ? "bg-muted text-foreground"
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
  packages,
  onOpen,
  onCopy,
}: {
  entry: Entry;
  /** Пакетная студия: светлая карточка с полоской цвета тренировки и фото тренеров. */
  packages: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  const trainers = (entry.schedule_entry_trainers ?? []).flatMap((x) =>
    x.trainer ? [x.trainer] : [],
  );
  const names = trainers.map((t) => t.full_name).join(", ");
  // Персональное: «тренер + клиент» — видно, с кем занятие.
  const clients = entry.kind === "personal" ? participantNames(entry) : "";
  const people = [names, clients].filter(Boolean).join(" + ");
  // Персональные и прочие в обоих форматах — светлая карточка с тёмной
  // полоской: так они не путаются с групповыми.
  const group = entry.kind === "group";
  if (packages || !group) {
    return (
      <div
        className="absolute inset-1 overflow-hidden rounded-md border border-l-4 bg-background text-[11px] leading-tight text-foreground shadow-xs"
        // Без цвета (тренировка заведена до 2026-10-11) — серая полоска.
        style={{
          borderLeftColor: group
            ? (entry.workout?.color ?? "var(--muted-foreground)")
            : NON_GROUP_STRIPE,
        }}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex h-full w-full cursor-pointer flex-col px-1.5 py-1 text-left hover:bg-accent/40"
        >
          <span className="flex w-full items-start justify-between gap-1">
            <span className="whitespace-nowrap text-muted-foreground">
              {fmtTime(entry.starts_at)}–{fmtTime(entry.ends_at)}
            </span>
            <CapacityBadge entry={entry} light />
          </span>
          <span
            className={cn(
              "mt-0.5 text-[13px] font-semibold leading-snug",
              // Персональному название в одну строку — место под клиента.
              clients ? "truncate" : "line-clamp-2",
            )}
          >
            {entryTitle(entry)}
          </span>
          {people && (
            <span className="mt-0.5 flex min-w-0 items-center gap-1 pr-5">
              <span className="flex shrink-0 -space-x-1.5">
                {trainers.map((t) => (
                  <EmployeePhoto
                    key={t.id}
                    value={t.photo_url ?? null}
                    name={t.full_name}
                    className="size-4 text-[7px] ring-1 ring-background"
                  />
                ))}
              </span>
              {/* У персонального «тренер + клиент» — до двух строк, имя клиента не режем. */}
              <span
                className={cn(
                  "text-muted-foreground",
                  clients ? "line-clamp-2 break-words" : "truncate",
                )}
              >
                {people}
              </span>
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label="Копировать занятие"
          title="Копировать занятие"
          onClick={onCopy}
          className="absolute bottom-1 right-1.5 rounded bg-muted p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
    );
  }
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
        <span className="mt-0.5 text-[13px] font-semibold leading-snug line-clamp-2">
          {entryTitle(entry)}
        </span>
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
  /** Тип нового занятия; у правки — тип самого занятия (entry.kind). */
  kind: ActivityKind;
  studioId: string | null;
  workouts: Workout[];
  /** Тренеры студии — для групповых и персональных занятий. */
  trainers: Trainer[];
  /** Все сотрудники студии (и администраторы) — для прочей активности. */
  staff: Trainer[];
  entry: Entry | null;
  presetStart: Date | null;
  onSaved: () => void;
  /** Спрашивает подтверждение и удаляет; true — удалено. */
  onDelete: (entry: Entry) => Promise<boolean>;
};

/** Тексты формы по типу занятия. */
const FORM_TEXT: Record<
  ActivityKind,
  { create: string; edit: string; hint: string; added: string; updated: string }
> = {
  group: {
    create: "Новое групповое занятие",
    edit: "Групповое занятие",
    hint: "Выберите тренировку, время и тренеров.",
    added: "Занятие добавлено",
    updated: "Занятие обновлено",
  },
  personal: {
    create: "Новое персональное занятие",
    edit: "Персональное занятие",
    hint: "Выберите тренера, клиента и время. Клиенты в приложении персональные занятия не видят.",
    added: "Персональное занятие добавлено",
    updated: "Персональное занятие обновлено",
  },
  other: {
    create: "Новая прочая активность",
    edit: "Прочая активность",
    hint: "Название, время, сотрудники и ставка. Клиенты в приложении её не видят.",
    added: "Активность добавлена",
    updated: "Активность обновлена",
  },
};

const TIPS = {
  workout: "Из раздела «Тренировки»: оттуда берутся описание, фото и вместимость.",
  starts:
    "От него считается срок, до которого клиент может отменить запись сам (см. «Настройки клуба»).",
  groupTrainers: "Клиенты видят их имена в расписании приложения. Можно выбрать нескольких.",
  personalTrainer:
    "Тренер, который проводит занятие. В зарплату ему пойдёт ставка за персональную тренировку из «Зарплатных ставок».",
  title: "Как активность будет подписана в расписании, например «Мастер-класс» или «Съёмка».",
  personalClients: "С кем занятие. Позже с абонемента на персональные будет списываться посещение.",
  groupClients:
    "Обычно клиенты записываются сами в приложении. Здесь — записать без приложения или на пробное.",
  otherStaff:
    "Тренеры и администраторы, которые участвуют, — им начислится ставка. Можно никого не выбирать.",
  payRate:
    "Сколько получит за эту активность каждый отмеченный сотрудник, в лари — пойдёт в зарплату. Без сотрудников можно не указывать.",
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
        <EntryForm key={formProps.entry?.id ?? `new-${formProps.kind}`} {...formProps} />
      </DialogContent>
    </Dialog>
  );
}

/** Ставка из поля ввода: null — пусто, NaN — не число или меньше нуля. */
function parsePayRate(v: string) {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/** Галочки сотрудников; с byRole — тренеры и администраторы отдельными группами. */
function TrainerChecks({
  options,
  value,
  onToggle,
  byRole,
}: {
  options: Trainer[];
  value: string[];
  onToggle: (id: string) => void;
  byRole?: boolean;
}) {
  const checks = (list: Trainer[]) => (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {list.map((t) => (
        <CheckboxOption
          key={t.id}
          checked={value.includes(t.id)}
          onCheckedChange={() => onToggle(t.id)}
        >
          {t.full_name}
        </CheckboxOption>
      ))}
    </div>
  );
  const admins = byRole ? options.filter((t) => t.role === "admin") : [];
  if (admins.length === 0) return <div className="rounded-md border p-3">{checks(options)}</div>;
  const others = options.filter((t) => t.role !== "admin");
  return (
    <div className="space-y-3 rounded-md border p-3">
      {others.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Тренеры</div>
          {checks(others)}
        </div>
      )}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Администраторы</div>
        {checks(admins)}
      </div>
    </div>
  );
}

function NoTrainersNote({ staff }: { staff?: boolean }) {
  return (
    <InfoNote variant="empty">
      В клубе нет {staff ? "сотрудников" : "тренеров"}. Добавьте их в разделе «Сотрудники» (в рейке
      слева) и отметьте этот клуб.
    </InfoNote>
  );
}

function EntryForm({
  onOpenChange,
  kind: newKind,
  studioId,
  workouts,
  trainers,
  staff,
  entry,
  presetStart,
  onSaved,
  onDelete,
}: Omit<EntryDialogProps, "open">) {
  // Тип занятия после создания не меняется.
  const kind = entry?.kind ?? newKind;
  const text = FORM_TEXT[kind];
  const [workoutId, setWorkoutId] = useState(entry?.workout_id ?? workouts[0]?.id ?? "");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [payRate, setPayRate] = useState(entry?.pay_rate != null ? String(entry.pay_rate) : "");
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
  // Клиенты нового занятия: записываются после его создания. У созданного —
  // панель записей, там запись сразу.
  const [pending, setPending] = useState<PickedClient[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;

  const toggleTrainer = (id: string) => {
    setTrainerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  // На прочую активность отмечают любых сотрудников студии, на занятия — тренеров.
  const pool = kind === "other" ? staff : trainers;
  // Тренер, которого отвязали от студии, остаётся на прежних занятиях —
  // показываем его в списке, чтобы его можно было снять с занятия.
  const trainerOptions = [
    ...pool,
    ...(entry?.schedule_entry_trainers ?? []).flatMap((x) =>
      x.trainer && !pool.some((t) => t.id === x.trainer_id) ? [x.trainer] : [],
    ),
  ];

  /** Правка занятия: строка и полный пересбор тренеров. Возвращает текст ошибки. */
  const updateEntry = async (id: string, row: Record<string, string | number | null>) => {
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

  /** Поля своего типа занятия или текст ошибки проверки. */
  const kindFields = ():
    | { workout_id: string | null; title: string | null; pay_rate: number | null }
    | string => {
    if (kind === "group") {
      if (!workoutId) return "Выберите тренировку";
      return { workout_id: workoutId, title: null, pay_rate: null };
    }
    if (kind === "personal") {
      if (trainerIds.length !== 1) return "Выберите тренера";
      if (!entry && pending.length === 0) return "Добавьте клиента";
      return { workout_id: null, title: null, pay_rate: null };
    }
    if (!title.trim()) return "Введите название активности";
    const rate = parsePayRate(payRate);
    if (Number.isNaN(rate)) return "Ставка — число не меньше 0";
    if (rate == null && trainerIds.length > 0)
      return "Укажите ставку — она пойдёт в зарплату отмеченным сотрудникам";
    return { workout_id: null, title: title.trim(), pay_rate: rate };
  };

  const handleSave = async () => {
    if (!studioId) return;
    const fields = kindFields();
    if (typeof fields === "string") {
      toast.error(fields);
      return;
    }
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (!(startDate.getTime() < endDate.getTime())) {
      toast.error("Время окончания должно быть позже начала");
      return;
    }
    const row = {
      kind,
      ...fields,
      starts_at: startDate.toISOString(),
      ends_at: endDate.toISOString(),
    };
    setSaving(true);
    try {
      if (entry && kind === "personal") {
        // Персональное без клиента не сохраняем: клиент записан в панели ниже.
        const { count } = await supabase
          .from("schedule_bookings")
          .select("id", { count: "exact", head: true })
          .eq("entry_id", entry.id)
          .in("status", ["booked", "attended"]);
        if (!count) {
          toast.error("Добавьте клиента — кнопка «Записать клиента» ниже");
          return;
        }
      }
      if (entry) {
        const failure = await updateEntry(entry.id, { studio_id: studioId, ...row });
        if (failure) {
          toast.error(failure);
          return;
        }
        toast.success(text.updated);
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
          toast.success(text.added);
        }
        // Клиенты — после создания: запись идёт по id занятия.
        const failed: string[] = [];
        for (const c of pending) {
          const err = await bookClient(res.ids[0], c.id);
          if (err) failed.push(`${c.name} (${err})`);
        }
        if (failed.length > 0) toast.error("Не записаны: " + failed.join(", "));
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

  const KindIcon = activityKind(kind).icon;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <KindIcon className="size-5 shrink-0" style={{ color: activityKind(kind).color }} />
          {entry ? text.edit : text.create}
        </DialogTitle>
        <DialogDescription>
          {entry && kind !== "other" ? "Настройки занятия, ниже — записанные клиенты." : text.hint}
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            {kind === "group" && (
              <FormField label="Тренировка" tip={TIPS.workout} required>
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
            )}

            {kind === "personal" && (
              <FormField
                label="Тренер"
                tip={TIPS.personalTrainer}
                required
                htmlFor={trainerOptions.length === 0 ? null : undefined}
              >
                {trainerOptions.length === 0 ? (
                  <NoTrainersNote />
                ) : (
                  <Select value={trainerIds[0] ?? ""} onValueChange={(id) => setTrainerIds([id])}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите тренера" />
                    </SelectTrigger>
                    <SelectContent>
                      {trainerOptions.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}

            {kind === "other" && (
              <FormField label="Название" tip={TIPS.title} required>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например, мастер-класс"
                  autoFocus
                />
              </FormField>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Начало" tip={kind === "group" ? TIPS.starts : undefined} required>
                <Input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </FormField>
              <FormField label="Окончание" required>
                <Input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </FormField>
            </div>

            {kind !== "personal" && (
              <FormField
                label={kind === "group" ? "Тренеры" : "Сотрудники"}
                tip={kind === "group" ? TIPS.groupTrainers : TIPS.otherStaff}
                optional
                htmlFor={null}
              >
                {trainerOptions.length === 0 ? (
                  <NoTrainersNote staff={kind === "other"} />
                ) : (
                  <TrainerChecks
                    options={trainerOptions}
                    value={trainerIds}
                    onToggle={toggleTrainer}
                    byRole={kind === "other"}
                  />
                )}
              </FormField>
            )}

            {kind === "other" && (
              <FormField
                label="Ставка, ₾"
                tip={TIPS.payRate}
                // Без ставки не сохранится, только если отмечены сотрудники.
                required={trainerIds.length > 0}
                optional={trainerIds.length === 0}
              >
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={payRate}
                  onChange={(e) => setPayRate(e.target.value)}
                  placeholder="0"
                />
              </FormField>
            )}

            {!entry && kind !== "other" && (
              <FormField
                label="Клиенты"
                tip={kind === "personal" ? TIPS.personalClients : TIPS.groupClients}
                required={kind === "personal"}
                optional={kind === "group"}
                htmlFor={null}
              >
                <div className="space-y-2">
                  {pending.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pending.map((c) => (
                        <span
                          key={c.id}
                          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 pl-3 pr-1.5 text-sm"
                        >
                          {c.name}
                          <button
                            type="button"
                            aria-label={`Убрать ${c.name}`}
                            onClick={() => setPending((prev) => prev.filter((x) => x.id !== c.id))}
                            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <ParticipantActions
                    studioId={studioId}
                    trial={kind === "group"}
                    onPick={(c) =>
                      setPending((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]))
                    }
                  />
                </div>
              </FormField>
            )}

            {entry && kind !== "other" && (
              <BookingsPanel entry={entry} trial={kind === "group"} onChanged={onSaved} />
            )}
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
  user_id: string | null;
  /** Карточка клиента; у старых записей из приложения может не быть. */
  client_id: string | null;
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
  /** Пакетный формат: остаток персональных и вид баланса абонемента. */
  personal_left: number;
  balance_kind: "group" | "personal";
  membership: { name: string | null } | null;
};

type BookingsData = {
  bookings: BookingRow[];
  clientsById: Map<string, ClientRow>;
  clientsByUser: Map<string, ClientRow>;
  /** У клиента пакетной студии может быть два: пакет тренировок и пакет персональных. */
  membershipsByClient: Map<string, ActiveMembershipRow[]>;
};

function bookingClient(data: BookingsData | undefined, b: BookingRow) {
  return (
    (b.client_id ? data?.clientsById.get(b.client_id) : undefined) ??
    (b.user_id ? data?.clientsByUser.get(b.user_id) : undefined)
  );
}

/** Записи на занятие + карточки клиентов + их активные абонементы. */
async function fetchBookings(entry: Entry): Promise<BookingsData> {
  const bookings = await unwrap<BookingRow[]>(
    supabase
      .from("schedule_bookings")
      .select("id, user_id, client_id, status, created_at")
      .eq("entry_id", entry.id)
      .in("status", ["booked", "attended", "waitlist"])
      .order("created_at"),
  );
  const clientsById = new Map<string, ClientRow>();
  const clientsByUser = new Map<string, ClientRow>();
  const membershipsByClient = new Map<string, ActiveMembershipRow[]>();
  const empty = { bookings, clientsById, clientsByUser, membershipsByClient };
  const clientIds = Array.from(new Set(bookings.map((r) => r.client_id).filter(Boolean)));
  // Старые записи из приложения без карточки — по учётной записи.
  const userIds = Array.from(
    new Set(bookings.filter((r) => !r.client_id).map((r) => r.user_id)),
  ).filter((v): v is string => !!v);
  if (clientIds.length === 0 && userIds.length === 0) return empty;

  // Карточки и абонементы — дополнение: если они не загрузились, записи всё
  // равно показываем (с «Пользователь без анкеты»), а не ошибку на всю панель.
  const cols = "id, user_id, first_name, last_name, full_name, phone, email, crm_link";
  const [byId, byUser] = await Promise.all([
    clientIds.length
      ? supabase.from("clients").select(cols).in("id", clientIds)
      : Promise.resolve({ data: [] as ClientRow[] }),
    userIds.length
      ? supabase
          .from("clients")
          .select(cols)
          .eq("studio_id", entry.studio_id)
          .in("user_id", userIds)
      : Promise.resolve({ data: [] as ClientRow[] }),
  ]);
  const clients: ClientRow[] = [...(byId.data ?? []), ...(byUser.data ?? [])];
  for (const c of clients) {
    clientsById.set(c.id, c);
    if (c.user_id) clientsByUser.set(c.user_id, c);
  }
  if (clients.length === 0) return empty;

  const { data: mData } = await supabase
    .from("client_memberships")
    .select(
      "client_id, started_at, ends_at, visits_left, personal_left, balance_kind, membership:memberships(name)",
    )
    .eq("status", "active")
    .in(
      "client_id",
      clients.map((c) => c.id),
    );
  // membership — связь «многие к одному», но разбор select без схемы базы
  // считает любую связь массивом.
  const memberships = (mData ?? []) as unknown as ActiveMembershipRow[];
  for (const m of memberships)
    membershipsByClient.set(m.client_id, [...(membershipsByClient.get(m.client_id) ?? []), m]);
  return empty;
}

/**
 * Абонемент, с которого спишется посещение: на персональном (пакетная
 * студия) — с остатком персональных, иначе пакет персональных; на остальных —
 * абонемент обычных тренировок.
 */
function pickMembership(rows: ActiveMembershipRow[] | undefined, personal: boolean) {
  if (!rows?.length) return undefined;
  if (personal)
    return (
      rows.find((r) => r.personal_left > 0) ??
      rows.find((r) => r.balance_kind === "personal") ??
      rows[0]
    );
  return rows.find((r) => r.balance_kind !== "personal") ?? rows[0];
}

const BOOK_REASONS: Record<string, string> = {
  full: "мест нет",
  already_booked: "уже записан",
  forbidden: "нет прав в этом клубе",
  not_bookable: "на прочую активность не записывают",
  client_not_found: "клиент не из этого клуба",
  not_found: "занятие не найдено",
};

/** Записывает клиента на занятие (RPC admin_book_client); текст ошибки или null. */
async function bookClient(entryId: string, clientId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("admin_book_client", {
    p_entry_id: entryId,
    p_client_id: clientId,
  });
  if (error) return error.message;
  const result = data as { ok?: boolean; reason?: string } | null;
  if (result?.ok) return null;
  return BOOK_REASONS[result?.reason ?? ""] ?? result?.reason ?? "неизвестная ошибка";
}

type PickedClient = { id: string; name: string };

/**
 * «Записать клиента» — выбор клиента студии; «Записать пробника» (у
 * групповых) — новая карточка клиента: он попадает в «Клиенты» потенциальным
 * членом клуба. Оба отдают клиента наверх — там его записывают.
 */
function ParticipantActions({
  studioId,
  trial,
  onPick,
  disabled,
}: {
  studioId: string | null;
  trial: boolean;
  onPick: (c: PickedClient) => void;
  disabled?: boolean;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPickOpen(true)}
          disabled={disabled || !studioId}
        >
          <UserPlus />
          Записать клиента
        </Button>
        {trial && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTrialOpen(true)}
            disabled={disabled || !studioId}
          >
            <Plus />
            Записать пробника
          </Button>
        )}
      </div>
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="max-w-md">
          <PickClientForm
            studioId={studioId}
            onCancel={() => setPickOpen(false)}
            onPick={(c) => {
              setPickOpen(false);
              onPick(c);
            }}
          />
        </DialogContent>
      </Dialog>
      <ClientDialog
        open={trialOpen}
        onOpenChange={setTrialOpen}
        studioId={studioId}
        client={null}
        createTitle="Записать пробника"
        createDescription="Новый клиент появится в «Клиентах» как потенциальный член клуба и будет записан на это занятие."
        onSaved={(c) => onPick({ id: c.id, name: clientName(c) })}
      />
    </>
  );
}

function PickClientForm({
  studioId,
  onPick,
  onCancel,
}: {
  studioId: string | null;
  onPick: (c: PickedClient) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<ClientOption | null>(null);
  const handleSubmit = () => {
    if (!picked) {
      toast.error("Выберите клиента");
      return;
    }
    onPick({ id: picked.id, name: clientName(picked) });
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Записать клиента</DialogTitle>
        <DialogDescription>Клиент клуба — поиск по имени, телефону или почте.</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSubmit}>
        <DialogBody>
          <FormField label="Клиент" required>
            <ClientCombobox
              studioId={studioId}
              value={picked?.id ?? ""}
              onChange={(_, c) => setPicked(c)}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit">Записать</Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
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

function BookingsPanel({
  entry,
  trial,
  onChanged,
}: {
  entry: Entry;
  /** Групповое: можно записать на пробное посещение нового клиента. */
  trial: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  // Пакетная студия: на персональном занятии посещение списывается с баланса
  // персональных — его и показываем у клиента.
  const personalBalance = useActiveStudio()?.format === "packages" && entry.kind === "personal";
  const [booking, setBooking] = useState(false);
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
    // Посещение списало тренировку — баланс в «Абонементах» изменился.
    queryClient.invalidateQueries({ queryKey: ["client_packages_list"] });
    onChanged();
  };

  const addParticipant = async (c: PickedClient) => {
    setBooking(true);
    try {
      const err = await bookClient(entry.id, c.id);
      if (err) {
        toast.error(`Не удалось записать ${c.name}: ${err}`);
        return;
      }
      toast.success(`${c.name} — записан(а)`);
      reload();
    } finally {
      setBooking(false);
    }
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
            Записанные клиенты
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {booked.length}
            {capacity != null ? ` / ${capacity}` : ""}
            {waitlisted.length > 0 && ` · +${waitlisted.length} в очереди`}
          </span>
        </div>

        <ParticipantActions
          studioId={entry.studio_id}
          trial={trial}
          onPick={addParticipant}
          disabled={booking}
        />

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            ))}
          </div>
        ) : booked.length === 0 ? (
          <InfoNote variant="empty">
            {entry.kind === "personal"
              ? "Клиент не выбран — нажмите «Записать клиента»."
              : "Пока никто не записан."}
          </InfoNote>
        ) : (
          <div className="space-y-2">
            {booked.map((b) => {
              const c = bookingClient(data, b);
              const m = c
                ? pickMembership(data?.membershipsByClient.get(c.id), personalBalance)
                : undefined;
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
                        {personalBalance
                          ? `персональных осталось ${m.personal_left}`
                          : m.visits_left != null
                            ? `осталось ${m.visits_left}`
                            : "безлимит"}{" "}
                        · {formatDate(m.started_at)} – {m.ends_at ? formatDate(m.ends_at) : "∞"}
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
              const c = bookingClient(data, b);
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
        {/* Окно открыто из формы занятия; всплытие submit в неё гасит DialogForm. */}
        <DialogContent className="max-w-md">
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
            <FormField
              label="Причина отмены"
              tip="Сохранится в «Истории записей» — потом видно, почему бронь отклонили."
              optional
            >
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
