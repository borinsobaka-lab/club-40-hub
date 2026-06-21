import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { Loader2, Dumbbell, HeartPulse, Shuffle, Leaf, Activity, Plus, Minus, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/page-shell";

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

type Trainer = { id: string; full_name: string | null };
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

const TYPE_META: Record<string, { label: string; icon: LucideIcon; color: string; bg: string; stripe: string }> = {
  cardio: { label: "Кардио", icon: HeartPulse, color: "text-blue-600", bg: "bg-blue-500/10", stripe: "bg-blue-500" },
  strength: { label: "Силовая", icon: Dumbbell, color: "text-red-600", bg: "bg-red-500/10", stripe: "bg-red-500" },
  hybrid: { label: "Гибрид", icon: Shuffle, color: "text-violet-600", bg: "bg-violet-500/10", stripe: "bg-violet-500" },
  recovery: { label: "Восстановление", icon: Leaf, color: "text-emerald-600", bg: "bg-emerald-500/10", stripe: "bg-emerald-500" },
};

const TYPE_ORDER = ["cardio", "strength", "hybrid", "recovery"];

function workoutTypeMeta(type: string | null | undefined) {
  if (!type) return { label: "Тренировка", icon: Activity, color: "text-muted-foreground", bg: "bg-muted", stripe: "bg-muted-foreground/40" };
  const key = type.toLowerCase().trim();
  if (TYPE_META[key]) return TYPE_META[key];
  const byLabel = Object.values(TYPE_META).find((m) => m.label.toLowerCase() === key);
  return byLabel ?? { label: type, icon: Activity, color: "text-muted-foreground", bg: "bg-muted", stripe: "bg-muted-foreground/40" };
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
          "id, starts_at, ends_at, workout:workouts(name, type), trainers:schedule_entry_trainers(trainer:trainers(id, full_name))",
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
                    <div className="flex flex-col items-center w-12 shrink-0 pt-1 pr-2 gap-2">
                      <div className="text-base font-bold italic tabular-nums leading-tight text-center">
                        {fmtTime(c.starts_at)}
                      </div>
                      <div className="w-9 h-9 bg-[#2A2B2E] rounded-full flex items-center justify-center">
                        <span className="text-[8px] text-muted-foreground/40 font-medium">LOGO</span>
                      </div>
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
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => toggleBooking(c.id)}
                        className={`shrink-0 h-12 w-12 rounded-full flex items-center justify-center transition-colors disabled:opacity-60 ${
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
                      </button>
                    </Card>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

