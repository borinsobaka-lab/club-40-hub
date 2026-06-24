import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Refresh, Fire } from "@solar-icons/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/page-shell";
import { WorkoutDrawer, type WorkoutDrawerData } from "@/components/workout-drawer";
import { workoutTypeMeta, TYPE_ORDER } from "@/lib/workout-types";
import { useClubSettings } from "@/hooks/use-club-settings";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "Бронь — CLUB 40" },
      { name: "description", content: "Бронирование занятий CLUB 40." },
    ],
  }),
  component: SchedulePage,
});

const TABS = [
  { key: "class", label: "Классы" },
  { key: "personal", label: "Персональные" },
  { key: "diagnostics", label: "Диагностика" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Trainer = { id: string; full_name: string | null; photo_url: string | null };
type Workout = {
  name: string;
  type: string | null;
  description: string | null;
  photo_url: string | null;
  capacity: number | null;
};
type Entry = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  booked_count: number;
  workout: Workout | null;
  trainers: { trainer: Trainer | null }[] | null;
};

function resolvePublicUrl(bucket: string, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

const DAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function remainingSpots(capacity: number | null, booked: number) {
  if (capacity == null) return null;
  return Math.max(0, capacity - booked);
}
function pluralSeats(n: number) {
  if (n % 100 >= 11 && n % 100 <= 14) return "мест";
  const r = n % 10;
  if (r === 1) return "место";
  if (r >= 2 && r <= 4) return "места";
  return "мест";
}



function SchedulePage() {
  const navigate = useNavigate();
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => Array.from({ length: 10 }, (_, i) => addDays(today, i - 3)), [today]);
  const [activeTab, setActiveTab] = useState<TabKey>("class");
  const [activeIdx, setActiveIdx] = useState(3);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookedIds, setBookedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<WorkoutDrawerData | null>(null);
  const clubSettings = useClubSettings();
  const daysContainerRef = useRef<HTMLDivElement>(null);
  const dayBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gestureStartRef = useRef<{ x: number; y: number; idx: number } | null>(null);
  const swipedRef = useRef(false);
  const wheelLockedRef = useRef(false);
  const wheelReleaseRef = useRef<number | null>(null);

  const selectDay = useCallback(
    (idx: number) => {
      setActiveIdx(Math.max(0, Math.min(days.length - 1, idx)));
    },
    [days.length],
  );

  const shiftDay = useCallback(
    (delta: -1 | 1) => {
      setActiveIdx((idx) => Math.max(0, Math.min(days.length - 1, idx + delta)));
    },
    [days.length],
  );

  useEffect(() => {
    if (activeTab !== "class") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const from = addDays(today, -3).toISOString();
      const to = addDays(today, 7).toISOString();
      const { data, error } = await supabase
        .from("schedule_entries")
        .select(
          "id, starts_at, ends_at, capacity, booked_count, workout:workouts(name, type, description, photo_url, capacity), trainers:schedule_entry_trainers(trainer:trainers(id, full_name, photo_url))",
        )
        .gte("starts_at", from)
        .lt("starts_at", to)
        .order("starts_at");
      if (cancelled) return;
      if (error) setError(error.message);
      else setEntries((data as unknown as Entry[]) ?? []);
      setLoading(false);

      const { data: b } = await (supabase as any)
        .from("schedule_bookings")
        .select("entry_id")
        .eq("status", "booked");
      if (!cancelled && b) {
        setBookedIds(new Set((b as { entry_id: string }[]).map((r) => r.entry_id)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today, activeTab]);

  useEffect(() => {
    const container = daysContainerRef.current;
    const btn = dayBtnRefs.current[activeIdx];
    if (!container || !btn) return;
    const padLeft = parseFloat(getComputedStyle(container).paddingLeft) || 0;
    container.scrollTo({
      left: Math.max(0, btn.offsetLeft - padLeft),
      behavior: "smooth",
    });
  }, [activeIdx]);

  useEffect(() => {
    return () => {
      if (wheelReleaseRef.current !== null) window.clearTimeout(wheelReleaseRef.current);
    };
  }, []);


  async function toggleBooking(entryId: string) {
    if (pendingId) return;
    setPendingId(entryId);
    const isBooked = bookedIds.has(entryId);
    const fn = isBooked ? "cancel_schedule_booking" : "book_schedule_entry";
    const { data, error } = await (supabase as any).rpc(fn, { p_entry_id: entryId });
    setPendingId(null);
    if (error) {
      toast.error(`Не удалось ${isBooked ? "отменить запись" : "записаться"}: ${error.message}`);
      return;
    }
    const reasonMessages: Record<string, string> = {
      unauthorized: "Войдите в аккаунт, чтобы записаться",
      no_client: "Профиль клиента не найден. Обратитесь к администратору.",
      no_membership: "Нет активного абонемента. Купите абонемент, чтобы записаться.",
      no_visits_left: "На абонементе закончились посещения",
      not_found: "Тренировка не найдена",
      past: "Эта тренировка уже прошла",
      full: "Свободных мест больше нет",
      not_booked: "Вы не были записаны на эту тренировку",
    };
    const res = data as { ok: boolean; reason?: string } | null;
    if (res?.ok) {
      setBookedIds((prev) => {
        const next = new Set(prev);
        if (isBooked) next.delete(entryId);
        else next.add(entryId);
        return next;
      });
      toast.success(isBooked ? "Запись отменена" : "Вы записаны на тренировку");
    } else if (res?.reason === "already_booked") {
      setBookedIds((prev) => new Set(prev).add(entryId));
    } else if (res?.reason === "no_membership" || res?.reason === "no_visits_left") {
      toast.info(reasonMessages[res.reason]);
      navigate({ to: "/memberships" });
    } else if (res?.reason) {
      toast.error(reasonMessages[res.reason] ?? `Не удалось выполнить действие: ${res.reason}`);
    }
  }

  const [activeType, setActiveType] = useState<string>("all");

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      const t = e.workout?.type?.toLowerCase().trim();
      if (t) set.add(t);
    });
    return TYPE_ORDER.filter((t) => set.has(t));
  }, [entries]);

  const entriesByDay = useMemo(
    () =>
      days.map((day) =>
        entries.filter((e) => {
          const d = startOfDay(new Date(e.starts_at));
          if (d.getTime() !== day.getTime()) return false;
          if (activeType === "all") return true;
          return (e.workout?.type?.toLowerCase().trim() ?? "") === activeType;
        }),
      ),
    [days, entries, activeType],
  );


  const typeFilters = [
    { key: "all", label: "Все" },
    ...availableTypes.map((t) => ({ key: t, label: workoutTypeMeta(t).label })),
  ];

  return (
    <PageShell
      scrollKey={activeTab}
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-black italic uppercase">Бронь</h1>
          <p className="text-sm text-white/70">Выберите день и забронируйте тренировку</p>
        </div>
      }
    >
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pt-4 pb-0">
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`shrink-0 relative pt-3 pb-1 text-base font-semibold transition-colors ${
                active ? "text-foreground" : "text-[#66676D]"
              }`}
            >
              {t.label}
              {active && (
                <span className="absolute left-0 right-0 -bottom-px h-1 bg-[#FFE500] rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {activeTab !== "class" ? (
        <div className="p-4">
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Функционал скоро будет доступен
          </Card>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div ref={daysContainerRef} className="sticky top-0 z-20 bg-background flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pt-2 pb-2">

            {days.map((d, i) => (
                <button
                  key={d.toISOString()}
                  ref={(el) => { dayBtnRefs.current[i] = el; }}
                  onClick={() => selectDay(i)}
                className={`flex flex-col items-center justify-center min-w-14 h-16 rounded-xl transition-colors ${
                  i === activeIdx
                    ? "bg-[#1B1C1F] text-[#FFE500]"
                    : "bg-card text-card-foreground"
                }`}
              >
                <span className={`text-xs ${i === activeIdx ? "" : "opacity-70"}`}>
                  {DAY_NAMES[d.getDay()]}
                </span>
                <span className="text-lg font-bold italic">{d.getDate()}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
            {typeFilters.map((t) => {
              const active = activeType === t.key;
              const meta = t.key === "all" ? null : workoutTypeMeta(t.key);
              const Icon = meta?.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveType(t.key)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-7 rounded-full border text-xs font-semibold transition-colors ${
                    active
                      ? "bg-[#1B1C1F] text-white border-[#1B1C1F]"
                      : "bg-transparent text-foreground border-border"
                  }`}
                >
                  {Icon && <Icon className={`h-3.5 w-3.5 ${meta!.color}`} />}
                  {t.label}
                </button>
              );
            })}
          </div>


          {loading ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
            </div>
          ) : error ? (
            <Card className="p-4 text-sm text-destructive">Ошибка загрузки: {error}</Card>
          ) : (
            <div
              onWheel={(e) => {
                if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
                e.preventDefault();
                if (wheelReleaseRef.current !== null) window.clearTimeout(wheelReleaseRef.current);
                wheelReleaseRef.current = window.setTimeout(() => {
                  wheelLockedRef.current = false;
                }, 420);
                if (wheelLockedRef.current) return;
                wheelLockedRef.current = true;
                shiftDay(e.deltaX > 0 ? 1 : -1);
              }}
              onPointerDown={(e) => {
                if (e.pointerType === "mouse") return;
                swipedRef.current = false;
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
                  swipedRef.current = true;
                  selectDay(start.idx + (dx < 0 ? 1 : -1));
                  // На тач-устройствах после движения > slop click может не прийти —
                  // сбрасываем флаг сами, чтобы не блокировать следующий тап.
                  window.setTimeout(() => {
                    swipedRef.current = false;
                  }, 350);
                } else {
                  swipedRef.current = false;
                }
              }}
              onPointerCancel={() => {
                gestureStartRef.current = null;
                swipedRef.current = false;
              }}
              onClickCapture={(e) => {
                if (!swipedRef.current) return;
                e.preventDefault();
                e.stopPropagation();
                swipedRef.current = false;
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
                      На этот день тренировок пока нет
                    </Card>
                  ) : (
                    <div className="relative">
                      {dayList.map((c) => {
                        const meta = workoutTypeMeta(c.workout?.type);
                        const isBooked = bookedIds.has(c.id);
                        const isPending = pendingId === c.id;
                        const isPast = new Date(c.starts_at) < new Date();
                        return (
                          <div key={c.id} className={`relative pb-4 ${isPast ? "opacity-20" : ""}`}>
                            <button
                              type="button"
                              onClick={() => {
                                const trainerList = (c.trainers ?? [])
                                  .map((t) => t.trainer)
                                  .filter((t): t is Trainer => !!t);
                                const trainerName =
                                  trainerList
                                    .map((t) => t.full_name)
                                    .filter((n): n is string => !!n)
                                    .join(", ") || null;
                                const trainerPhoto = resolvePublicUrl(
                                  "trainer-photos",
                                  trainerList.find((t) => !!t.photo_url)?.photo_url,
                                );
                                setOpenEntry({
                                  id: c.id,
                                  name: c.workout?.name ?? "Занятие",
                                  type: c.workout?.type ?? null,
                                  description: c.workout?.description ?? null,
                                  photo: resolvePublicUrl("workout-photos", c.workout?.photo_url),
                                  trainerName,
                                  trainerPhoto,
                                  startsAt: c.starts_at,
                                  endsAt: c.ends_at,
                                });
                              }}
                              className="w-full text-left active:opacity-80 transition-opacity"
                            >
                              <Card
                                className={`relative p-3 pl-4 flex items-center gap-3 w-full overflow-hidden rounded-lg transition-colors ${
                                  isBooked ? "bg-[#FFE500] text-[#1B1C1F] border-[#FFE500]" : ""
                                }`}
                              >
                                <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${meta.stripe}`} />
                                <div className="flex flex-col items-center justify-center w-12 shrink-0">
                                  <div className="text-base font-black italic tabular-nums leading-tight text-center">
                                    {fmtTime(c.starts_at)}
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0 ml-1">
                                  <div className="font-medium break-words leading-snug">
                                    {c.workout?.name ?? "Занятие"}
                                  </div>
                                  {(() => {
                                    const names = (c.trainers ?? [])
                                      .map((t) => t.trainer?.full_name)
                                      .filter((n): n is string => !!n);
                                    if (names.length === 0) return null;
                                    return (
                                      <div className={`text-xs mt-0.5 truncate ${isBooked ? "text-[#1B1C1F]/70" : "text-muted-foreground"}`}>
                                        {names.join(", ")}
                                      </div>
                                    );
                                  })()}
                                  {(() => {
                                    const effectiveCapacity = c.capacity ?? c.workout?.capacity ?? null;
                                    const left = remainingSpots(effectiveCapacity, c.booked_count);
                                    if (left === null || left > 5 || left === 0) return null;
                                    return (
                                      <div className="flex items-center gap-1 text-xs mt-0.5 text-orange-500">
                                        <Fire className="h-3.5 w-3.5" weight="BoldDuotone" />
                                        <span>Осталось {left} {pluralSeats(left)}</span>
                                      </div>
                                    );
                                  })()}
                                </div>
                                {!isBooked && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    aria-disabled={isPending}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!isPending) toggleBooking(c.id);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!isPending) toggleBooking(c.id);
                                      }
                                    }}
                                    className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center transition-colors bg-[#FFE500] text-[#1B1C1F] ${
                                      isPending ? "opacity-60" : ""
                                    }`}
                                    aria-label="Записаться"
                                  >
                                    {isPending ? (
                                      <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
                                    ) : (
                                      <svg
                                        width="20"
                                        height="20"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="text-[#1B1C1F]"
                                      >
                                        <path
                                          d="M12 5V19M5 12H19"
                                          stroke="currentColor"
                                          strokeWidth="2.5"
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    )}
                                  </span>
                                )}
                              </Card>
                            </button>
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
      <WorkoutDrawer
        data={openEntry}
        open={openEntry !== null}
        onOpenChange={(o) => {
          if (!o) setOpenEntry(null);
        }}
        isBooked={openEntry ? bookedIds.has(openEntry.id) : false}
        isPending={openEntry ? pendingId === openEntry.id : false}
        cancelMinutes={clubSettings.cancel_booking_minutes}
        onBook={() => {
          if (openEntry) toggleBooking(openEntry.id);
        }}
      />
    </PageShell>
  );
}
