import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer as DrawerPrimitive } from "vaul";
import { AltArrowDown, CheckCircle, CloseCircle } from "@solar-icons/react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import { supabase } from "@/integrations/supabase/client";
import { settlePackageMemberships } from "@/lib/packages-memberships";
import { PageShell } from "@/components/page-shell";
import { UnderlineTabs } from "@/components/underline-tabs";
import { WorkoutDrawer, type WorkoutDrawerData } from "@/components/workout-drawer";
import { useClubSettings } from "@/hooks/use-club-settings";
import { useViewedStudioId, useViewedStudioName } from "@/hooks/use-viewed-studio";
import { useAuth } from "@/hooks/use-auth";
import { ScheduleListSkeleton } from "@/components/content-skeletons";
import {
  entryColor,
  entryTrainers,
  packEntryToDrawerData,
  trainerInitials,
  trainerPhoto,
  type PackEntry,
} from "./entries";
import { PackWorkoutCard } from "./workout-card";
import {
  SCHEDULE_DAYS,
  SCHEDULE_DAYS_BEFORE,
  addDays,
  packMyBookingsQuery,
  packScheduleQuery,
  startOfDay,
  type MyScheduleBookings,
} from "./queries";

/**
 * «Расписание» пакетного приложения (до 2026-10-11 — «Бронь», общий экран с
 * подписочным). Студия — смотримая (переключатель на главной); записаться
 * можно только в своей. Фильтры — по тренировкам и по тренерам (у пакетных
 * тренировок нет типа, прежний фильтр по типу был пустым).
 */

