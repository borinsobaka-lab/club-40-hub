import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AltArrowLeft, Refresh, CheckCircle } from "@solar-icons/react";
import confetti from "canvas-confetti";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RulerPicker } from "@/components/ui/ruler-picker";
import { Mars, Venus } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Знакомство — CLUB 40" },
      { name: "description", content: "Пара вопросов, чтобы настроить тренировки под вас." },
    ],
  }),
  component: OnboardingPage,
});

type Gender = "female" | "male" | "other";
type Goal = "weight_loss" | "muscle_strength" | "endurance" | "energy_wellbeing" | "stress_habit" | "event_prep";
type Timeframe = "no_rush" | "few_months" | "event_date";
type Experience = "beginner" | "occasional" | "regular" | "advanced";
type HealthFlag = "back_joints" | "cardio_pressure" | "recent_injury" | "pregnancy" | "chronic" | "none";
type PrefTime = "morning" | "day" | "evening";
type Referral = "instagram" | "referral" | "walk_by" | "search" | "other";

type FormData = {
  primary_goal: Goal | null;
  goal_motivation: string;
  target_timeframe: Timeframe | null;
  experience_level: Experience | null;
  current_weekly_activity: number | null;
  tried_group_hiit: boolean | null;
  health_flags: HealthFlag[];
  health_notes: string;
  height_cm: string;
  weight_kg: string;
  birth_year: string;
  gender: Gender | null;
  desired_frequency: number | null;
  preferred_times: PrefTime[];
  referral_source: Referral | null;
};

const EMPTY: FormData = {
  primary_goal: null,
  goal_motivation: "",
  target_timeframe: null,
  experience_level: null,
  current_weekly_activity: null,
  tried_group_hiit: null,
  health_flags: [],
  health_notes: "",
  height_cm: "",
  weight_kg: "",
  birth_year: "",
  gender: null,
  desired_frequency: null,
  preferred_times: [],
  referral_source: null,
};

const TOTAL_STEPS = 10;

function buildPayload(form: FormData) {
  const num = (s: string) => {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) && s.trim() !== "" ? n : null;
  };
  return {
    primary_goal: form.primary_goal,
    goal_motivation: form.goal_motivation.trim() || null,
    target_timeframe: form.target_timeframe,
    experience_level: form.experience_level,
    current_weekly_activity: form.current_weekly_activity,
    tried_group_hiit: form.tried_group_hiit,
    health_flags: form.health_flags,
    health_notes: form.health_notes.trim() || null,
    height_cm: num(form.height_cm),
    weight_kg: num(form.weight_kg),
    birth_year: num(form.birth_year),
    gender: form.gender,
    desired_frequency: form.desired_frequency,
    preferred_times: form.preferred_times,
    referral_source: form.referral_source,
  };
}

function OnboardingPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0); // 0=intro, 1..10 steps, 11=final
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

  // Load existing draft (if user returns mid-onboarding)
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("member_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        if (data.onboarding_completed_at) {
          navigate({ to: "/", replace: true });
          return;
        }
        setForm({
          primary_goal: data.primary_goal ?? null,
          goal_motivation: data.goal_motivation ?? "",
          target_timeframe: data.target_timeframe ?? null,
          experience_level: data.experience_level ?? null,
          current_weekly_activity: data.current_weekly_activity ?? null,
          tried_group_hiit: data.tried_group_hiit ?? null,
          health_flags: data.health_flags ?? [],
          health_notes: data.health_notes ?? "",
          height_cm: data.height_cm != null ? String(data.height_cm) : "",
          weight_kg: data.weight_kg != null ? String(data.weight_kg) : "",
          birth_year: data.birth_year != null ? String(data.birth_year) : "",
          gender: data.gender ?? null,
          desired_frequency: data.desired_frequency ?? null,
          preferred_times: data.preferred_times ?? [],
          referral_source: data.referral_source ?? null,
        });
      }
      setBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate]);

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function persist(extra?: Partial<{ onboarding_completed_at: string | null }>) {
    if (!user) return false;
    const payload = { user_id: user.id, ...buildPayload(form), ...extra };
    const { error } = await (supabase as any)
      .from("member_profiles")
      .upsert(payload, { onConflict: "user_id" });
    if (error) {
      toast.error(`Не удалось сохранить: ${error.message}`);
      return false;
    }

    // Sync gender and birthday (year) into the clients row so they appear in the profile.
    const clientPatch: Record<string, string | null> = {};
    if (form.gender) clientPatch.gender = form.gender;
    const yr = Number(form.birth_year);
    if (Number.isFinite(yr) && yr > 1900) clientPatch.birthday = `${yr}-01-01`;
    if (Object.keys(clientPatch).length > 0) {
      await (supabase as any).from("clients").update(clientPatch).eq("user_id", user.id);
    }

    return true;
  }

  async function goNext(nextStep: number) {
    setSaving(true);
    const ok = await persist();
    setSaving(false);
    if (ok) setStep(nextStep);
  }

  async function finish() {
    setSaving(true);
    const ok = await persist({ onboarding_completed_at: new Date().toISOString() });
    setSaving(false);
    if (ok) {
      const fire = (opts: confetti.Options) =>
        confetti({ particleCount: 80, spread: 70, startVelocity: 45, ...opts });
      fire({ origin: { x: 0.2, y: 0.7 }, angle: 60 });
      fire({ origin: { x: 0.8, y: 0.7 }, angle: 120 });
      setTimeout(() => fire({ origin: { x: 0.5, y: 0.6 }, spread: 100 }), 200);

      toast.success("Анкета сохранена");
      navigate({ to: "/schedule", replace: true });
    }
  }


  const stepValid = useMemo(() => {
    switch (step) {
      case 1:
        return !!form.primary_goal;
      case 4:
        return !!form.experience_level;
      case 5:
        return form.current_weekly_activity !== null;
      case 7:
        return form.health_flags.length > 0;
      case 8:
        return form.weight_kg.trim() !== "" && form.birth_year.trim() !== "" && !!form.gender;
      default:
        return true;
    }
  }, [step, form]);

  

  if (authLoading || (!bootstrapped && user)) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Refresh className="h-6 w-6 text-muted-foreground animate-spin" weight="BoldDuotone" />
      </div>
    );
  }

  if (step === 0) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col justify-center px-6 text-center">
          <h1 className="text-3xl font-black italic uppercase leading-tight">
            Пара вопросов — и мы подстроим тренировки под вас
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            Это займёт около 2 минут. Поможет тренеру подобрать правильную нагрузку с первого занятия.
          </p>
        </div>
        <div className="px-6 pb-8 pt-4">
          <Button className="w-full h-12 text-base font-semibold" onClick={() => setStep(1)}>
            Начать
          </Button>
        </div>
      </Shell>
    );
  }

  if (step > TOTAL_STEPS) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="h-16 w-16 rounded-full bg-[#FFE500] flex items-center justify-center mb-6">
            <CheckCircle className="h-9 w-9 text-[#1B1C1F]" weight="BoldDuotone" />
          </div>
          <h1 className="text-2xl font-black italic uppercase leading-tight">
            Готово. Подготовим ваше первое занятие под вас.
          </h1>
          <p className="mt-3 text-base text-muted-foreground">До встречи в студии.</p>
        </div>
        <div className="px-6 pb-8 pt-4">
          <Button
            className="w-full h-12 text-base font-semibold"
            onClick={finish}
            disabled={saving}
          >
            {saving ? (
              <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
            ) : (
              "Начать"
            )}
          </Button>
        </div>
      </Shell>
    );
  }

  const progress = (step / TOTAL_STEPS) * 100;

  return (
    <Shell>
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
            aria-label="Назад"
          >
            <AltArrowLeft className="h-5 w-5" weight="BoldDuotone" />
          </button>
          <div className="flex-1">
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-[#FFE500] transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {step}/{TOTAL_STEPS}
          </span>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {step === 1 && (
          <StepGoal
            value={form.primary_goal}
            onChange={(v) => update("primary_goal", v)}
          />
        )}
        {step === 2 && (
          <StepMotivation
            value={form.goal_motivation}
            onChange={(v) => update("goal_motivation", v)}
          />
        )}
        {step === 3 && (
          <StepTimeframe
            value={form.target_timeframe}
            onChange={(v) => update("target_timeframe", v)}
          />
        )}
        {step === 4 && (
          <StepExperience
            value={form.experience_level}
            onChange={(v) => update("experience_level", v)}
          />
        )}
        {step === 5 && (
          <StepActivity
            value={form.current_weekly_activity}
            onChange={(v) => update("current_weekly_activity", v)}
          />
        )}
        {step === 6 && (
          <StepGroup
            value={form.tried_group_hiit}
            onChange={(v) => update("tried_group_hiit", v)}
          />
        )}
        {step === 7 && (
          <StepHealth
            flags={form.health_flags}
            notes={form.health_notes}
            onFlagsChange={(v) => update("health_flags", v)}
            onNotesChange={(v) => update("health_notes", v)}
          />
        )}
        {step === 8 && (
          <StepBody
            weight={form.weight_kg}
            birthYear={form.birth_year}
            gender={form.gender}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
        )}
        {step === 9 && (
          <StepLogistics
            frequency={form.desired_frequency}
            times={form.preferred_times}
            onFreqChange={(v) => update("desired_frequency", v)}
            onTimesChange={(v) => update("preferred_times", v)}
          />
        )}
        {step === 10 && (
          <StepReferral
            value={form.referral_source}
            onChange={(v) => update("referral_source", v)}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 pt-2 space-y-2 border-t border-border/40">
        <Button
          className="w-full h-12 text-base font-semibold"
          disabled={!stepValid || saving}
          onClick={() => goNext(step + 1)}
        >
          {saving ? (
            <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
          ) : step === TOTAL_STEPS ? (
            "Завершить"
          ) : (
            "Далее"
          )}
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col h-[100dvh] bg-background">{children}</div>;
}

/* ===== Reusable controls ===== */

function OptionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-4 rounded-xl border transition-colors ${
        active
          ? "bg-[#FFE500] text-[#1B1C1F] border-[#FFE500] font-semibold"
          : "bg-card text-card-foreground border-border hover:border-foreground/30"
      }`}
    >
      {children}
    </button>
  );
}

function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-2xl font-black italic uppercase leading-tight">{title}</h2>
      {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/* ===== Steps ===== */

function StepGoal({ value, onChange }: { value: Goal | null; onChange: (v: Goal) => void }) {
  const opts: { v: Goal; label: string }[] = [
    { v: "weight_loss", label: "Снизить вес" },
    { v: "muscle_strength", label: "Стать сильнее, набрать мышцы" },
    { v: "endurance", label: "Поднять выносливость и форму" },
    { v: "energy_wellbeing", label: "Больше энергии и хорошее самочувствие" },
    { v: "stress_habit", label: "Снять стресс, выработать привычку" },
    { v: "event_prep", label: "Подготовиться к событию" },
  ];
  return (
    <div>
      <StepTitle title="Что для вас главное прямо сейчас?" />
      <div className="space-y-2">
        {opts.map((o) => (
          <OptionButton key={o.v} active={value === o.v} onClick={() => onChange(o.v)}>
            {o.label}
          </OptionButton>
        ))}
      </div>
    </div>
  );
}

function StepMotivation({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <StepTitle title="Что вас к этому подтолкнуло?" subtitle="Можно в двух словах — это поможет нам лучше понять вас." />
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Например: хочу чувствовать себя бодрее по утрам"
        rows={5}
        className="resize-none"
      />
    </div>
  );
}

function StepTimeframe({
  value,
  onChange,
}: {
  value: Timeframe | null;
  onChange: (v: Timeframe) => void;
}) {
  const opts: { v: Timeframe; label: string }[] = [
    { v: "no_rush", label: "Без спешки, в удовольствие" },
    { v: "few_months", label: "Хочу результат за 1–3 месяца" },
    { v: "event_date", label: "Готовлюсь к конкретной дате" },
  ];
  return (
    <div>
      <StepTitle title="Есть ли у вас срок?" />
      <div className="space-y-2">
        {opts.map((o) => (
          <OptionButton key={o.v} active={value === o.v} onClick={() => onChange(o.v)}>
            {o.label}
          </OptionButton>
        ))}
      </div>
    </div>
  );
}

function StepExperience({
  value,
  onChange,
}: {
  value: Experience | null;
  onChange: (v: Experience) => void;
}) {
  const opts: { v: Experience; label: string }[] = [
    { v: "beginner", label: "Новичок или большой перерыв" },
    { v: "occasional", label: "Тренируюсь время от времени" },
    { v: "regular", label: "Регулярно, 2–3 раза в неделю" },
    { v: "advanced", label: "Опытный, тренируюсь интенсивно" },
  ];
  return (
    <div>
      <StepTitle title="Какой у вас опыт тренировок?" />
      <div className="space-y-2">
        {opts.map((o) => (
          <OptionButton key={o.v} active={value === o.v} onClick={() => onChange(o.v)}>
            {o.label}
          </OptionButton>
        ))}
      </div>
    </div>
  );
}

function StepActivity({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const opts = [
    { v: 0, label: "Почти не двигаюсь" },
    { v: 1, label: "1 раз в неделю" },
    { v: 3, label: "2–3 раза в неделю" },
    { v: 5, label: "4 и больше" },
  ];
  return (
    <div>
      <StepTitle title="Сколько раз в неделю вы сейчас двигаетесь или тренируетесь?" />
      <div className="space-y-2">
        {opts.map((o) => (
          <OptionButton key={o.v} active={value === o.v} onClick={() => onChange(o.v)}>
            {o.label}
          </OptionButton>
        ))}
      </div>
    </div>
  );
}

function StepGroup({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <StepTitle title="Тренировались в групповом формате?" />
      <div className="space-y-2">
        <OptionButton active={value === true} onClick={() => onChange(true)}>
          Да, формат знаком
        </OptionButton>
        <OptionButton active={value === false} onClick={() => onChange(false)}>
          Нет, будет впервые
        </OptionButton>
      </div>
    </div>
  );
}

function StepHealth({
  flags,
  notes,
  onFlagsChange,
  onNotesChange,
}: {
  flags: HealthFlag[];
  notes: string;
  onFlagsChange: (v: HealthFlag[]) => void;
  onNotesChange: (v: string) => void;
}) {
  const opts: { v: HealthFlag; label: string }[] = [
    { v: "back_joints", label: "Спина или суставы" },
    { v: "cardio_pressure", label: "Сердце или давление" },
    { v: "recent_injury", label: "Недавняя травма или операция" },
    { v: "pregnancy", label: "Беременность" },
    { v: "chronic", label: "Хроническое заболевание" },
  ];

  const toggle = (f: HealthFlag) => {
    if (f === "none") {
      onFlagsChange(["none"]);
      return;
    }
    const next = flags.includes(f) ? flags.filter((x) => x !== f) : [...flags.filter((x) => x !== "none"), f];
    onFlagsChange(next);
  };

  const hasReal = flags.some((f) => f !== "none");

  return (
    <div>
      <StepTitle
        title="Есть что-то, о чём стоит знать тренеру?"
        subtitle="Отметьте, если актуально — тренер скорректирует нагрузку. Это не заменяет консультацию врача."
      />
      <div className="space-y-2">
        {opts.map((o) => (
          <OptionButton key={o.v} active={flags.includes(o.v)} onClick={() => toggle(o.v)}>
            {o.label}
          </OptionButton>
        ))}
        <OptionButton active={flags.includes("none")} onClick={() => toggle("none")}>
          Ничего из перечисленного
        </OptionButton>
      </div>
      {hasReal && (
        <div className="mt-5 space-y-2">
          <Label htmlFor="health_notes">Кратко опишите, что важно учесть</Label>
          <Textarea
            id="health_notes"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Необязательно"
            rows={3}
            className="resize-none"
          />
        </div>
      )}
    </div>
  );
}

function StepBody({
  weight,
  birthYear,
  gender,
  onChange,
}: {
  weight: string;
  birthYear: string;
  gender: Gender | null;
  onChange: (patch: Partial<FormData>) => void;
}) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1939 }, (_, i) => currentYear - i);
  return (
    <div>
      <StepTitle
        title="Базовые параметры — чтобы правильно рассчитать статистику"
        subtitle="Эти данные доступны только вам."
      />
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="weight">Вес, кг</Label>
          <Input
            id="weight"
            inputMode="decimal"
            value={weight}
            onChange={(e) => onChange({ weight_kg: e.target.value.replace(/[^\d.,]/g, "") })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="byear">Год рождения</Label>
          <Select
            value={birthYear || undefined}
            onValueChange={(v) => onChange({ birth_year: v })}
          >
            <SelectTrigger id="byear" className="h-12">
              <SelectValue placeholder="Выберите год" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Пол</Label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: "female", label: "Женский" },
              { v: "male", label: "Мужской" },
            ] as { v: Gender; label: string }[]).map((g) => (
              <button
                key={g.v}
                type="button"
                onClick={() => onChange({ gender: g.v })}
                className={`px-3 py-3 rounded-xl border text-sm transition-colors ${
                  gender === g.v
                    ? "bg-[#FFE500] text-[#1B1C1F] border-[#FFE500] font-semibold"
                    : "bg-card border-border hover:border-foreground/30"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepLogistics({
  frequency,
  times,
  onFreqChange,
  onTimesChange,
}: {
  frequency: number | null;
  times: PrefTime[];
  onFreqChange: (v: number) => void;
  onTimesChange: (v: PrefTime[]) => void;
}) {
  const timeOpts: { v: PrefTime; label: string }[] = [
    { v: "morning", label: "Утро" },
    { v: "day", label: "День" },
    { v: "evening", label: "Вечер" },
  ];
  const toggleTime = (t: PrefTime) =>
    onTimesChange(times.includes(t) ? times.filter((x) => x !== t) : [...times, t]);

  return (
    <div className="space-y-6">
      <StepTitle title="Как планируете заниматься?" />
      <div>
        <Label className="text-sm">Сколько раз в неделю хотите ходить?</Label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onFreqChange(n)}
              className={`h-12 rounded-xl border font-semibold transition-colors ${
                frequency === n
                  ? "bg-[#FFE500] text-[#1B1C1F] border-[#FFE500]"
                  : "bg-card border-border hover:border-foreground/30"
              }`}
            >
              {n === 4 ? "4+" : n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-sm">Удобное время</Label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {timeOpts.map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => toggleTime(t.v)}
              className={`h-12 rounded-xl border font-semibold transition-colors ${
                times.includes(t.v)
                  ? "bg-[#FFE500] text-[#1B1C1F] border-[#FFE500]"
                  : "bg-card border-border hover:border-foreground/30"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepReferral({
  value,
  onChange,
}: {
  value: Referral | null;
  onChange: (v: Referral) => void;
}) {
  const opts: { v: Referral; label: string }[] = [
    { v: "instagram", label: "Instagram / соцсети" },
    { v: "referral", label: "Рекомендация друга" },
    { v: "walk_by", label: "Проходил(а) мимо" },
    { v: "search", label: "Поиск / карты" },
    { v: "other", label: "Другое" },
  ];
  return (
    <div>
      <StepTitle title="Откуда вы о нас узнали?" />
      <div className="space-y-2">
        {opts.map((o) => (
          <OptionButton key={o.v} active={value === o.v} onClick={() => onChange(o.v)}>
            {o.label}
          </OptionButton>
        ))}
      </div>
    </div>
  );
}
