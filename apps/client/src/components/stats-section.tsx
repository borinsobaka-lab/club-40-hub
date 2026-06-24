import { useEffect, useState } from "react";
import { Fire, DumbbellLargeMinimalistic, ChartSquare, Cup } from "@solar-icons/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type Spark = { week: string; count: number };
type Stats = {
  ok: boolean;
  total: number;
  this_month: number;
  best_month: number;
  streak_weeks: number;
  sparkline: Spark[];
  by_type: { type: string; count: number }[];
  benchmark: { cohort: number; percentile: number | null };
};

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

function nextMilestone(total: number) {
  return MILESTONES.find((m) => m > total) ?? total + 100;
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data);
  const w = 64;
  const h = 22;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-80">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function Card({
  icon,
  label,
  value,
  hint,
  right,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  right?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/40 p-4 flex flex-col gap-2 min-h-[112px]">
      <div className="flex items-center justify-between">
        <div className={`flex items-center justify-center w-8 h-8 rounded-full ${accent ?? "bg-primary/10 text-primary"}`}>
          {icon}
        </div>
        {right}
      </div>
      <div className="mt-auto">
        <div className="text-2xl font-bold leading-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        {hint ? <div className="text-[11px] text-muted-foreground/80 mt-1">{hint}</div> : null}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-4 rounded-2xl bg-card border border-border/40 p-5 text-center">
      <div className="text-base font-semibold mb-1">Запиши первую тренировку</div>
      <div className="text-sm text-muted-foreground">
        Чтобы увидеть прогресс, посети первый класс — статистика появится автоматически.
      </div>
    </div>
  );
}

export function StatsSection() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setStats(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("get_my_stats")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setStats(null);
        } else {
          setStats(data as unknown as Stats);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <section className="bg-background rounded-t-[14px] rounded-b-[14px] pt-5 pb-5">
        <h2 className="px-4 text-2xl font-bold italic uppercase mb-3">Статистика</h2>
        <p className="px-4 text-sm text-muted-foreground">
          Войдите, чтобы видеть свою персональную статистику тренировок.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-background rounded-t-[14px] rounded-b-[14px] pt-5 pb-5">
      <h2 className="px-4 text-2xl font-bold italic uppercase mb-3">Статистика</h2>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 px-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl bg-card border border-border/40 h-[112px] animate-pulse" />
          ))}
        </div>
      ) : !stats || !stats.ok ? (
        <EmptyState />
      ) : stats.total === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4">
            {/* Стрик */}
            <Card
              icon={<Fire size={18} weight="Bold" />}
              accent="bg-orange-500/15 text-orange-500"
              value={`${stats.streak_weeks} нед.`}
              label={stats.streak_weeks > 0 ? "недель подряд 🔥" : "начни новую серию"}
              right={<Sparkline data={stats.sparkline.map((s) => s.count)} />}
            />

            {/* Всего тренировок */}
            <Card
              icon={<DumbbellLargeMinimalistic size={18} weight="Bold" />}
              value={`${stats.total}`}
              label="всего тренировок"
              hint={`до ${nextMilestone(stats.total)} осталось ${nextMilestone(stats.total) - stats.total}`}
            />

            {/* За месяц + бенчмарк */}
            <Card
              icon={<ChartSquare size={18} weight="Bold" />}
              accent="bg-blue-500/15 text-blue-500"
              value={`${stats.this_month}`}
              label="за этот месяц"
              hint={
                stats.benchmark.percentile !== null
                  ? `чаще, чем ${Math.round(stats.benchmark.percentile * 100)}% клиентов`
                  : "недостаточно данных для сравнения"
              }
            />

            {/* Лучший месяц */}
            <Card
              icon={<Cup size={18} weight="Bold" />}
              accent="bg-emerald-500/15 text-emerald-500"
              value={`${stats.best_month}`}
              label="лучший месяц"
              hint={
                stats.this_month >= stats.best_month && stats.best_month > 0
                  ? "это твой рекорд!"
                  : `до рекорда: ${Math.max(0, stats.best_month - stats.this_month + 1)}`
              }
            />
          </div>

          <p className="px-4 mt-3 text-[11px] text-muted-foreground/70">
            Сравнение со средним по клубу анонимно и обновляется автоматически.
          </p>
        </>
      )}
    </section>
  );
}
