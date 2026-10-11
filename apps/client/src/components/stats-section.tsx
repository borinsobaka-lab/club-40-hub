import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Fire,
  DumbbellLargeMinimalistic,
  ChartSquare,
  Cup,
  Fire as FireIcon,
  ChartSquare as DonutIcon,
} from "@solar-icons/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// ---- Types ----

type BookingRow = {
  starts_at: string;
  duration_min: number | null;
  calories: number | null;
  workout_id: string | null;
  workout_type: string | null;
  studio_id: string | null;
};

type StatsMv = {
  studio_id: string;
  user_id: string;
  visits_30d: number;
  calories_30d: number;
  visits_percentile: number | null;
  calories_percentile: number | null;
  cohort_size: number;
};

type WorkoutType = "cardio" | "strength" | "hybrid" | "recovery" | "unknown";

const TYPE_LABEL: Record<WorkoutType, string> = {
  cardio: "Кардио",
  strength: "Сила",
  hybrid: "Гибрид",
  recovery: "Восст.",
  unknown: "Прочее",
};

const TYPE_COLOR: Record<WorkoutType, string> = {
  cardio: "bg-red-500",
  strength: "bg-blue-500",
  hybrid: "bg-violet-500",
  recovery: "bg-emerald-500",
  unknown: "bg-muted-foreground",
};

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
function nextMilestone(total: number) {
  return MILESTONES.find((m) => m > total) ?? total + 100;
}

function normalizeType(t: string | null | undefined): WorkoutType {
  const v = (t ?? "").toLowerCase();
  if (v === "cardio" || v === "strength" || v === "hybrid" || v === "recovery") return v;
  return "unknown";
}

