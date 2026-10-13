import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Plus,
  ChevronDown,
  Loader2,
  Pencil,
  Repeat,
  Trash2,
  Copy,
  Undo2,
  UserPlus,
  X,
  Maximize,
  Minimize,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useActiveStudio } from "@/hooks/use-studios";
import { useCatalogStudioIds } from "@/hooks/use-catalog-studios";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { fieldTriggerClass } from "@/components/ui/field-styles";
import { PeriodStepper } from "@/components/period-stepper";
import { ChoiceCard } from "@/components/ui/choice-card";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { attendanceBlock, balanceFor, tbilisiDate, type Coverage } from "@/lib/booking-coverage";
import {
  pickTrainer,
  regularTrainerIds,
  removeTrainer,
  substitutionsOf,
  trainerChanges,
  undoSubstitution,
  type PickMode,
  type SubstitutionRow,
  type SubsMap,
  type TrainerAssignment,
} from "@/lib/schedule-trainers";
import { roleGroup } from "@/lib/staff-roles";
import { clientName, formatDate, toDateTimeLocalValue } from "@/lib/format";
import { ClubStatusBadge } from "@/components/club-status-badge";
import type { ClubStatus } from "@/lib/client-status";
import { parseTranslations, translationText } from "@/lib/content-i18n";
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
import { StaffOption } from "@/components/employee-photo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { noteChipClass } from "@/components/comment-cell";
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
  /** trainer | admin | masseur — справочник «Сотрудники». */
  role?: string;
  /** Фото из справочника — аватарка в выпадающих списках. */
  photo_url?: string | null;
  /** Переводы имени — английское в полноэкранном просмотре. */
  translations?: unknown;
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
  /** Отменено (cancel_schedule_entry): клиенты не видят, записаться нельзя. */
  cancelled_at: string | null;
  cancel_reason: string | null;
  workout?: {
    name: string;
    type?: string;
    capacity?: number | null;
    /** Пакетный формат: цвет полоски на карточке. */
    color?: string | null;
    translations?: unknown;
  } | null;
  schedule_entry_trainers?: {
    trainer_id: string;
    trainer: Trainer | null;
    /**
     * Замена (пакетные клубы): этот тренер заменяет replaced_trainer_id —
     * schedule_entry_substitutions. Связь «один к одному»; без схемы базы
     * разбор select может отдать и массив.
     */
    substitution?: SubstitutionRow | SubstitutionRow[] | null;
  }[];
  /** Записи с карточками клиентов — для подписи персонального на карточке. */
  participants?: { status: string; client: ParticipantName | null }[];
};

type ParticipantName = {
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  id: string;
  /** Абонементы клиента: когда выдан и вид (пробный или нет) — для «новеньких». */
  client_memberships?: { created_at: string; membership: { kind: string | null } | null }[];
};

/** Клиенты персонального занятия: «Фамилия Имя» записанных (не отменённых). */
function participantNames(e: Entry) {
  return (e.participants ?? [])
    .filter((p) => p.client && (p.status === "booked" || p.status === "attended"))
    .map((p) => clientName(p.client!))
    .join(", ");
}

/**
 * Новенькие на занятии — записанные клиенты, у которых к началу занятия не
 * было абонементов, кроме пробного (решение владельца 2026-10-13). Не текущий
 * статус ПЧК: «Посетил» без абонемента не отметить, пробное — тоже абонемент,
 * и после занятия пробник уже ЧК — счётчик прошедших занятий обнулялся бы.
 */
