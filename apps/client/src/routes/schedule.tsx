import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Dumbbell, HeartPulse, Shuffle, Leaf, Activity, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "Расписание — CLUB 40" },
      { name: "description", content: "Расписание тренировок CLUB 40 на ближайшие дни." },
    ],
  }),
  component: SchedulePage,
});

type Entry = {
  id: string;
  starts_at: string;
  ends_at: string;
  workout: { name: string; type: string | null } | null;
  schedule_entry_trainers: { trainer: { full_name: string } | null }[];
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
function durationMin(s: string, e: string) {
  return Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000);
}

const TYPE_META: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  strength: { label: "Силовая", icon: Dumbbell, cls: "bg-red-500/10 text-red-600 border-red-500/20" },
  cardio: { label: "Кардио", icon: HeartPulse, cls: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  hybrid: { label: "Гибрид", icon: Shuffle, cls: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
  recovery: { label: "Восстановление", icon: Leaf, cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
};

function workoutTypeMeta(type: string | null | undefined) {
  if (!type) return { label: "Тренировка", icon: Activity, cls: "bg-muted text-muted-foreground border-border" };
  const key = type.toLowerCase().trim();
  if (TYPE_META[key]) return TYPE_META[key];
  // match by russian label too
  const byLabel = Object.values(TYPE_META).find((m) => m.label.toLowerCase() === key);
  return byLabel ?? { label: type, icon: Activity, cls: "bg-muted text-muted-foreground border-border" };
}

function SchedulePage() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const from = today.toISOString();
      const to = addDays(today, 7).toISOString();
      const { data, error } = await supabase
        .from("schedule_entries")
        .select(
          "id, starts_at, ends_at, workout:workouts(name, type), schedule_entry_trainers(trainer:trainers(full_name))",
        )
        .gte("starts_at", from)
        .lt("starts_at", to)
        .order("starts_at");
      if (cancelled) return;
      if (error) setError(error.message);
      else setEntries((data as unknown as Entry[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const activeDay = days[activeIdx];
  const [activeType, setActiveType] = useState<string>("all");

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      const t = e.workout?.type?.toLowerCase().trim();
      if (t) set.add(t);
    });
    return Array.from(set);
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
        <div className="pt-4 pb-6 px-4">
          <h1 className="text-2xl font-bold">Расписание</h1>
          <p className="text-sm text-muted-foreground">Выберите день и забронируйте тренировку</p>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
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
            return (
              <button
                key={t.key}
                onClick={() => setActiveType(t.key)}
                className={`shrink-0 px-3 h-7 rounded-full border text-xs font-semibold transition-colors ${
                  active
                    ? "bg-[#1B1C1F] text-white border-[#1B1C1F]"
                    : "bg-transparent text-foreground border-border"
                }`}
              >
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
            {dayEntries.map((c, idx) => {
              const coaches =
                c.schedule_entry_trainers
                  ?.map((x) => x.trainer?.full_name)
                  .filter(Boolean)
                  .join(", ") || "—";
              const isLast = idx === dayEntries.length - 1;
              return (
                <div key={c.id} className="relative flex gap-3 pb-4">
                  <div className="flex flex-col items-center w-14 shrink-0 pt-1">
                    <div className="text-sm font-semibold tabular-nums leading-tight">
                      {fmtTime(c.starts_at)}
                    </div>
                    <div className="text-xs tabular-nums leading-tight text-muted-foreground/60">
                      {fmtTime(c.ends_at)}
                    </div>
                    <div className="mt-2 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                    {!isLast && <div className="flex-1 w-px bg-border mt-1" />}
                  </div>
                  <Card className="p-4 flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{c.workout?.name ?? "Занятие"}</div>
                      <div className="text-xs text-muted-foreground truncate">{coaches}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {(() => {
                          const meta = workoutTypeMeta(c.workout?.type);
                          const Icon = meta.icon;
                          return (
                            <Badge variant="outline" className={`text-[10px] gap-1 ${meta.cls}`}>
                              <Icon className="h-3 w-3" />
                              {meta.label}
                            </Badge>
                          );
                        })()}
                        <Badge variant="secondary" className="text-[10px]">
                          {durationMin(c.starts_at, c.ends_at)} мин
                        </Badge>
                      </div>
                    </div>
                    <Button size="sm">Записаться</Button>
                  </Card>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}

