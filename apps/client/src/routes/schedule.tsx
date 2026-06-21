import { createFileRoute } from "@tanstack/react-router";
import logoSrc from "@/assets/frame-13.svg";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";

import { Loader2, Plus, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/page-shell";
import { WorkoutDrawer, type WorkoutDrawerData } from "@/components/workout-drawer";
import { workoutTypeMeta, TYPE_ORDER } from "@/lib/workout-types";

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
type Entry = {
  id: string;
  starts_at: string;
  ends_at: string;
  workout: { name: string; type: string | null } | null;
  trainers: { trainer: Trainer | null }[] | null;
};

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



function SchedulePage() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);
  const [activeTab, setActiveTab] = useState<TabKey>("class");
  const [activeIdx, setActiveIdx] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookedIds, setBookedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<WorkoutDrawerData | null>(null);

  useEffect(() => {
    if (activeTab !== "class") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const from = today.toISOString();
      const to = addDays(today, 7).toISOString();
      const { data, error } = await supabase
        .from("schedule_entries")
        .select(
          "id, starts_at, ends_at, workout:workouts(name, type), trainers:schedule_entry_trainers(trainer:trainers(id, full_name, photo_url))",
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

  async function toggleBooking(entryId: string) {
    if (pendingId) return;
    setPendingId(entryId);
    const isBooked = bookedIds.has(entryId);
    const fn = isBooked ? "cancel_schedule_booking" : "book_schedule_entry";
    const { data, error } = await (supabase as any).rpc(fn, { p_entry_id: entryId });
    setPendingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    const res = data as { ok: boolean; reason?: string } | null;
    if (res?.ok) {
      setBookedIds((prev) => {
        const next = new Set(prev);
        if (isBooked) next.delete(entryId);
        else next.add(entryId);
        return next;
      });
    } else if (res?.reason === "already_booked") {
      setBookedIds((prev) => new Set(prev).add(entryId));
    }
  }

  const activeDay = days[activeIdx];
  const [activeType, setActiveType] = useState<string>("all");

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      const t = e.workout?.type?.toLowerCase().trim();
      if (t) set.add(t);
    });
    return TYPE_ORDER.filter((t) => set.has(t));
  }, [entries]);

  const dayEntries = entries.filter((e) => {
    const d = startOfDay(new Date(e.starts_at));
    if (d.getTime() !== activeDay.getTime()) return false;
    if (activeType === "all") return true;
    return (e.workout?.type?.toLowerCase().trim() ?? "") === activeType;
  });

  const typeFilters = [
    { key: "all", label: "Все" },
    ...availableTypes.map((t) => ({ key: t, label: workoutTypeMeta(t).label })),
  ];

  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-black italic uppercase">Бронь</h1>
          <p className="text-sm text-white/70">Выберите день и забронируйте тренировку</p>
        </div>
      }
    >
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pt-4 pb-2">
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
          <div className="sticky top-0 z-20 bg-background flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pt-2 pb-2">

            {days.map((d, i) => (
              <button
                key={d.toISOString()}
                onClick={() => setActiveIdx(i)}
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
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <Card className="p-4 text-sm text-destructive">Ошибка загрузки: {error}</Card>
          ) : dayEntries.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              На этот день тренировок пока нет
            </Card>
          ) : (
            <div className="relative">
              {dayEntries.map((c) => {
                const meta = workoutTypeMeta(c.workout?.type);
                const isBooked = bookedIds.has(c.id);
                const isPending = pendingId === c.id;
                return (
                  <div key={c.id} className="relative flex gap-1 pb-4">
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
                        const trainerPhotoPath =
                          trainerList.find((t) => !!t.photo_url)?.photo_url ?? null;
                        const trainerPhoto = trainerPhotoPath
                          ? /^https?:\/\//.test(trainerPhotoPath)
                            ? trainerPhotoPath
                            : supabase.storage
                                .from("trainer-photos")
                                .getPublicUrl(trainerPhotoPath).data.publicUrl
                          : null;
                        setOpenEntry({
                          id: c.id,
                          name: c.workout?.name ?? "Занятие",
                          type: c.workout?.type ?? null,
                          trainerName,
                          trainerPhoto,
                        });
                      }}
                      className="flex gap-1 flex-1 min-w-0 text-left active:opacity-80 transition-opacity"
                    >
                      <div className="flex flex-col items-center w-12 shrink-0 pt-1 pr-2 gap-2">
                        <div className="text-base font-bold italic tabular-nums leading-tight text-center">
                          {fmtTime(c.starts_at)}
                        </div>
                        <img src={logoSrc} alt="" className="w-9 h-9 rounded-full object-cover" />
                      </div>
                      <Card
                        className={`relative p-3 pl-4 flex items-center gap-3 flex-1 min-w-0 overflow-hidden rounded-lg transition-colors ${
                          isBooked ? "bg-[#FFE500] text-[#1B1C1F] border-[#FFE500]" : ""
                        }`}
                      >
                        <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${meta.stripe}`} />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold break-words leading-snug">
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
                        </div>
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
                          className={`shrink-0 h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
                            isPending ? "opacity-60" : ""
                          } ${
                            isBooked
                              ? "bg-white text-[#1B1C1F] border border-[#1B1C1F]/10"
                              : "bg-[#FFE500] text-[#1B1C1F]"
                          }`}
                          aria-label={isBooked ? "Отменить запись" : "Записаться"}
                        >
                          {isPending ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : isBooked ? (
                            <Minus className="h-6 w-6" strokeWidth={2.5} />
                          ) : (
                            <Plus className="h-6 w-6" strokeWidth={2.5} />
                          )}
                        </span>
                      </Card>
                    </button>
                  </div>
                );
              })}
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
        onBook={() => {
          if (openEntry) toggleBooking(openEntry.id);
        }}
      />
    </PageShell>
  );
}