function newcomerIds(e: Entry): Set<string> {
  const start = new Date(e.starts_at).getTime();
  const ids = new Set<string>();
  for (const p of e.participants ?? []) {
    if (!p.client || (p.status !== "booked" && p.status !== "attended")) continue;
    const hadPackage = (p.client.client_memberships ?? []).some(
      (m) => m.membership?.kind !== "trial" && new Date(m.created_at).getTime() < start,
    );
    if (!hadPackage) ids.add(p.client.id);
  }
  return ids;
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
  "*, workout:workouts(name, type, capacity, color, translations), schedule_entry_trainers(trainer_id, trainer:trainers(id, full_name, translations), substitution:schedule_entry_substitutions(replaced_trainer_id, replaced:trainers(full_name))), participants:schedule_bookings(status, client:clients(id, first_name, last_name, full_name, client_memberships(created_at, membership:memberships(kind))))";
// Колонки справочников входят в ключ запроса: разделы «Тренировки» и «Сотрудники»
// грузят те же таблицы целиком, и общий ключ подсовывал бы им наш урезанный кэш.
const WORKOUT_COLS = "id, name, type, capacity";
// Сотрудники общие для студий: в расписание ставим тех, кто привязан к этой
// студии (trainer_studios). Занятия ведут тренеры; на прочую активность
// (например, фотосъёмку) можно отметить и администраторов.
const STAFF_COLS = "id, full_name, role, photo_url, trainer_studios!inner(studio_id)";

/** Полоска на карточках персональных занятий и прочих активностей. */
const NON_GROUP_STRIPE = "#262626";

/**
 * Причины отмены занятия (решение владельца 2026-10-11: не больше четырёх,
 * пятая — «Другое» со своим текстом). Первая — самая частая, выбрана сразу.
 */
const ENTRY_CANCEL_REASONS = [
  "Мало записавшихся",
  "Заболел тренер",
  "Технические проблемы в зале",
  "Праздник или нерабочий день",
];
const OTHER_REASON = "other";

const ADMIN_CANCEL_REASONS = [
  "Клиент отменил",
  "Клиент не пришёл",
  "Замена или перенос",
  "Технические причины",
  "Другое",
];
const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
// Полноэкранный просмотр — на английском: скриншот уходит клиентам с разными
// языками (решение владельца 2026-10-13).
const DAY_NAMES_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Английский перевод поля контента, нет — русский текст. */
function enText(translations: unknown, field: string, ru: string) {
  return translationText(parseTranslations(translations), "en", field).trim() || ru;
}
// Часы сетки по умолчанию — 7..22; занятие раньше или позже расширяет сетку
// (иначе оно было бы в базе, но не на экране).
// С 9:00: на 7 и 8 утра занятий не бывает (решение владельца 2026-10-13);
// занятие раньше всё равно покажется — сетка расширится до его часа.
const FIRST_HOUR = 9;
const LAST_HOUR = 22;
// Высота часа с занятиями — по самой высокой карточке (две строки названия +
// строка тренеров или «тренер + клиент» в две строки). Меняешь вёрстку
// EntryCard — перемерь и поправь здесь и в SLOT_FULL (page-skeletons.tsx).
const SLOT_PX_FULL = 72;
const SLOT_PX_EMPTY = 28;
// Полноэкранный просмотр: высота строки с занятиями — по карточкам, пустой
// час между занятиями — узкая полоска.
const SLOT_PX_FULLSCREEN_EMPTY = 16;
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

function fmtDate(d: Date, en = false) {
  return d.toLocaleDateString(en ? "en-GB" : "ru-RU", { day: "2-digit", month: "short" });
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

/** Тренеры для копии занятия: вместо заменяющего — тот, кого заменили. */
function regularTrainerIdsOf(e: Pick<Entry, "schedule_entry_trainers">) {
  return regularTrainerIds(e.schedule_entry_trainers);
}

/** Подпись занятия на карточке и в баннере копирования; `en` — полный экран. */
function entryTitle(e: Entry, en = false) {
  if (e.kind === "personal") return en ? "Personal training" : "Персональное занятие";
  // Название прочей активности — свободный текст без переводов.
  if (e.kind === "other") return e.title ?? (en ? "Activity" : "Прочая активность");
  const name = e.workout?.name ?? (en ? "Class" : "Занятие");
  return en ? enText(e.workout?.translations, "name", name) : name;
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
    trainerIds: regularTrainerIdsOf(e),
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
  // занятия светлая с полоской цвета тренировки (2026-10-11).
  const studio = useActiveStudio();
  const packages = studio?.format === "packages";
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
  // Отменённые занятия по умолчанию скрыты и тоже не запоминаются.
  const [showCancelled, setShowCancelled] = useState(false);
  const [filterType, setFilterType] = useState<string>(ALL_FILTER_VALUE);
  const [filterTrainerId, setFilterTrainerId] = useState<string>(ALL_FILTER_VALUE);
  const [filterWorkoutId, setFilterWorkoutId] = useState<string>(ALL_FILTER_VALUE);
  const [copySource, setCopySource] = useState<Entry | null>(null);
  // Полноэкранный просмотр — для скриншота клиенту: только сетка с текущими
  // фильтрами, без копирования, остатка мест и подсказок администратору.
  const [fullscreen, setFullscreen] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [duplicatingWeek, setDuplicatingWeek] = useState(false);
  // На телефоне сетка показывает один день недели (семь колонок по 1200px
  // не помещались): выбранный день — индекс 0..6 от понедельника.
  const isMobile = useIsMobile();
  const [dayIndex, setDayIndex] = useState(() => todayIndex());
  // Текущее время — красная линия в колонке сегодняшнего дня; сдвигается
  // раз в 30 секунд.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Справочники зависят только от студии, занятия — ещё и от недели: листание
  // недель не перезапрашивает тренировки и тренеров. Тренировки пакетных
  // клубов общие (lib/studio-catalog.ts).
  const catalogIds = useCatalogStudioIds();
  const {
    data: workouts = [],
    isFetching: workoutsFetching,
    isPending: workoutsPending,
  } = useQuery({
    queryKey: ["workouts", studioId, WORKOUT_COLS, catalogIds?.join(",")],
    queryFn: () =>
      unwrap<Workout[]>(
        supabase.from("workouts").select(WORKOUT_COLS).in("studio_id", catalogIds!).order("name"),
      ),
    enabled: !!studioId && !!catalogIds,
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
    kindFilter.length !== ACTIVITY_KIND_VALUES.length ||
    showCancelled;

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
      if (e.cancelled_at && !showCancelled) continue;
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
    const hourList = [...busyHours];
    const first = Math.min(FIRST_HOUR, ...hourList);
    const last = Math.max(LAST_HOUR, ...hourList);
    const hours = Array.from({ length: last - first + 1 }, (_, i) => i + first);
    // Полный экран — только часы от первого до последнего занятия.
    const compactHours = hourList.length
      ? hours.filter((h) => h >= Math.min(...hourList) && h <= Math.max(...hourList))
      : hours;
    return { cells, busyHours, perDay, hours, compactHours };
  }, [entries, kindFilter, typeFilter, workoutFilter, filterTrainerId, showCancelled]);

  // Браузерный полноэкранный режим прячет вкладки и адресную строку; выход
  // из него (Esc, жест) закрывает и наш. Без поддержки (iPhone) — просто
  // слой поверх страницы, закрывается крестиком или Esc.
  const openFullscreen = () => {
    setCopySource(null);
    setFullscreen(true);
    // Весь документ, а не слой: окна занятия (портал в body) остаются видны.
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const closeFullscreen = () => {
    setFullscreen(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  useEffect(() => {
    if (!fullscreen) return;
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    // Esc в открытом окне занятия закрывает только окно.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  // Полный экран: неделя целиком помещается в экран — сетка уменьшается
  // (transform: scale, ширина раскладки — 100 / масштаб %, чтобы по ширине
  // заполнять экран) до наибольшего масштаба, при котором влезает по высоте.
  // Масштаб подбирается делением пополам: в уменьшенной сетке колонки шире,
  // названия переносятся реже, высота падает быстрее масштаба. CSS zoom не
  // годится: размеры увеличенного элемента в Chrome меряются неверно.
  const fitBoxRef = useRef<HTMLDivElement>(null);
  const fitGridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = fitBoxRef.current;
    const el = fitGridRef.current;
    if (!box || !el) return;
    const apply = (scale: number) => {
      const scaled = scale < 1;
      el.style.transformOrigin = scaled ? "0 0" : "";
      el.style.transform = scaled ? `scale(${scale})` : "";
      el.style.width = scaled ? `${100 / scale}%` : "";
      box.style.overflow = scaled ? "hidden" : "";
    };
    if (!fullscreen) {
      apply(1);
      return;
    }
    const fits = (scale: number) => {
      apply(scale);
      return el.offsetHeight * scale <= box.clientHeight;
    };
    const fit = () => {
      if (fits(1)) return;
      let lo = 0.3;
      let hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      apply(lo);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box, { box: "border-box" });
    return () => {
      observer.disconnect();
      apply(1);
    };
  }, [fullscreen, grid, dayIndex]);

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
        .select(
          "kind, workout_id, title, starts_at, schedule_entry_trainers(trainer_id, substitution:schedule_entry_substitutions(replaced_trainer_id))",
        )
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
        ).map((e) => entryKey({ ...e, trainerIds: regularTrainerIdsOf(e) })),
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
        // Брони (schedule_bookings) удаляются каскадом: списанное возвращает
        // триггер …_zzzzzzzz_review_fixes.sql, журнал переводит в «Отменено»
        // …_schedule_entry_delete.sql.
        description:
          "Записи клиентов на него будут отменены, списанные тренировки вернутся на абонементы. Если занятие состоялось или переносится, лучше «Отменить» — оно останется в расписании.",
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
            <PeriodStepper
              unit="week"
              label={weekLabel}
              onPrev={() => setWeekStart(addDays(weekStart, -7))}
              onNext={() => setWeekStart(addDays(weekStart, 7))}
              onCurrent={() => {
                setWeekStart(startOfWeek(new Date()));
                setDayIndex(todayIndex());
              }}
              isCurrent={isCurrentWeek}
            >
              {/* Первая загрузка недели — скелетон в сетке, спиннер — только для обновления. */}
              {loading && !entriesPending && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              )}
            </PeriodStepper>

            <div className="toolbar-full flex flex-wrap items-center gap-2 sm:ml-auto">
              <Button
                variant="outline"
                size="icon"
                aria-label="Во весь экран"
                title="Во весь экран — для скриншота клиенту"
                onClick={openFullscreen}
              >
                <Maximize />
              </Button>
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
              {packages ? (
                <ActivityTypesFilter
                  value={kindFilter}
                  onChange={setKindFilter}
                  cancelled={showCancelled}
                  onCancelledChange={setShowCancelled}
                />
              ) : (
                <KindFilter value={kindFilter} onChange={setKindFilter} />
              )}
              <Select value={workoutFilter} onValueChange={setFilterWorkoutId}>
                <SelectTrigger className="w-48 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
                  {/* Пакетные клубы: тренировка — «Направление» (2026-10-13). */}
                  <SelectValue>
                    {packages && workoutFilter === ALL_FILTER_VALUE ? "Направление" : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>
                    {packages ? "Все направления" : "Все тренировки"}
                  </SelectItem>
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
                    <SelectItem key={t.id} value={t.id} textValue={t.full_name}>
                      <StaffOption name={t.full_name} photo={t.photo_url} />
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
                  setShowCancelled(false);
                }}
              />
            </div>
          </TableToolbar>

          {copySource && !fullscreen && (
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
          <div
            className={cn(
              fullscreen
                ? "fixed inset-0 z-50 flex flex-col gap-3 bg-background p-3 sm:p-4"
                : "space-y-3",
            )}
          >
            {fullscreen && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold">
                    {studio?.name
                      ? `Schedule · ${enText(studio.translations, "name", studio.name)}`
                      : "Schedule"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {fmtDate(weekStart, true)} — {fmtDate(addDays(weekStart, 6), true)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Выйти из полноэкранного режима"
                  title="Выйти из полноэкранного режима (Esc)"
                  onClick={closeFullscreen}
                >
                  <Minimize />
                </Button>
              </div>
            )}
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
                      aria-label={d.toLocaleDateString(fullscreen ? "en-GB" : "ru-RU", {
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
                        {(fullscreen ? DAY_NAMES_EN : DAY_NAMES)[i]}
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

            <div
              ref={fitBoxRef}
              className={cn(
                "overflow-auto rounded-lg border bg-background",
                fullscreen ? "min-h-0 flex-1" : "md:max-h-[calc(100dvh-220px)]",
              )}
            >
              <div
                ref={fitGridRef}
                className={cn("grid", !isMobile && !fullscreen && "min-w-[1200px]")}
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
                            {(fullscreen ? DAY_NAMES_EN : DAY_NAMES)[i]}
                          </div>
                          <div>
                            {fullscreen
                              ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                              : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {(fullscreen ? grid.compactHours : grid.hours).map((hour) => {
                  const busy =
                    grid.busyHours.has(hour) ||
                    (entriesPending && SCHEDULE_SKELETON_HOURS.has(hour));
                  // Полный экран: строка с занятиями — по высоте карточек
                  // (undefined — авто), чтобы неделя помещалась в экран.
                  const rowHeight = fullscreen
                    ? busy
                      ? undefined
                      : SLOT_PX_FULLSCREEN_EMPTY
                    : busy
                      ? SLOT_PX_FULL
                      : SLOT_PX_EMPTY;
                  return (
                    <div key={`row-${hour}`} className="contents">
                      <div
                        className="border-b border-r px-2 text-right text-xs text-muted-foreground"
                        style={{
                          height: rowHeight,
                          lineHeight: "1rem",
                          paddingTop: fullscreen && !busy ? 0 : 4,
                        }}
                      >
                        {/* Пустой час в полном экране — полоска без подписи. */}
                        {(!fullscreen || busy) && `${pad(hour)}:00`}
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
                            {!fullscreen && (
                              <button
                                type="button"
                                aria-label={`${copySource ? "Вставить" : "Добавить"} занятие: ${DAY_NAMES[di]}, ${pad(hour)}:00`}
                                onClick={() => openSlot(day, hour)}
                                className={cn(
                                  "absolute inset-0 transition",
                                  packages ? "hover:bg-black/5" : "hover:bg-accent/40",
                                )}
                              />
                            )}
                            {entriesPending && isScheduleSkeletonCell(hour, di, isMobile) && (
                              <EntryCardSkeleton />
                            )}
                            {/* Несколько занятий в одном часе — рядом, а не друг на друге.
                              Обёртка пропускает клики в промежутках к кнопке слота. */}
                            {grid.cells.has(cellKey(day, hour)) && (
                              <div
                                className={cn(
                                  "pointer-events-none flex gap-1",
                                  // Полный экран: карточки в потоке — высота
                                  // ячейки по содержимому, без пустоты снизу.
                                  fullscreen ? "h-full p-1" : "absolute inset-1",
                                )}
                              >
                                {grid.cells.get(cellKey(day, hour))?.map((e) => (
                                  <EntryCard
                                    key={e.id}
                                    entry={e}
                                    packages={packages}
                                    clean={fullscreen}
                                    onOpen={() => openEdit(e)}
                                    onCopy={() => startCopy(e)}
                                  />
                                ))}
                              </div>
                            )}
                            {/* Линия текущего времени — поверх карточек, но
                                клики пропускает (pointer-events-none). Под
                                липкой шапкой дней (z-20), в полном экране —
                                нет: это вид для клиента. */}
                            {!fullscreen &&
                              hour === now.getHours() &&
                              day.toDateString() === now.toDateString() && (
                                <div
                                  aria-hidden
                                  className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 bg-red-500"
                                  style={{ top: `${(now.getMinutes() / 60) * 100}%` }}
                                >
                                  <span className="absolute -left-1 top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-red-500" />
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {!fullscreen && !workoutsPending && workouts.length === 0 && (
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
        packages={packages}
        // Свежая строка из списка: после записи клиентов в окне booked_count
        // у снимка `editing` устаревает (предупреждение в «Отменить тренировку»).
        entry={editing ? (entries.find((x) => x.id === editing.id) ?? editing) : null}
        presetStart={presetStart}
        onSaved={reloadEntries}
        onDelete={handleDelete}
      />

      {confirmDialog}
    </AdminShell>
  );
}

/** Отметить или снять тип в фильтре, сохраняя порядок ACTIVITY_KIND_VALUES. */
function toggleKind(value: ActivityKind[], kind: ActivityKind, checked: boolean): ActivityKind[] {
  return ACTIVITY_KIND_VALUES.filter((k) => (k === kind ? checked : value.includes(k)));
}

/**
 * Фильтр по типам занятий подписочного клуба — галочки прямо в панели
 * фильтров (решение владельца 2026-10-11: на клик меньше, чем выпадающий
 * список). По умолчанию отмечены все; последний отмеченный тип снять нельзя
 * — пустая сетка только путает.
 */
function KindFilter({
  value,
  onChange,
}: {
  value: ActivityKind[];
  onChange: (v: ActivityKind[]) => void;
}) {
  const shown = ACTIVITY_KIND_VALUES.filter((k) => value.includes(k)).length;
  return (
    <div
      role="group"
      aria-label="Какие занятия показывать"
      className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-input px-3 py-1.5 max-sm:w-full"
    >
      {ACTIVITY_KINDS.map((k) => {
        const checked = value.includes(k.value);
        return (
          <CheckboxOption
            key={k.value}
            checked={checked}
            disabled={checked && shown === 1}
            onCheckedChange={(v) => onChange(toggleKind(value, k.value, v))}
            className="whitespace-nowrap"
          >
            {k.plural}
          </CheckboxOption>
        );
      })}
    </div>
  );
}

/**
 * «Типы активностей» пакетного клуба — выпадающий список с галочками
 * (решение владельца 2026-10-13): групповые, персональные, прочие и
 * «Отменённые». По умолчанию отмечено всё, кроме отменённых; последний
 * отмеченный тип снять нельзя.
 */
function ActivityTypesFilter({
  value,
  onChange,
  cancelled,
  onCancelledChange,
}: {
  value: ActivityKind[];
  onChange: (v: ActivityKind[]) => void;
  cancelled: boolean;
  onCancelledChange: (v: boolean) => void;
}) {
  const picked = ACTIVITY_KINDS.filter((k) => value.includes(k.value));
  const all = picked.length === ACTIVITY_KINDS.length;
  const label =
    all && !cancelled
      ? "Типы активностей"
      : [
          ...(all ? ["Все"] : picked.map((k) => k.plural)),
          ...(cancelled ? ["Отменённые"] : []),
        ].join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-field=""
          aria-label={`Типы активностей: ${label}`}
          title={label}
          className={cn(fieldTriggerClass, "w-48 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1")}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="space-y-0.5">
          {ACTIVITY_KINDS.map((k) => {
            const checked = value.includes(k.value);
            return (
              <CheckboxOption
                key={k.value}
                checked={checked}
                disabled={checked && picked.length === 1}
                onCheckedChange={(v) => onChange(toggleKind(value, k.value, v))}
                className="rounded-md px-2 py-1.5 hover:bg-accent"
              >
                {k.plural}
              </CheckboxOption>
            );
          })}
          <div className="my-1 border-t" />
          <CheckboxOption
            checked={cancelled}
            onCheckedChange={onCancelledChange}
            className="rounded-md px-2 py-1.5 hover:bg-accent"
          >
            Отменённые
          </CheckboxOption>
        </div>
      </PopoverContent>
    </Popover>
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
                <ChoiceCard
                  key={k.value}
                  stacked
                  disabled={disabled}
                  onClick={() => onPick(k.value)}
                  media={
                    <span
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl sm:size-12"
                      style={{ backgroundColor: `${k.color}1f`, color: k.color }}
                    >
                      <k.icon className="size-6" />
                    </span>
                  }
                  title={k.label}
                  description={
                    disabled ? "Сначала создайте тренировки в разделе «Тренировки»" : k.description
                  }
                />
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
      <span className={`rounded px-1 py-px text-[10px] font-semibold tabular-nums ${tone}`}>
        {entry.booked_count}/{cap}
      </span>
      {waiting > 0 && (
        <span
          title="Люди в листе ожидания — записались, когда мест уже не было"
          className="rounded bg-blue-500/90 px-1 py-px text-[10px] font-semibold tabular-nums text-white"
        >
          +{waiting}
        </span>
      )}
    </span>
  );
}

/**
 * Сколько новеньких — только цифра, в цветах бейджа ПЧК, справа от названия
 * (решение владельца 2026-10-13).
 */
/**
 * Красный «!» слева от счётчика записей: занятие закончилось, а у записанных
 * не отмечено «Посетил» / «Не посетил» (решение владельца 2026-10-13).
 */
function UnmarkedBadge({ entry }: { entry: Entry }) {
  if (entry.cancelled_at || new Date(entry.ends_at).getTime() > Date.now()) return null;
  const n = (entry.participants ?? []).filter((p) => p.status === "booked").length;
  if (!n) return null;
  return (
    <span
      title={`Не отмечены посещения: ${n}. Откройте занятие и отметьте «Посетил» или «Не посетил».`}
      aria-label="Не отмечены посещения"
      className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white"
    >
      !
    </span>
  );
}

function NewcomersBadge({ entry }: { entry: Entry }) {
  const n = newcomerIds(entry).size;
  if (!n) return null;
  return (
    <span
      title={`Новеньких: ${n} — до занятия не было абонементов, кроме пробного`}
      className="shrink-0 rounded border border-blue-200 bg-blue-100 px-1 text-[10px] font-semibold leading-4 tabular-nums text-blue-700"
    >
      {n}
    </span>
  );
}

function EntryCard({
  entry,
  packages,
  clean,
  onOpen,
  onCopy,
}: {
  entry: Entry;
  /** Пакетная студия: светлая карточка с полоской цвета тренировки. */
  packages: boolean;
  /** Полноэкранный просмотр для клиента: без «Копировать» и остатка мест. */
  clean?: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  const trainers = (entry.schedule_entry_trainers ?? []).flatMap((x) =>
    x.trainer ? [x.trainer] : [],
  );
  // Полный экран (скриншот клиентам) — имена тренеров на английском.
  const names = trainers
    .map((t) => (clean ? enText(t.translations, "full_name", t.full_name) : t.full_name))
    .join(", ");
  // Персональное: «тренер + клиент» — видно, с кем занятие. В полном экране
  // имён клиентов нет: скриншот уходит другим клиентам.
  const clients = entry.kind === "personal" && !clean ? participantNames(entry) : "";
  const people = [names, clients].filter(Boolean).join(" + ");
  // Персональные и прочие в обоих форматах — светлая карточка с тёмной
  // полоской: так они не путаются с групповыми.
  const group = entry.kind === "group";
  // Отменённое — белое в наклонную серую полоску, перед временем красный знак.
  const cancelled = !!entry.cancelled_at;
  if (packages || !group || cancelled) {
    return (
      <div
        className={cn(
          "pointer-events-auto relative h-full min-w-0 flex-1 overflow-hidden rounded-md border border-l-4 bg-background leading-tight text-foreground shadow-xs",
          clean ? "text-[13px]" : "text-[11px]",
          cancelled && "schedule-cancelled",
        )}
        title={
          cancelled && !clean
            ? `Отменено: ${entry.cancel_reason ?? "причина не указана"}`
            : undefined
        }
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
          className="flex h-full w-full cursor-pointer flex-col px-1.5 pt-0.5 pb-px text-left hover:bg-accent/40"
        >
          <span className="flex w-full items-start justify-between gap-1">
            <span className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
              {cancelled && (
                <Ban
                  className="size-3 shrink-0 text-rose-600"
                  aria-label={clean ? "Cancelled" : "Отменено"}
                />
              )}
              {fmtTime(entry.starts_at)}–{fmtTime(entry.ends_at)}
            </span>
            {!cancelled && !clean && (
              <span className="flex items-center gap-1">
                <UnmarkedBadge entry={entry} />
                <CapacityBadge entry={entry} light />
              </span>
            )}
          </span>
          <span className="flex w-full items-start gap-1">
            <span
              className={cn(
                "min-w-0 flex-1 font-semibold leading-[1.15]",
                clean ? "text-base" : "text-[13px]",
                // Персональному название в одну строку — место под клиента.
                clients ? "truncate" : "line-clamp-2",
              )}
            >
              {entryTitle(entry, clean)}
            </span>
            {!cancelled && !clean && <NewcomersBadge entry={entry} />}
          </span>
          {/* Фото тренеров на карточке нет (решение владельца 2026-10-11) —
              только имена: карточка ниже. У персонального «тренер + клиент» —
              до двух строк, имя клиента не режем. pr-5 — место под «Копировать». */}
          {people && (
            <span
              className={cn(
                "min-w-0 pr-5 text-muted-foreground",
                clients ? "line-clamp-2 break-words" : "truncate",
              )}
            >
              {people}
            </span>
          )}
        </button>
        {!clean && (
          <button
            type="button"
            aria-label="Копировать занятие"
            title="Копировать занятие"
            onClick={onCopy}
            className="absolute bottom-1 right-1.5 rounded-full bg-muted p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }
  const color = dayTypeColor(entry.workout?.type);
  const colorClasses = color ? `${color.bg} ${color.text}` : "bg-primary text-primary-foreground";
  return (
    <div
      className={cn(
        "pointer-events-auto relative h-full min-w-0 flex-1 overflow-hidden rounded-md leading-tight",
        clean ? "text-[13px]" : "text-[11px]",
        colorClasses,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full cursor-pointer flex-col px-2 pt-0.5 pb-px text-left hover:opacity-90"
      >
        <span className="flex w-full items-start justify-between gap-1">
          <span className="whitespace-nowrap opacity-80">
            {fmtTime(entry.starts_at)}–{fmtTime(entry.ends_at)}
          </span>
          {!clean && (
            <span className="flex items-center gap-1">
              <UnmarkedBadge entry={entry} />
              <CapacityBadge entry={entry} />
            </span>
          )}
        </span>
        <span className="flex w-full items-start gap-1">
          <span
            className={cn(
              "min-w-0 flex-1 font-semibold leading-[1.15] line-clamp-2",
              clean ? "text-base" : "text-[13px]",
            )}
          >
            {entryTitle(entry, clean)}
          </span>
          {!clean && <NewcomersBadge entry={entry} />}
        </span>
        {/* pr-5 — место под «Копировать» в углу. */}
        {names && <span className="block truncate pr-5 opacity-80">{names}</span>}
      </button>
      {/* Соседняя кнопка поверх карточки, а не вложенная в неё — там же, где была. */}
      {!clean && (
        <button
          type="button"
          aria-label="Копировать занятие"
          title="Копировать занятие"
          onClick={onCopy}
          className="absolute bottom-1 right-2 rounded-full bg-black/25 p-0.5 text-white hover:bg-black/40"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
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
  /** Пакетная студия: отмена занятия и «Не посетил» у записанных. */
  packages: boolean;
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
    "От него считается срок, до которого клиент может отменить запись сам (см. «Приложение» → «Контакты и правила»).",
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

/** Галочки сотрудников; с byRole — тренеры, массажисты и администраторы отдельными группами. */
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
  // Неизвестная роль — к тренерам, старший администратор — к администраторам.
  const groups = ROLE_GROUPS.map((g) => ({
    ...g,
    list: options.filter((t) => roleGroup(t.role) === g.role),
  })).filter((g) => g.list.length > 0);
  if (!byRole || groups.length < 2) {
    return <div className="rounded-md border p-3">{checks(options)}</div>;
  }
  return (
    <div className="space-y-3 rounded-md border p-3">
      {groups.map((g) => (
        <div key={g.role} className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{g.label}</div>
          {checks(g.list)}
        </div>
      ))}
    </div>
  );
}

type TrainerOption = { id: string; full_name: string; photo_url?: string | null };

/**
 * Тренеры заведённой групповой тренировки (пакетные клубы): у каждого —
 * «Замена» (тренер заболел: клиенты увидят в приложении пометку «Замена» и
 * прежнего тренера неактивным) и «Редактировать» (ошиблись при заведении —
 * просто другой тренер, без следа в приложении). Замену можно отменить.
 */
function TrainerAssignments({
  options,
  value,
  subs,
  onChange,
}: {
  options: TrainerOption[];
  value: string[];
  subs: SubsMap;
  onChange: (ids: string[], subs: SubsMap) => void;
}) {
  // Строка в правке: индекс в value (value.length — новый тренер) и режим.
  const [editing, setEditing] = useState<{ index: number; mode: PickMode } | null>(null);
  const byId = new Map(options.map((t) => [t.id, t]));
  const nameOf = (id: string) => byId.get(id)?.full_name ?? "Тренер";

  const apply = (next: TrainerAssignment) => onChange(next.ids, next.subs);
  const state = { ids: value, subs };
  const pick = (id: string) => {
    if (!editing) return;
    setEditing(null);
    apply(pickTrainer(state, editing.index, id, editing.mode, nameOf));
  };
  const undoSub = (index: number) => apply(undoSubstitution(state, index));
  const remove = (index: number) => apply(removeTrainer(state, index));

  const picker = (index: number, mode: PickMode) => {
    const current = mode === "add" ? undefined : value[index];
    const free = options.filter((t) => t.id === current || !value.includes(t.id));
    return (
      <div className="space-y-2">
        {mode === "replace" && (
          <InfoNote variant="warning">
            Замена будет видна клиентам в мобильном приложении: у тренировки появится пометка
            «Замена», в окне тренировки — прежний тренер неактивным и новый тренер.
          </InfoNote>
        )}
        <div className="flex items-center gap-2">
          <Select onValueChange={pick}>
            <SelectTrigger className="flex-1">
              <SelectValue
                placeholder={
                  mode === "replace"
                    ? `Кто заменит: ${nameOf(value[index])}`
                    : mode === "add"
                      ? "Выберите тренера"
                      : "Другой тренер"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {free
                .filter((t) => t.id !== current)
                .map((t) => (
                  <SelectItem key={t.id} value={t.id} textValue={t.full_name}>
                    <StaffOption name={t.full_name} photo={t.photo_url ?? null} />
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
            Отмена
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-md border">
        {value.map((id, index) => {
          const t = byId.get(id);
          const sub = subs[id];
          return (
            <li key={id} className="space-y-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <StaffOption name={t?.full_name ?? "Тренер"} photo={t?.photo_url ?? null} />
                  {sub && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700">
                      <Repeat className="size-3.5 shrink-0" />
                      Замена · вместо {sub.name ?? nameOf(sub.id)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {sub ? (
                    <Button variant="default" size="xs" onClick={() => undoSub(index)}>
                      <Undo2 />
                      Отменить замену
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="xs"
                      onClick={() => setEditing({ index, mode: "replace" })}
                    >
                      <Repeat />
                      Замена
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="xs"
                    onClick={() => setEditing({ index, mode: "edit" })}
                  >
                    <Pencil />
                    Редактировать
                  </Button>
                  {value.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Убрать с занятия"
                      title="Убрать с занятия"
                      onClick={() => remove(index)}
                    >
                      <X />
                    </Button>
                  )}
                </div>
              </div>
              {editing?.index === index && editing.mode !== "add" && picker(index, editing.mode)}
            </li>
          );
        })}
      </ul>
      {editing?.mode === "add"
        ? picker(value.length, "add")
        : options.some((t) => !value.includes(t.id)) && (
            <Button
              variant="link"
              size="inline"
              onClick={() => setEditing({ index: value.length, mode: "add" })}
            >
              <Plus />
              Добавить тренера
            </Button>
          )}
    </div>
  );
}

const ROLE_GROUPS = [
  { role: "trainer", label: "Тренеры" },
  { role: "masseur", label: "Массажисты" },
  { role: "admin", label: "Администраторы" },
] as const;

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
  packages,
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
  // Замены: тренер занятия → кого он заменяет (пакетные клубы, групповое).
  const [subs, setSubs] = useState<SubsMap>(() => substitutionsOf(entry?.schedule_entry_trainers));
  // У заведённой групповой тренировки с тренерами — не галочки, а список
  // тренеров с «Замена» / «Редактировать» (решение владельца 2026-10-13).
  const assignMode = packages && !!entry && kind === "group" && trainerIdsOf(entry).length > 0;
  // Клиенты нового занятия: записываются после его создания. У созданного —
  // панель записей, там запись сразу.
  const [pending, setPending] = useState<PickedClient[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const busy = saving || deleting || restoring;
  const cancelled = !!entry?.cancelled_at;

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

  /**
   * Правка занятия: строка, тренеры (только разница — снятый тренер уносит
   * свою замену, оставшиеся её сохраняют) и замены. Возвращает текст ошибки.
   */
  const updateEntry = async (id: string, row: Record<string, string | number | null>) => {
    const { error } = await supabase.from("schedule_entries").update(row).eq("id", id);
    if (error) return "Ошибка сохранения: " + error.message;
    const { removed, added, dropSubs, putSubs } = trainerChanges(
      {
        ids: entry ? trainerIdsOf(entry) : [],
        subs: substitutionsOf(entry?.schedule_entry_trainers),
      },
      { ids: trainerIds, subs },
    );
    if (removed.length > 0) {
      const { error: delErr } = await supabase
        .from("schedule_entry_trainers")
        .delete()
        .eq("entry_id", id)
        .in("trainer_id", removed);
      if (delErr) return "Ошибка обновления тренеров: " + delErr.message;
    }
    const linkErr = await linkTrainers(added.map((trainer_id) => ({ entry_id: id, trainer_id })));
    if (linkErr) return "Ошибка добавления тренеров: " + linkErr;

    if (dropSubs.length > 0) {
      const { error: subErr } = await supabase
        .from("schedule_entry_substitutions")
        .delete()
        .eq("entry_id", id)
        .in("trainer_id", dropSubs);
      if (subErr) return "Ошибка обновления замены: " + subErr.message;
    }
    if (putSubs.length > 0) {
      const { error: subErr } = await supabase
        .from("schedule_entry_substitutions")
        .upsert(putSubs.map((row) => ({ entry_id: id, ...row })));
      if (subErr) return "Ошибка сохранения замены: " + subErr.message;
    }
    return null;
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
      if (entry && kind === "personal" && !cancelled) {
        // Персональное без клиента не сохраняем: клиент записан в панели ниже.
        // У отменённого записей уже нет — его можно править и так.
        const { count, error: countError } = await supabase
          .from("schedule_bookings")
          .select("id", { count: "exact", head: true })
          .eq("entry_id", entry.id)
          .in("status", ["booked", "attended"]);
        if (countError) {
          toast.error("Не удалось проверить запись клиента: " + countError.message);
          return;
        }
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

  // Отменили по ошибке — занятие снова в расписании; снятые записи не
  // возвращаются (клиентам записываться заново).
  const handleRestore = async () => {
    if (!entry) return;
    setRestoring(true);
    try {
      const ok = await entryRpc(
        "restore_schedule_entry",
        { p_entry_id: entry.id },
        "Не удалось вернуть занятие",
      );
      if (!ok) return;
      toast.success("Занятие снова в расписании");
      onOpenChange(false);
      onSaved();
    } finally {
      setRestoring(false);
    }
  };

  const KindIcon = activityKind(kind).icon;
  const cancelLabel = kind === "group" ? "Отменить тренировку" : "Отменить занятие";

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
            {entry && cancelled && (
              <InfoNote variant="warning" className="flex flex-wrap items-center gap-3">
                <span className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                  <Ban className="mt-0.5 size-4 shrink-0 text-rose-600" />
                  <span>
                    <span className="font-medium">
                      Отменено {entry.cancelled_at && formatDate(entry.cancelled_at)}
                    </span>
                    {entry.cancel_reason && <> — {entry.cancel_reason}</>}. Клиенты его не видят и
                    записаться не могут.
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={handleRestore} disabled={busy}>
                  {restoring ? <Loader2 className="animate-spin" /> : <Undo2 />}
                  Вернуть в расписание
                </Button>
              </InfoNote>
            )}

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
                        <SelectItem key={t.id} value={t.id} textValue={t.full_name}>
                          <StaffOption name={t.full_name} photo={t.photo_url} />
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

            {assignMode && (
              <FormField label="Тренеры" tip={TIPS.groupTrainers} htmlFor={null}>
                <TrainerAssignments
                  options={trainerOptions}
                  value={trainerIds}
                  subs={subs}
                  onChange={(ids, nextSubs) => {
                    setTrainerIds(ids);
                    setSubs(nextSubs);
                  }}
                />
              </FormField>
            )}

            {kind !== "personal" && !assignMode && (
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

            {entry && kind !== "other" && !cancelled && (
              <BookingsPanel
                entry={entry}
                trial={kind === "group"}
                packages={packages}
                onChanged={onSaved}
              />
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          {entry && (
            // Удалить — занятие добавили по ошибке; отменить — оно было, но не
            // состоится (остаётся в расписании с причиной).
            <div className="mr-auto flex flex-wrap gap-1">
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDelete}
                disabled={busy}
              >
                <Trash2 />
                Удалить
              </Button>
              {packages && !cancelled && (
                <Button
                  variant="ghost"
                  className="text-rose-700 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => setCancelOpen(true)}
                  disabled={busy}
                >
                  <Ban />
                  {cancelLabel}
                </Button>
              )}
            </div>
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
      {entry && packages && (
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent className="max-w-md">
            <CancelEntryForm
              entry={entry}
              title={cancelLabel}
              onClose={() => setCancelOpen(false)}
              onDone={() => {
                setCancelOpen(false);
                onOpenChange(false);
                onSaved();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const ENTRY_RPC_REASONS: Record<string, string> = {
  already_cancelled: "уже отменено",
  not_cancelled: "занятие не отменено",
  reason_required: "укажите причину",
  forbidden: "нет прав в этом клубе",
  not_found: "занятие не найдено",
};

/** RPC отмены и возврата занятия: { ok, reason }; тост об ошибке — здесь. */
async function entryRpc(
  fn: "cancel_schedule_entry" | "restore_schedule_entry",
  args: Record<string, string>,
  failed: string,
) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    toast.error(`${failed}: ${error.message}`);
    return null;
  }
  const result = data as { ok?: boolean; reason?: string; cancelled_bookings?: number } | null;
  if (!result?.ok) {
    const reason = result?.reason ?? "";
    toast.error(`${failed}: ${ENTRY_RPC_REASONS[reason] ?? (reason || "неизвестно")}`);
    return null;
  }
  return result;
}

/**
 * Отмена занятия с причиной (пакетные студии): записанные снимаются, списанные
 * тренировки возвращаются на абонементы, в сетке занятие остаётся
 * заштрихованным (db/migrations/2026-10-11_zzzzzzz_entry_cancel_no_show.sql).
 */
function CancelEntryForm({
  entry,
  title,
  onClose,
  onDone,
}: {
  entry: Entry;
  title: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState(ENTRY_CANCEL_REASONS[0]);
  const [other, setOther] = useState("");
  const [saving, setSaving] = useState(false);
  const booked = entry.booked_count + (entry.waitlist_count ?? 0);

  const handleSubmit = async () => {
    const text = reason === OTHER_REASON ? other.trim() : reason;
    if (!text) {
      toast.error("Напишите причину отмены");
      return;
    }
    setSaving(true);
    try {
      const result = await entryRpc(
        "cancel_schedule_entry",
        { p_entry_id: entry.id, p_reason: text },
        "Не удалось отменить",
      );
      if (!result) return;
      const n = result.cancelled_bookings ?? 0;
      toast.success(n > 0 ? `Отменено, снято записей: ${n}` : "Отменено");
      // Списанные тренировки вернулись — баланс в «Абонементах» изменился.
      queryClient.invalidateQueries({ queryKey: ["schedule_bookings"] });
      queryClient.invalidateQueries({ queryKey: ["client_packages_list"] });
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}?</DialogTitle>
        <DialogDescription>
          {booked > 0
            ? `Записанные клиенты (${booked}) будут сняты, списанные тренировки вернутся на абонементы. `
            : ""}
          Занятие останется в расписании отменённым — клиенты его не увидят и не смогут записаться.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSubmit}>
        <DialogBody>
          <FormField label="Причина отмены" required htmlFor={null}>
            <RadioGroup value={reason} onValueChange={setReason} className="space-y-1">
              {[...ENTRY_CANCEL_REASONS, OTHER_REASON].map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm"
                >
                  <RadioGroupItem value={r} />
                  {r === OTHER_REASON ? "Другое" : r}
                </label>
              ))}
            </RadioGroup>
            {reason === OTHER_REASON && (
              <Input
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="Что случилось"
                aria-label="Своя причина отмены"
                autoFocus
              />
            )}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Не отменять
          </Button>
          <Button type="submit" variant="destructive" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Ban />}
            {title}
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
  /** «Не посетил»: true — уважительная (не списано), false — неуважительная (списано). */
  no_show_excused: boolean | null;
  no_show_comment: string | null;
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
  /** Статус клуба (ЧК / БЧК / ПЧК) — из вью clients_with_status, как в «Клиентах». */
  club_status: ClubStatus | null;
};

type ActiveMembershipRow = {
  client_id: string;
  /** active — текущий; pending — продление ждёт (только для расчёта остатка). */
  status: "active" | "pending";
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
  /**
   * Пакетная студия — хватает ли абонемента на это занятие (id записи →
   * остаток): balance — тренировок на балансе сейчас (с ждущим продлением),
   * ahead — сколько записей клиента на такие же занятия раньше этого ещё не
   * отмечены. Записаться можно и сверх остатка (решение владельца
   * 2026-10-13), а «Посетил» без остатка база не даст — сначала продажа.
   */
  coverage: Map<string, Coverage>;
};

function bookingClient(data: BookingsData | undefined, b: BookingRow) {
  return (
    (b.client_id ? data?.clientsById.get(b.client_id) : undefined) ??
    (b.user_id ? data?.clientsByUser.get(b.user_id) : undefined)
  );
}

/** Записи на занятие + карточки клиентов + их активные абонементы. */
async function fetchBookings(entry: Entry, packages: boolean): Promise<BookingsData> {
  const bookings = await unwrap<BookingRow[]>(
    supabase
      .from("schedule_bookings")
      .select("id, user_id, client_id, status, created_at, no_show_excused, no_show_comment")
      .eq("entry_id", entry.id)
      // no_show — «Отметить пропущенные» в «Истории записей»: у прошедшего
      // занятия посещение можно зафиксировать и после этого.
      .in("status", ["booked", "attended", "no_show", "waitlist"])
      .order("created_at"),
  );
  const clientsById = new Map<string, ClientRow>();
  const clientsByUser = new Map<string, ClientRow>();
  const membershipsByClient = new Map<string, ActiveMembershipRow[]>();
  const coverage = new Map<string, Coverage>();
  const empty = { bookings, clientsById, clientsByUser, membershipsByClient, coverage };
  const clientIds = Array.from(new Set(bookings.map((r) => r.client_id).filter(Boolean)));
  // Старые записи из приложения без карточки — по учётной записи.
  const userIds = Array.from(
    new Set(bookings.filter((r) => !r.client_id).map((r) => r.user_id)),
  ).filter((v): v is string => !!v);
  if (clientIds.length === 0 && userIds.length === 0) return empty;

  // Карточки и абонементы — дополнение: если они не загрузились, записи всё
  // равно показываем (с «Пользователь без анкеты»), а не ошибку на всю панель.
  const cols = "id, user_id, first_name, last_name, full_name, phone, email, crm_link, club_status";
  const [byId, byUser] = await Promise.all([
    clientIds.length
      ? supabase.from("clients_with_status").select(cols).in("id", clientIds)
      : Promise.resolve({ data: [] as ClientRow[] }),
    userIds.length
      ? supabase
          .from("clients_with_status")
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

  const ids = clients.map((c) => c.id);
  const balanceCheck = packages && (entry.kind === "group" || entry.kind === "personal");
  const [{ data: mData }, { data: aheadData }] = await Promise.all([
    supabase
      .from("client_memberships")
      .select(
        "client_id, status, started_at, ends_at, visits_left, personal_left, balance_kind, membership:memberships(name)",
      )
      // Ждущее продление — только в остаток: с него спишется, когда кончится текущий.
      .in("status", balanceCheck ? ["active", "pending"] : ["active"])
      .in("client_id", ids),
    // Записи клиентов на такие же занятия раньше этого, ещё без отметки:
    // остаток уйдёт на них.
    balanceCheck
      ? supabase
          .from("schedule_bookings")
          .select("client_id, entry:schedule_entries!inner(starts_at)")
          .in("client_id", ids)
          .eq("status", "booked")
          .neq("entry_id", entry.id)
          .eq("entry.kind", entry.kind)
          .is("entry.cancelled_at", null)
          .lt("entry.starts_at", entry.starts_at)
      : Promise.resolve({ data: [] as { client_id: string }[] }),
  ]);
  // membership — связь «многие к одному», но разбор select без схемы базы
  // считает любую связь массивом.
  const all = (mData ?? []) as unknown as ActiveMembershipRow[];
  const allByClient = new Map<string, ActiveMembershipRow[]>();
  for (const m of all) {
    allByClient.set(m.client_id, [...(allByClient.get(m.client_id) ?? []), m]);
    if (m.status === "active")
      membershipsByClient.set(m.client_id, [...(membershipsByClient.get(m.client_id) ?? []), m]);
  }
  if (balanceCheck) {
    const aheadByClient = new Map<string, number>();
    for (const r of (aheadData ?? []) as { client_id: string }[])
      aheadByClient.set(r.client_id, (aheadByClient.get(r.client_id) ?? 0) + 1);
    const date = tbilisiDate(entry.starts_at);
    const personal = entry.kind === "personal";
    for (const b of bookings) {
      const c =
        (b.client_id ? clientsById.get(b.client_id) : undefined) ??
        (b.user_id ? clientsByUser.get(b.user_id) : undefined);
      if (!c) continue;
      coverage.set(b.id, {
        balance: balanceFor(allByClient.get(c.id) ?? [], personal, date),
        ahead: aheadByClient.get(c.id) ?? 0,
      });
    }
  }
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
          variant="default"
          size="sm"
          onClick={() => setPickOpen(true)}
          disabled={disabled || !studioId}
        >
          <UserPlus />
          Записать клиента
        </Button>
        {trial && (
          <Button
            variant="default"
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
/** Коды отказа RPC записи (db/migrations, booking_waitlist.sql) — по-русски, а не как есть. */
const BOOKING_RPC_REASONS: Record<string, string> = {
  not_found: "запись не найдена",
  wrong_status: "у записи уже другой статус — обновите окно",
  already_cancelled: "запись уже отменена",
  not_booked: "клиент не записан",
  excuse_required: "укажите, уважительная ли причина",
  comment_required: "напишите причину",
  forbidden: "нет прав в этом клубе",
  unauthorized: "нет прав",
  past: "занятие уже прошло",
};

async function bookingRpc(
  fn:
    | "mark_booking_attended"
    | "unmark_booking_attended"
    | "cancel_schedule_booking_admin"
    | "mark_booking_no_show",
  args: Record<string, string | boolean | null>,
  messages: { error: string; failed: string },
) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    toast.error(`${messages.error}: ${error.message}`);
    return false;
  }
  const result = data as { ok?: boolean; reason?: string } | null;
  if (!result?.ok) {
    const reason = result?.reason ?? "";
    toast.error(`${messages.failed}: ${BOOKING_RPC_REASONS[reason] ?? (reason || "неизвестно")}`);
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

/** Отметка «Не посетил» у записи: с причиной — уважительная или нет. */
function NoShowBadge({ booking }: { booking: BookingRow }) {
  if (booking.no_show_excused === true)
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        Не посетил · уважительная
      </span>
    );
  if (booking.no_show_excused === false)
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
        Не посетил · списано
      </span>
    );
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
      Пропущено
    </span>
  );
}

/** Абонемент клиента одной строкой: «Пакет 8 · осталось 3 · до 12.11.2026». */
function membershipSummary(m: ActiveMembershipRow, personal: boolean) {
  const left = personal
    ? `персональных ${m.personal_left}`
    : m.visits_left != null
      ? `осталось ${m.visits_left}`
      : "безлимит";
  // Пакетная продажа ждёт первого посещения — срок ещё не идёт.
  const term = m.ends_at
    ? `до ${formatDate(m.ends_at)}`
    : !m.started_at
      ? "срок — с 1-го посещения"
      : null;
  return [m.membership?.name ?? "Абонемент", left, term].filter(Boolean).join(" · ");
}

function BookingsPanel({
  entry,
  trial,
  packages,
  onChanged,
}: {
  entry: Entry;
  /** Групповое: можно записать на пробное посещение нового клиента. */
  trial: boolean;
  /** Пакетная студия: «Не посетил» с причиной вместо «Отклонить». */
  packages: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  // Пакетная студия: на персональном занятии посещение списывается с баланса
  // персональных — его и показываем у клиента.
  const personalBalance = packages && entry.kind === "personal";
  const [booking, setBooking] = useState(false);
  const [attendingId, setAttendingId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<BookingRow | null>(null);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [noShowTarget, setNoShowTarget] = useState<BookingRow | null>(null);

  const queryKey = ["schedule_bookings", entry.id];
  const { data, isLoading: loading } = useQuery({
    queryKey,
    queryFn: () => fetchBookings(entry, packages),
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

  const askNoShow = (b: BookingRow) => {
    setNoShowTarget(b);
    setNoShowOpen(true);
  };

  const { confirm, confirmDialog } = useConfirm();

  const handleAttend = async (b: BookingRow) => {
    // До начала больше часа — скорее всего, промахнулись по строке или дню
    // (решение владельца 2026-10-13: спрашивать).
    if (new Date(entry.starts_at).getTime() - Date.now() > 60 * 60 * 1000) {
      const ok = await confirm({
        title: "Отметить посещение заранее?",
        description:
          "До начала тренировки ещё больше часа. Точно отметить посещение сейчас? Тренировка спишется с абонемента клиента.",
        confirmLabel: "Отметить",
        destructive: false,
      });
      if (!ok) return;
    }
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

  // Отметка по ошибке: запись снова «Записан», тренировка возвращается на
  // баланс (триггер списания в БД). В любой момент, и у прошедших занятий.
  const handleUnattend = async (b: BookingRow) => {
    setAttendingId(b.id);
    try {
      const ok = await bookingRpc(
        "unmark_booking_attended",
        { p_booking_id: b.id },
        { error: "Ошибка", failed: "Не удалось отменить посещение" },
      );
      if (!ok) return;
      toast.success("Посещение отменено, тренировка возвращена на баланс");
      reload();
    } finally {
      setAttendingId(null);
    }
  };

  // Лист ожидания держим отдельно от записанных: он не занимает мест и не
  // должен путаться со счётчиком заполненности.
  const booked = bookings.filter((b) => b.status !== "waitlist");
  // Те же «новенькие», что в цифре на карточке занятия.
  const newcomers = newcomerIds(entry);
  const waitlisted = bookings.filter((b) => b.status === "waitlist");
  const capacity = entryCapacity(entry);

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">
            Записанные клиенты{" "}
            <span className="tabular-nums normal-case">
              · {booked.length}
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
        </div>

        {loading ? (
          <div className="divide-y rounded-md border">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-1.5 px-3 py-2">
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
          // Строка клиента — компактно (решение владельца 2026-10-11: в окне
          // занятия приходилось долго листать): имя и отметка, ниже одной
          // строкой телефон и абонемент; кнопки справа.
          <ul className="divide-y rounded-md border">
            {booked.map((b) => {
              const c = bookingClient(data, b);
              const m = c
                ? pickMembership(data?.membershipsByClient.get(c.id), personalBalance)
                : undefined;
              const busy = attendingId === b.id;
              // Пакетная студия: посещение без остатка база не отметит —
              // сначала продажа; если остаток уйдёт на более ранние записи —
              // предупреждаем заранее.
              const { noBalance, uncovered } = attendanceBlock(b, data?.coverage.get(b.id));
              return (
                <li key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <BookingClientName client={c} />
                      {c?.club_status && <ClubStatusBadge status={c.club_status} />}
                      {c && newcomers.has(c.id) && (
                        <span
                          title="До занятия не было абонементов, кроме пробного"
                          className="rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                        >
                          Новенький
                        </span>
                      )}
                      {b.status === "attended" && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Посетил
                        </span>
                      )}
                      {b.status === "no_show" && <NoShowBadge booking={b} />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        c?.phone,
                        m ? membershipSummary(m, personalBalance) : "Нет активного абонемента",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {uncovered && (
                      <div className="text-xs font-medium text-rose-600">
                        {noBalance
                          ? "Нет абонемента — чтобы отметить посещение, сначала оформите продажу"
                          : "На это занятие абонемента не хватит: остаток уйдёт на более ранние записи"}
                      </div>
                    )}
                    {b.status === "no_show" && b.no_show_comment && (
                      <div
                        className={cn(
                          noteChipClass,
                          "mt-1 inline-block max-w-full px-1.5 py-0.5 text-xs",
                        )}
                      >
                        {b.no_show_comment}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {(b.status === "booked" || b.status === "no_show") && (
                      <Button
                        // Пакетные: отметки — белые, тёмные — действия окна
                        // («Записать клиента», замена тренера; 2026-10-13).
                        variant={packages ? "outline" : "default"}
                        size={packages ? "xs" : "sm"}
                        onClick={() => handleAttend(b)}
                        // «Не посетил» по неуважительной уже списан — его
                        // можно перевести в «Посетил» и без остатка
                        // (attendanceBlock такую запись не блокирует).
                        disabled={busy || noBalance}
                        title={
                          noBalance
                            ? "Нет абонемента с остатком — сначала оформите продажу"
                            : undefined
                        }
                      >
                        {busy && <Loader2 className="animate-spin" />}
                        Посетил
                      </Button>
                    )}
                    {packages && b.status === "booked" && (
                      <Button variant="outline" size="xs" onClick={() => askNoShow(b)}>
                        Не посетил
                      </Button>
                    )}
                    {packages && b.status === "no_show" && (
                      <Button
                        variant="outline"
                        size="xs"
                        title="Изменить причину или комментарий"
                        onClick={() => askNoShow(b)}
                      >
                        Причина
                      </Button>
                    )}
                    {!packages && b.status === "booked" && (
                      <Button variant="outline" size="sm" onClick={() => askCancel(b)}>
                        Отклонить
                      </Button>
                    )}
                    {b.status === "attended" && (
                      <Button
                        variant="outline"
                        size={packages ? "xs" : "sm"}
                        title="Отметили по ошибке? Тренировка вернётся на баланс клиента"
                        onClick={() => handleUnattend(b)}
                        disabled={busy}
                      >
                        {busy && <Loader2 className="animate-spin" />}
                        Отменить посещение
                      </Button>
                    )}
                    {/* Пакетные: отписать (записали по ошибке, клиент отменил
                        заранее) — тихой кнопкой, главная — «Не посетил». */}
                    {packages && b.status === "booked" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Отписать клиента"
                        title="Отписать клиента"
                        onClick={() => askCancel(b)}
                      >
                        <X />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
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
          <ul className="divide-y divide-blue-200 rounded-md border border-blue-200 bg-blue-50/60">
            {waitlisted.map((b) => {
              const c = bookingClient(data, b);
              return (
                <li key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <BookingClientName client={c} />
                    <div className="truncate text-xs text-muted-foreground">
                      {c?.phone ?? c?.email ?? "—"}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => askCancel(b)}>
                    Убрать
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        {/* Окно открыто из формы занятия; всплытие submit в неё гасит DialogForm. */}
        <DialogContent className="max-w-md">
          {cancelTarget && (
            <CancelBookingForm
              key={cancelTarget.id}
              booking={cancelTarget}
              packages={packages}
              onClose={() => setCancelOpen(false)}
              onDone={reload}
            />
          )}
        </DialogContent>
      </Dialog>

      {confirmDialog}

      <Dialog open={noShowOpen} onOpenChange={setNoShowOpen}>
        <DialogContent className="max-w-md">
          {noShowTarget && (
            <NoShowForm
              key={noShowTarget.id}
              booking={noShowTarget}
              clientName={(() => {
                const c = bookingClient(data, noShowTarget);
                return c ? clientName(c) : null;
              })()}
              onClose={() => setNoShowOpen(false)}
              onDone={reload}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Причины «Не посетил»: уважительная — тренировка остаётся, нет — списывается. */
const NO_SHOW_OPTIONS = [
  {
    value: "excused",
    title: "Уважительная причина",
    description:
      "Клиент отписался больше чем за 3 часа до начала или у него форс-мажор. Тренировка останется на абонементе.",
  },
  {
    value: "unexcused",
    title: "Неуважительная причина",
    description:
      "Не пришёл без предупреждения или отписался меньше чем за 3 часа. Тренировка спишется с абонемента.",
  },
] as const;

/**
 * «Не посетил» (пакетные студии): причина и короткий комментарий —
 * RPC mark_booking_no_show; списание и возврат тренировки делает база.
 */
function NoShowForm({
  booking,
  clientName: name,
  onClose,
  onDone,
}: {
  booking: BookingRow;
  clientName: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<string>(
    booking.no_show_excused === true
      ? "excused"
      : booking.no_show_excused === false
        ? "unexcused"
        : "",
  );
  const [comment, setComment] = useState(booking.no_show_comment ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!kind) {
      toast.error("Выберите причину: уважительная или нет");
      return;
    }
    if (!comment.trim()) {
      toast.error("Напишите короткий комментарий");
      return;
    }
    setSaving(true);
    try {
      const excused = kind === "excused";
      const ok = await bookingRpc(
        "mark_booking_no_show",
        { p_booking_id: booking.id, p_excused: excused, p_comment: comment.trim() },
        { error: "Ошибка", failed: "Не удалось отметить" },
      );
      if (!ok) return;
      toast.success(
        excused
          ? "Не посетил по уважительной причине — тренировка на абонементе"
          : "Не посетил — тренировка списана с абонемента",
      );
      onClose();
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Не посетил</DialogTitle>
        <DialogDescription>
          {name ? `${name}: ` : ""}почему клиента не было на занятии?
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSubmit}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Причина" required htmlFor={null}>
              <RadioGroup value={kind} onValueChange={setKind} className="space-y-2">
                {NO_SHOW_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                      kind === o.value && "border-foreground/40 bg-muted/40",
                    )}
                  >
                    <RadioGroupItem value={o.value} className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium">{o.title}</span>
                      <span className="block text-xs text-muted-foreground">{o.description}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </FormField>
            <FormField label="Комментарий" required>
              <Textarea
                note
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: заболела, предупредила утром"
              />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

function CancelBookingForm({
  booking,
  packages,
  onClose,
  onDone,
}: {
  booking: BookingRow;
  /** Пакетная студия: «Отписать» (кнопка «Отклонить» заменена на «Не посетил»). */
  packages: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const verb = packages ? "Отписать клиента" : "Отклонить запись";
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
      toast.success(packages ? "Клиент отписан" : "Запись отклонена");
      onClose();
      onDone();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{verb}?</DialogTitle>
        <DialogDescription>
          Запись будет отменена (в «Истории записей» — «Отменено» с причиной), тренировка с
          абонемента не спишется. Клиент сможет записаться снова, если останутся места.
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
            {verb}
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