function startOfWeek(d: Date): Date {
  // ISO week start = Monday
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function weekKey(d: Date) {
  const w = startOfWeek(d);
  return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, "0")}-${String(w.getDate()).padStart(2, "0")}`;
}

function formatNumber(n: number) {
  return n.toLocaleString("ru-RU");
}

// ---- Small UI helpers ----

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

function TypeBar({ parts }: { parts: { type: WorkoutType; count: number }[] }) {
  const total = parts.reduce((s, p) => s + p.count, 0);
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {parts.map((p) => (
        <div
          key={p.type}
          className={TYPE_COLOR[p.type]}
          style={{ width: `${(p.count / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

function Card({
  icon,
  label,
  value,
  hint,
  right,
  accent,
  footer,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  right?: React.ReactNode;
  accent?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/40 p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div
          className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full ${accent ?? "bg-primary/10 text-primary"}`}
        >
          {icon}
        </div>
        <div className="text-2xl font-bold leading-tight">{value}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {hint ? <div className="text-[11px] text-muted-foreground/80 mt-0.5">{hint}</div> : null}
      </div>
      {right}
      {footer}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-4 rounded-2xl bg-card border border-border/40 p-5 text-center">
      <div className="text-sm text-muted-foreground">
        Чтобы увидеть прогресс, посети первый класс — статистика появится автоматически.
      </div>
    </div>
  );
}

// ---- Aggregation ----

type Aggregated = {
  total: number;
  thisMonth: number;
  bestMonth: number;
  streakWeeks: number;
  sparkline: number[]; // last 8 weeks
  byType: { type: WorkoutType; count: number }[];
  calories30d: number;
  calories30dHasNull: boolean;
};

function aggregate(rows: BookingRow[]): Aggregated {
  const now = new Date();
  const monthCounts = new Map<string, number>();
  const weekSet = new Set<string>();
  const typeCounts = new Map<WorkoutType, number>();

  const sparkBuckets: number[] = Array(8).fill(0);
  const sparkAnchors: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    sparkAnchors.push(weekKey(d));
  }

  let total = 0;
  let thisMonth = 0;
  let calories30d = 0;
  let calories30dHasNull = false;

  const thisMonthKey = monthKey(now);
  const cutoff30 = new Date(now);
  cutoff30.setDate(cutoff30.getDate() - 30);

  for (const r of rows) {
    const d = new Date(r.starts_at);
    if (d > now) continue; // only past
    total += 1;
    const mk = monthKey(d);
    monthCounts.set(mk, (monthCounts.get(mk) ?? 0) + 1);
    if (mk === thisMonthKey) thisMonth += 1;
    weekSet.add(weekKey(d));
    const t = normalizeType(r.workout_type);
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);

    const wk = weekKey(d);
    const idx = sparkAnchors.indexOf(wk);
    if (idx >= 0) sparkBuckets[idx] += 1;

    if (d >= cutoff30) {
      if (r.calories == null) calories30dHasNull = true;
      else calories30d += r.calories;
    }
  }

  let bestMonth = 0;
  monthCounts.forEach((v) => {
    if (v > bestMonth) bestMonth = v;
  });

  // Weekly streak — consecutive ISO weeks ending at current/last week with >=1 visit
  let streak = 0;
  for (let i = 0; i < 520; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const wk = weekKey(d);
    const has = weekSet.has(wk);
    if (i === 0 && !has) continue; // allow skipping current week if empty
    if (has) streak += 1;
    else break;
  }

  const byType: { type: WorkoutType; count: number }[] = [];
  (["cardio", "strength", "hybrid", "recovery", "unknown"] as WorkoutType[]).forEach((t) => {
    const c = typeCounts.get(t) ?? 0;
    if (c > 0) byType.push({ type: t, count: c });
  });

  return {
    total,
    thisMonth,
    bestMonth,
    streakWeeks: streak,
    sparkline: sparkBuckets,
    byType,
    calories30d,
    calories30dHasNull,
  };
}

// ---- Main component ----

export function StatsSection() {
  const { user } = useAuth();
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [mv, setMv] = useState<StatsMv | null>(null);
  const [hasWeight, setHasWeight] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  // Ошибка истории посещений — не «пока нет тренировок».
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) {
      setRows(null);
      setMv(null);
      setHasWeight(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    (async () => {
      const [logs, stats, profile] = await Promise.all([
        (supabase as unknown as { from: (t: string) => any })
          .from("bookings_log")
          .select("starts_at,duration_min,calories,workout_id,workout_type,studio_id")
          .eq("user_id", user.id)
          .eq("status", "attended")
          .order("starts_at", { ascending: false })
          .limit(2000),
        // Матвью закрыта для клиентов (RLS на материализованных вью не
        // работает, а select был выдан всем вошедшим). Свою строку получаем
        // через SECURITY DEFINER-функцию my_stats_30d.
        (supabase as unknown as { rpc: (fn: string) => any }).rpc("my_stats_30d").maybeSingle(),
        supabase.from("member_profiles").select("weight_kg").eq("user_id", user.id).maybeSingle(),
      ]);

      if (cancelled) return;
      // Без истории статистика пустая — это ошибка, а не ноль тренировок.
      // Матвью и профиль необязательны: без них карточки работают.
      if (logs.error) throw logs.error;
      setRows((logs.data ?? []) as BookingRow[]);
      setMv((stats.data ?? null) as StatsMv | null);
      setHasWeight(profile.data?.weight_kg != null);
      setLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setRows([]);
      setMv(null);
      setHasWeight(null);
      setFailed(true);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const agg = useMemo(() => (rows ? aggregate(rows) : null), [rows]);

  const cohortOk = !!mv && mv.cohort_size >= 11;
  const visitsPct =
    cohortOk && mv?.visits_percentile != null
      ? Math.min(99, Math.round(mv.visits_percentile * 100))
      : null;
  const caloriesPct =
    cohortOk && mv?.calories_percentile != null
      ? Math.min(99, Math.round(mv.calories_percentile * 100))
      : null;

  if (!user) {
    return (
      <section className="bg-background rounded-t-[14px] rounded-b-[14px] pt-5 pb-5">
        <h2 className="px-4 text-2xl font-semibold">Статистика</h2>
        <p className="px-4 text-sm text-muted-foreground mb-3">Прогресс, рекорды и ориентиры</p>
        <p className="px-4 text-sm text-muted-foreground">
          Войдите, чтобы видеть свою персональную статистику тренировок.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-background rounded-t-[14px] rounded-b-[14px] pt-5 pb-5">
      <h2 className="px-4 text-2xl font-semibold">Статистика</h2>
      <p className="px-4 text-sm text-muted-foreground mb-3">Прогресс, рекорды и ориентиры</p>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 px-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl bg-card border border-border/40 h-[112px] animate-pulse"
            />
          ))}
        </div>
      ) : failed ? (
        <p className="px-4 text-sm text-destructive">
          Не удалось загрузить статистику. Обновите страницу.
        </p>
      ) : !agg || agg.total === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4">
            {/* Стрик */}
            <Card
              icon={<Fire size={18} weight="Bold" />}
              accent="bg-orange-500/15 text-orange-500"
              value={`${agg.streakWeeks} нед.`}
              label={
                agg.streakWeeks > 0 ? "недель подряд с тренировками 🔥" : "начни новую серию недель"
              }
              right={<Sparkline data={agg.sparkline} />}
            />

            {/* Всего тренировок */}
            <Card
              icon={<DumbbellLargeMinimalistic size={18} weight="Bold" />}
              value={`${agg.total}`}
              label="тренировок за всё время"
              hint={`до ${nextMilestone(agg.total)} осталось ${nextMilestone(agg.total) - agg.total}`}
            />

            {/* За месяц + бенчмарк */}
            <Card
              icon={<ChartSquare size={18} weight="Bold" />}
              accent="bg-blue-500/15 text-blue-500"
              value={`${agg.thisMonth}`}
              label="тренировок в этом месяце"
              hint={
                visitsPct !== null
                  ? `активнее, чем ${visitsPct}% клиентов клуба`
                  : "сравнение с клубом появится позже"
              }
            />

            {/* Калории за 30 дней */}
            <Card
              icon={<FireIcon size={18} weight="Bold" />}
              accent="bg-amber-500/15 text-amber-600"
              value={
                hasWeight === false && agg.calories30d === 0
                  ? "—"
                  : `≈ ${formatNumber(agg.calories30d)}`
              }
              label="ккал сожжено за 30 дней"
              hint={
                hasWeight === false
                  ? "укажите вес в профиле для расчёта"
                  : caloriesPct !== null
                    ? `больше, чем у ${caloriesPct}% клиентов клуба`
                    : "оценка по типу и длительности тренировки"
              }
              footer={
                hasWeight === false ? (
                  <Link
                    to="/profile"
                    className="mt-2 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Перейти в профиль →
                  </Link>
                ) : null
              }
            />

            {/* Распределение по типам */}
            {agg.byType.length > 0 ? (
              <Card
                icon={<DonutIcon size={18} weight="Bold" />}
                accent="bg-violet-500/15 text-violet-500"
                value={`${agg.byType.length} тип${agg.byType.length === 1 ? "" : agg.byType.length < 5 ? "а" : "ов"}`}
                label="разных видов тренировок"
                footer={
                  <div className="mt-2 flex flex-col gap-1.5">
                    <TypeBar parts={agg.byType} />
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      {agg.byType.map((p) => (
                        <span key={p.type} className="inline-flex items-center gap-1">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${TYPE_COLOR[p.type]}`}
                          />
                          {TYPE_LABEL[p.type]} {p.count}
                        </span>
                      ))}
                    </div>
                  </div>
                }
              />
            ) : null}

            {/* Лучший месяц */}
            <Card
              icon={<Cup size={18} weight="Bold" />}
              accent="bg-emerald-500/15 text-emerald-500"
              value={`${agg.bestMonth}`}
              label="тренировок в лучшем месяце"
              hint={
                agg.thisMonth >= agg.bestMonth && agg.bestMonth > 0
                  ? "это твой личный рекорд!"
                  : `до рекорда осталось ${Math.max(0, agg.bestMonth - agg.thisMonth + 1)}`
              }
            />
          </div>

          <p className="px-4 mt-3 text-center text-xs text-muted-foreground/80">
            <CaloriesInfoLink />
          </p>
        </>
      )}
    </section>
  );
}