const TABS = [
  { key: "class", label: "Тренировки" },
  { key: "personal", label: "Персональные" },
  { key: "diagnostics", label: "Диагностика" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const DAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

type FilterKind = "workout" | "trainer";
type FilterOption = { id: string; label: string; color?: string | null; photo?: string | null };

export function PackagesSchedulePage() {
  const navigate = useNavigate();
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(
    () => Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(today, i - SCHEDULE_DAYS_BEFORE)),
    [today],
  );
  const [activeIdx, setActiveIdx] = useState(SCHEDULE_DAYS_BEFORE);
  const [activeTab, setActiveTab] = useState<TabKey>("class");

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<WorkoutDrawerData | null>(null);
  const [workoutFilter, setWorkoutFilter] = useState<string | null>(null);
  const [trainerFilter, setTrainerFilter] = useState<string | null>(null);
  const [filterSheet, setFilterSheet] = useState<FilterKind | null>(null);
  const clubSettings = useClubSettings("home");
  const { user } = useAuth();
  const { studioId, studioReady, isHome } = useViewedStudioId();
  const viewedStudioName = useViewedStudioName();
  const daysContainerRef = useRef<HTMLDivElement>(null);
  const dayBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gestureStartRef = useRef<{ x: number; y: number; idx: number } | null>(null);
  const suppressedSwipeClickRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const wheelLockedRef = useRef(false);
  const wheelReleaseRef = useRef<number | null>(null);
  const swipeAreaRef = useRef<HTMLDivElement>(null);

  const selectDay = useCallback(
    (idx: number) => setActiveIdx(Math.max(0, Math.min(days.length - 1, idx))),
    [days.length],
  );
  const shiftDay = useCallback(
    (delta: -1 | 1) => setActiveIdx((idx) => Math.max(0, Math.min(days.length - 1, idx + delta))),
    [days.length],
  );

  // Другая студия — другие тренировки и тренеры: фильтры сбрасываем.
  useEffect(() => {
    setWorkoutFilter(null);
    setTrainerFilter(null);
  }, [studioId]);

  // Занятия и свои записи — из кэша React Query (src/formats/packages/queries.ts):
  // повторный переход на «Расписание» открывается сразу, свежие данные — фоном.
  const queryClient = useQueryClient();
  const scheduleQuery = packScheduleQuery(studioId, today, studioReady);
  const myBookingsQuery = packMyBookingsQuery(user?.id ?? null, today);
  const schedule = useQuery(scheduleQuery);
  const myBookings = useQuery(myBookingsQuery);
  const entries = useMemo(() => schedule.data ?? [], [schedule.data]);
  // Как и раньше, список — вместе с отметками своих записей: иначе карточка
  // на миг предлагала «Записаться» на занятие, где клиент уже записан.
  const loading = schedule.isPending || (!!user && myBookings.isPending);
  const error = !schedule.data && schedule.error ? schedule.error.message : null;
  const bookedIds = useMemo(() => new Set(myBookings.data?.booked ?? []), [myBookings.data]);
  const waitlistedIds = useMemo(() => new Set(myBookings.data?.waitlist ?? []), [myBookings.data]);

  const bookingsError = myBookings.error?.message;
  useEffect(() => {
    if (bookingsError) toast.error(`Не удалось загрузить ваши записи: ${bookingsError}`);
  }, [bookingsError]);

  const updateMine = (fn: (m: MyScheduleBookings) => MyScheduleBookings) =>
    queryClient.setQueryData(myBookingsQuery.queryKey, (prev) =>
      fn(prev ?? { booked: [], waitlist: [] }),
    );
  const addTo = (list: "booked" | "waitlist", entryId: string) =>
    updateMine((m) => (m[list].includes(entryId) ? m : { ...m, [list]: [...m[list], entryId] }));

  useEffect(() => {
    const container = daysContainerRef.current;
    const btn = dayBtnRefs.current[activeIdx];
    if (!container || !btn) return;
    const padLeft = parseFloat(getComputedStyle(container).paddingLeft) || 0;
    container.scrollTo({ left: Math.max(0, btn.offsetLeft - padLeft), behavior: "smooth" });
  }, [activeIdx]);

  useEffect(() => {
    return () => {
      if (wheelReleaseRef.current !== null) window.clearTimeout(wheelReleaseRef.current);
    };
  }, []);

  // Горизонтальный свайп тачпадом/колесом листает дни (passive: false — иначе
  // preventDefault игнорируется), как в подписочном расписании.
  useEffect(() => {
    const el = swipeAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (wheelReleaseRef.current !== null) window.clearTimeout(wheelReleaseRef.current);
      wheelReleaseRef.current = window.setTimeout(() => {
        wheelLockedRef.current = false;
      }, 420);
      if (wheelLockedRef.current) return;
      wheelLockedRef.current = true;
      shiftDay(e.deltaX > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loading, error, activeTab, shiftDay]);

  async function toggleBooking(entryId: string, reason?: string) {
    if (pendingId) return;
    const wasBooked = bookedIds.has(entryId);
    const wasWaitlisted = waitlistedIds.has(entryId);
    const isActive = wasBooked || wasWaitlisted;
    setPendingId(entryId);
    const fn = isActive ? ("cancel_schedule_booking" as const) : ("book_schedule_entry" as const);
    // Продление могло стать действующим — иначе запись ответила бы «нет абонемента».
    if (!isActive) await settlePackageMemberships();
    const { data, error } = await supabase.rpc(
      fn,
      isActive ? { p_entry_id: entryId, p_reason: reason ?? null } : { p_entry_id: entryId },
    );
    setPendingId(null);
    if (error) {
      toast.error(`Не удалось ${isActive ? "отменить запись" : "записаться"}: ${error.message}`);
      return;
    }
    const reasonMessages: Record<string, string> = {
      unauthorized: "Войдите в аккаунт, чтобы записаться",
      no_client: "Профиль клиента не найден. Обратитесь к администратору.",
      no_membership: "Нет действующего абонемента — обратитесь к администратору студии.",
      no_visits_left: "На абонементе закончились тренировки",
      not_found: "Тренировка не найдена",
      past: "Эта тренировка уже прошла",
      full: "Свободных мест больше нет",
      not_booked: "Вы не были записаны на эту тренировку",
    };
    const res = data as {
      ok: boolean;
      reason?: string;
      waitlisted?: boolean;
      booked_count?: number;
    } | null;
    const setCount = (count: (e: PackEntry) => number) =>
      queryClient.setQueryData(scheduleQuery.queryKey, (prev) =>
        prev?.map((e) => (e.id === entryId ? { ...e, booked_count: count(e) } : e)),
      );
    if (res?.ok) {
      // Записи на главной — из другого запроса: обновятся при возврате на неё.
      queryClient.invalidateQueries({ queryKey: ["home-bookings"] });
      if (isActive) {
        updateMine((m) => ({
          booked: m.booked.filter((id) => id !== entryId),
          waitlist: m.waitlist.filter((id) => id !== entryId),
        }));
        if (wasBooked) {
          setCount((e) =>
            typeof res.booked_count === "number"
              ? res.booked_count
              : Math.max(0, e.booked_count - 1),
          );
        }
        toast.success(wasWaitlisted ? "Вы вышли из листа ожидания" : "Запись отменена");
      } else if (res.waitlisted) {
        addTo("waitlist", entryId);
        toast.success("Мест нет — вы в листе ожидания");
      } else {
        addTo("booked", entryId);
        setCount((e) =>
          typeof res.booked_count === "number" ? res.booked_count : e.booked_count + 1,
        );
        // Абонемент действует во всех студиях сети — запись в другую студию
        // спишется с него же; называем студию, чтобы не перепутать адрес.
        toast.success(
          !isHome && viewedStudioName
            ? `Вы записаны на тренировку в студии «${viewedStudioName}»`
            : "Вы записаны на тренировку",
        );
      }
    } else if (res?.reason === "already_booked") {
      addTo("booked", entryId);
      if (typeof res.booked_count === "number") {
        const n = res.booked_count;
        setCount(() => n);
      }
    } else if (res?.reason === "already_waitlisted") {
      addTo("waitlist", entryId);
    } else if (res?.reason === "no_membership" || res?.reason === "no_visits_left") {
      toast.info(reasonMessages[res.reason]);
      navigate({ to: "/memberships" });
    } else if (res?.reason) {
      toast.error(reasonMessages[res.reason] ?? `Не удалось выполнить действие: ${res.reason}`);
    }
  }

  // Варианты фильтров — из загруженных занятий (тренировки и тренеры этих дней).
  const workoutOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, FilterOption>();
    for (const e of entries) {
      if (e.workout && !map.has(e.workout.id)) {
        map.set(e.workout.id, { id: e.workout.id, label: e.workout.name, color: entryColor(e) });
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [entries]);
  const trainerOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, FilterOption>();
    for (const e of entries) {
      for (const t of entryTrainers(e)) {
        if (!map.has(t.id)) {
          map.set(t.id, { id: t.id, label: t.full_name ?? "Тренер", photo: trainerPhoto(t) });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [entries]);

  const entriesByDay = useMemo(
    () =>
      days.map((day) =>
        entries.filter((e) => {
          if (startOfDay(new Date(e.starts_at)).getTime() !== day.getTime()) return false;
          if (workoutFilter && e.workout?.id !== workoutFilter) return false;
          if (trainerFilter && !entryTrainers(e).some((t) => t.id === trainerFilter)) return false;
          return true;
        }),
      ),
    [days, entries, workoutFilter, trainerFilter],
  );

  const workoutLabel = workoutOptions.find((o) => o.id === workoutFilter)?.label;
  const trainerLabel = trainerOptions.find((o) => o.id === trainerFilter)?.label;
  const filtered = !!workoutFilter || !!trainerFilter;

  const openEntryRow = openEntry ? entries.find((x) => x.id === openEntry.id) : undefined;

  return (
    <PageShell
      scrollKey="schedule"
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-semibold">Расписание</h1>
          <p className="text-sm text-white/70">Выберите день и запишитесь на тренировку</p>
        </div>
      }
    >
      <UnderlineTabs
        tabs={TABS}
        value={activeTab}
        onChange={setActiveTab}
        className="px-4 pt-4"
        gapClass="gap-3"
      />

      {activeTab === "personal" ? (
        <div className="p-4">
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Совсем скоро мы начнем принимать заявки на персональные тренировки
          </Card>
        </div>
      ) : activeTab !== "class" ? (
        <div className="p-4">
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Функционал скоро будет доступен
          </Card>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div
            ref={daysContainerRef}
            className="sticky top-0 z-20 bg-background flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pt-2 pb-2"
          >
            {days.map((d, i) => {
              const isPastDay = d.getTime() < today.getTime();
              const active = i === activeIdx;
              return (
                <button
                  key={d.toISOString()}
                  ref={(el) => {
                    dayBtnRefs.current[i] = el;
                  }}
                  onClick={() => selectDay(i)}
                  className={`flex flex-col items-center justify-center min-w-14 h-16 rounded-xl transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground"
                  } ${isPastDay ? "opacity-20" : ""}`}
                >
                  <span
                    className={`text-xs font-medium ${active ? "text-primary-foreground" : "text-muted-foreground"}`}
                  >
                    {DAY_NAMES[d.getDay()]}
                  </span>
                  <span className="text-lg font-bold">{d.getDate()}</span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
            <FilterChip
              label={workoutLabel ?? "Все тренировки"}
              active={!!workoutFilter}
              onClick={() => setFilterSheet("workout")}
            />
            <FilterChip
              label={trainerLabel ?? "Все тренеры"}
              active={!!trainerFilter}
              onClick={() => setFilterSheet("trainer")}
            />
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setWorkoutFilter(null);
                  setTrainerFilter(null);
                }}
                className="shrink-0 inline-flex items-center gap-1 px-3 h-8 rounded-full text-xs font-medium text-muted-foreground"
              >
                <CloseCircle className="h-4 w-4" weight="BoldDuotone" />
                Сбросить
              </button>
            )}
          </div>

          {loading ? (
            <div className="px-4">
              <ScheduleListSkeleton />
            </div>
          ) : error ? (
            <Card className="p-4 text-sm text-destructive">Ошибка загрузки: {error}</Card>
          ) : (
            <div
              ref={swipeAreaRef}
              onPointerDown={(e) => {
                if (e.pointerType === "mouse") return;
                gestureStartRef.current = { x: e.clientX, y: e.clientY, idx: activeIdx };
              }}
              onPointerUp={(e) => {
                const start = gestureStartRef.current;
                gestureStartRef.current = null;
                if (!start) return;
                const dx = e.clientX - start.x;
                const dy = e.clientY - start.y;
                const isSwipe = Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.2;
                if (isSwipe) {
                  const swipeClick = { x: e.clientX, y: e.clientY, time: performance.now() };
                  suppressedSwipeClickRef.current = swipeClick;
                  selectDay(start.idx + (dx < 0 ? 1 : -1));
                  window.setTimeout(() => {
                    if (suppressedSwipeClickRef.current === swipeClick) {
                      suppressedSwipeClickRef.current = null;
                    }
                  }, 120);
                }
              }}
              onPointerCancel={() => {
                gestureStartRef.current = null;
                suppressedSwipeClickRef.current = null;
              }}
              onClickCapture={(e) => {
                const swipeClick = suppressedSwipeClickRef.current;
                if (!swipeClick) return;
                suppressedSwipeClickRef.current = null;
                const age = performance.now() - swipeClick.time;
                const distance = Math.hypot(e.clientX - swipeClick.x, e.clientY - swipeClick.y);
                if (age <= 180 && distance <= 32) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className="-mx-4 overflow-hidden touch-pan-y"
              style={{ touchAction: "pan-y" }}
            >
              <div
                className="flex transition-transform duration-300 ease-out"
                style={{ transform: `translate3d(-${activeIdx * 100}%, 0, 0)` }}
              >
                {entriesByDay.map((dayList, dayIdx) => (
                  <div key={days[dayIdx].toISOString()} className="w-full shrink-0 px-4">
                    {dayList.length === 0 ? (
                      <Card className="p-6 text-center text-sm text-muted-foreground">
                        {filtered
                          ? "На этот день таких тренировок нет"
                          : "На этот день тренировок пока нет"}
                      </Card>
                    ) : (
                      <div className="relative">
                        {dayList.map((c) => {
                          const isPast = new Date(c.starts_at) < new Date();
                          return (
                            <div
                              key={c.id}
                              className={`relative pb-4 ${isPast ? "opacity-20" : ""}`}
                            >
                              <PackWorkoutCard
                                entry={c}
                                isBooked={bookedIds.has(c.id)}
                                isWaitlisted={waitlistedIds.has(c.id)}
                                isPending={pendingId === c.id}
                                onOpen={() => setOpenEntry(packEntryToDrawerData(c))}
                                onBook={() => toggleBooking(c.id)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <FilterSheet
        kind={filterSheet}
        options={filterSheet === "trainer" ? trainerOptions : workoutOptions}
        value={filterSheet === "trainer" ? trainerFilter : workoutFilter}
        onChange={(id) => {
          if (filterSheet === "trainer") setTrainerFilter(id);
          else setWorkoutFilter(id);
          setFilterSheet(null);
        }}
        onClose={() => setFilterSheet(null)}
      />

      <WorkoutDrawer
        data={openEntryRow ? packEntryToDrawerData(openEntryRow) : openEntry}
        open={openEntry !== null}
        onOpenChange={(o) => {
          if (!o) setOpenEntry(null);
        }}
        isBooked={openEntry ? bookedIds.has(openEntry.id) : false}
        isWaitlisted={openEntry ? waitlistedIds.has(openEntry.id) : false}
        isFull={openEntryRow ? packEntryToDrawerData(openEntryRow).spotsLeft === 0 : false}
        isPending={openEntry ? pendingId === openEntry.id : false}
        cancelMinutes={clubSettings.cancel_booking_minutes}
        onBook={(reason) => {
          if (openEntry) toggleBooking(openEntry.id, reason);
        }}
      />
    </PageShell>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 inline-flex max-w-[60%] items-center gap-1 px-3 h-8 rounded-full border text-xs font-medium transition-colors ${
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-transparent text-muted-foreground border-border"
      }`}
    >
      <span className="truncate">{label}</span>
      <AltArrowDown className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}

function FilterSheet({
  kind,
  options,
  value,
  onChange,
  onClose,
}: {
  kind: FilterKind | null;
  options: FilterOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  onClose: () => void;
}) {
  const all = kind === "trainer" ? "Все тренеры" : "Все тренировки";
  const rows: (FilterOption | null)[] = [null, ...options];
  return (
    <DrawerPrimitive.Root
      open={kind !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      shouldScaleBackground
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DrawerPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
          aria-describedby={undefined}
        >
          <div className="mx-auto mb-1 mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-3">
            <DrawerPrimitive.Title className="text-xl font-semibold">
              {kind === "trainer" ? "Тренер" : "Тренировка"}
            </DrawerPrimitive.Title>
            {options.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                В ближайшие дни в расписании пусто.
              </p>
            )}
            <ul className="mt-3 divide-y divide-border">
              {rows.map((o) => {
                const id = o?.id ?? null;
                const active = id === value;
                return (
                  <li key={id ?? "all"}>
                    <button
                      type="button"
                      onClick={() => onChange(id)}
                      className="flex w-full items-center gap-3 py-3 text-left"
                    >
                      {kind === "trainer" && o ? (
                        <SquircleAvatar size={32} className="shrink-0">
                          {o.photo && <SquircleAvatarImage src={o.photo} alt={o.label} />}
                          <SquircleAvatarFallback className="bg-muted text-xs font-semibold text-muted-foreground">
                            {trainerInitials(o.label)}
                          </SquircleAvatarFallback>
                        </SquircleAvatar>
                      ) : kind === "workout" && o ? (
                        <span
                          className={`h-3 w-3 shrink-0 rounded-full ${o.color ? "" : "bg-muted-foreground/40"}`}
                          style={o.color ? { backgroundColor: o.color } : undefined}
                        />
                      ) : null}
                      <span className={`min-w-0 flex-1 truncate ${active ? "font-semibold" : ""}`}>
                        {o?.label ?? all}
                      </span>
                      {active && (
                        <CheckCircle className="h-5 w-5 shrink-0 text-primary" weight="Bold" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
