import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
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
  const dayEntries = entries.filter((e) => {
    const d = startOfDay(new Date(e.starts_at));
    return d.getTime() === activeDay.getTime();
  });

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Расписание</h1>
        <p className="text-sm text-muted-foreground">Выберите день и забронируйте тренировку</p>
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
        {days.map((d, i) => (
          <button
            key={d.toISOString()}
            onClick={() => setActiveIdx(i)}
            className={`flex flex-col items-center justify-center min-w-14 h-16 rounded-xl border text-sm transition-colors ${
              i === activeIdx ? "bg-primary text-primary-foreground border-primary" : "border-border"
            }`}
          >
            <span className="text-xs opacity-70">{DAY_NAMES[d.getDay()]}</span>
            <span className="font-semibold">{d.getDate()}</span>
          </button>
        ))}
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
        <div className="space-y-3">
          {dayEntries.map((c) => {
            const coaches =
              c.schedule_entry_trainers
                ?.map((x) => x.trainer?.full_name)
                .filter(Boolean)
                .join(", ") || "—";
            return (
              <Card key={c.id} className="p-4 flex items-center gap-4">
                <div className="text-center">
                  <div className="text-lg font-bold tabular-nums">{fmtTime(c.starts_at)}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {durationMin(c.starts_at, c.ends_at)} мин
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{c.workout?.name ?? "Занятие"}</div>
                  <div className="text-xs text-muted-foreground truncate">{coaches}</div>
                  <Badge variant="secondary" className="mt-1 text-[10px]">
                    Свободно
                  </Badge>
                </div>
                <Button size="sm">Записаться</Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