function CaloriesInfoLink() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="hover:text-foreground transition-colors">
          Как считаются калории?
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Как мы считаем калории</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-foreground text-[15px] leading-relaxed">
          <p>
            Калории в приложении — это оценка. Точную цифру может дать только пульсометр или умные
            часы, но даже без них можно посчитать расход достаточно близко по проверенной методике,
            которую используют большинство фитнес-приложений.
          </p>
          <p>
            Мы опираемся на три параметра: <strong>тип тренировки</strong>, её{" "}
            <strong>длительность</strong> и ваш <strong>вес из профиля</strong>. У каждого типа
            занятия (кардио, силовая, гибрид, восстановление) своя интенсивность — коэффициент{" "}
            <strong>MET</strong> (Metabolic Equivalent of Task), который показывает, во сколько раз
            активнее работает организм по сравнению с состоянием покоя. Чем выше интенсивность и
            дольше занятие — тем больше расход.
          </p>
          <p>
            Важно, что калории фиксируются <strong>персонально для вас</strong> в момент каждой
            тренировки и <strong>навсегда сохраняются в истории</strong>. То есть если вы измените
            вес в профиле, прошлые тренировки не пересчитаются — каждая запись хранит ваш реальный
            показатель на тот день. Именно из этой истории и складывается вся ваша статистика.
          </p>
          <p>
            Сравнение со средним по клубу полностью <strong>анонимно</strong> — мы показываем только
            обобщённые цифры, без чьих-либо имён, и обновляем их раз в сутки.
          </p>
          <p>
            Помните: это <strong>ориентир</strong>, а не точное измерение. Реальный расход зависит
            ещё и от вашего пульса, состава тела и того, насколько вы выкладываетесь. Но для
            отслеживания динамики и сравнения с собой прошлым этой оценки более чем достаточно.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
