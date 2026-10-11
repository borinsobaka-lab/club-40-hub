import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Refresh, CheckCircle } from "@solar-icons/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RulerPicker } from "@/components/ui/ruler-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  OnboardingLoading,
  OptionButton,
  Shell,
  StepActivity,
  StepExperience,
  StepFooter,
  StepHeader,
  StepHealth,
  StepLogistics,
  StepReferral,
  StepTitle,
  type Experience,
  type HealthFlag,
  type PrefTime,
  type Referral,
} from "@/components/onboarding";
import { fireConfetti } from "@/lib/confetti";
import { CLUB } from "@/lib/terms";

// Анкета приложения пакетных студий (решение владельца 2026-10-11). Тренировки
// в этих студиях одни для всех, поэтому анкета — про прогресс и рекомендации
// тренеров, а не про подстройку занятий. Отличия от подписочной: свои цели
// (+ «Другое» с текстом — goal_other), без мотивации, срока и вопроса про
// групповой формат, дата рождения вместо года, пол не спрашиваем — в пакетных
// студиях все клиентки (gender = 'female'). Схема —
// db/migrations/2026-10-11_packages_onboarding.sql.

type Goal = "flexibility" | "stress_relief" | "body_shape" | "other";

const GOALS: { v: Goal; label: string }[] = [
  { v: "flexibility", label: "Стать гибче" },
  { v: "stress_relief", label: "Снять напряжение и стресс" },
  { v: "body_shape", label: "Подтянуть фигуру" },
  { v: "other", label: "Другое" },
];

type FormData = {
  primary_goal: Goal | null;
  goal_other: string;
  experience_level: Experience | null;
  current_weekly_activity: number | null;
  health_flags: HealthFlag[];
  health_notes: string;
  weight_kg: string;
  birth_date: string; // YYYY-MM-DD
  desired_frequency: number | null;
  preferred_times: PrefTime[];
  referral_source: Referral | null;
};

const EMPTY: FormData = {
  primary_goal: null,
  goal_other: "",
  experience_level: null,
  current_weekly_activity: null,
  health_flags: [],
  health_notes: "",
  weight_kg: "",
  birth_date: "",
  desired_frequency: null,
  preferred_times: [],
  referral_source: null,
};

const TOTAL_STEPS = 7;
const GOAL_OTHER_MAX = 500;
const BIRTH_MIN = "1940-01-01";

/** Самая поздняя дата рождения — пять лет назад (как у линейки года). */
function birthMax() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

function validBirthDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= BIRTH_MIN && s <= birthMax();
}

function buildPayload(form: FormData) {
  const weight = Number(form.weight_kg.replace(",", "."));
  const birth = validBirthDate(form.birth_date) ? form.birth_date : null;
  return {
    primary_goal: form.primary_goal,
    goal_other: form.primary_goal === "other" ? form.goal_other.trim() || null : null,
    experience_level: form.experience_level,
    current_weekly_activity: form.current_weekly_activity,
    health_flags: form.health_flags,
    health_notes: form.health_notes.trim() || null,
    weight_kg: form.weight_kg.trim() !== "" && Number.isFinite(weight) ? weight : null,
    birth_date: birth,
    // Год — для статистики и прежних мест, где читается birth_year.
    birth_year: birth ? Number(birth.slice(0, 4)) : null,
    gender: "female",
    desired_frequency: form.desired_frequency,
    preferred_times: form.preferred_times,
    referral_source: form.referral_source,
  };
}

export function PackagesOnboardingPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0); // 0=intro, 1..7 steps, 8=final
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

  // Черновик (клиент вернулся посреди анкеты); дату рождения, если её ещё
  // нет в анкете, подставляем из карточки клиента.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      const [profileRes, clientRes] = await Promise.all([
        supabase.from("member_profiles").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("clients").select("birthday").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      // Как в гейте: при ошибке нельзя показывать пустую анкету — сохранение
      // затрёт реальные ответы.
      if (profileRes.error) {
        toast.error("Не удалось загрузить анкету. Обновите страницу.");
        return;
      }
      const data = profileRes.data;
      if (data?.onboarding_completed_at) {
        navigate({ to: "/", replace: true });
        return;
      }
      const cardBirthday = clientRes.data?.birthday?.slice(0, 10) ?? "";
      if (data) {
        // В БД поля анкеты — text/enum; локальные юнионы — клиентское сужение.
        const goal = GOALS.some((g) => g.v === data.primary_goal)
          ? (data.primary_goal as Goal)
          : null;
        setForm({
          primary_goal: goal,
          goal_other: data.goal_other ?? "",
          experience_level: (data.experience_level as Experience | null) ?? null,
          current_weekly_activity: data.current_weekly_activity ?? null,
          health_flags: (data.health_flags as HealthFlag[] | null) ?? [],
          health_notes: data.health_notes ?? "",
          weight_kg: data.weight_kg != null ? String(data.weight_kg) : "",
          birth_date: data.birth_date ?? cardBirthday,
          desired_frequency: data.desired_frequency ?? null,
          preferred_times: (data.preferred_times as PrefTime[] | null) ?? [],
          referral_source: (data.referral_source as Referral | null) ?? null,
        });
      } else if (cardBirthday) {
        setForm((f) => ({ ...f, birth_date: cardBirthday }));
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
    const { error } = await supabase
      .from("member_profiles")
      .upsert(payload, { onConflict: "user_id" });
    if (error) {
      toast.error(`Не удалось сохранить: ${error.message}`);
      return false;
    }

    // В карточку клиента — при завершении. Дату рождения клиентка указала
    // целиком (подставлена из карточки, если там была), поэтому пишем её;
    // пол — только в пустое поле.
    if (extra?.onboarding_completed_at) {
      if (validBirthDate(form.birth_date)) {
        await supabase.from("clients").update({ birthday: form.birth_date }).eq("user_id", user.id);
      }
      await supabase
        .from("clients")
        .update({ gender: "female" })
        .eq("user_id", user.id)
        .is("gender", null);
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
      fireConfetti();
      toast.success("Анкета сохранена");
      navigate({ to: "/schedule", replace: true });
    }
  }

  const stepValid = useMemo(() => {
    switch (step) {
      case 1:
        return (
          !!form.primary_goal && (form.primary_goal !== "other" || form.goal_other.trim() !== "")
        );
      case 2:
        return !!form.experience_level;
      case 3:
        return form.current_weekly_activity !== null;
      case 4:
        return form.health_flags.length > 0;
      case 5:
        return form.weight_kg.trim() !== "" && validBirthDate(form.birth_date);
      default:
        return true;
    }
  }, [step, form]);

  if (authLoading || (!bootstrapped && user)) {
    return <OnboardingLoading />;
  }

  if (step === 0) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col justify-center px-6 text-center">
          <h1 className="text-3xl font-semibold leading-tight">
            Пара вопросов — и вы сможете следить за своим прогрессом
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            Это займёт около 2 минут. Ответы помогут отслеживать ваш прогресс, а нашим тренерам —
            давать вам рекомендации.
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
          <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center mb-6">
            <CheckCircle className="h-9 w-9 text-primary-foreground" weight="BoldDuotone" />
          </div>
          <h1 className="text-2xl font-semibold leading-tight">Спасибо, что поделились с нами!</h1>
          <p className="mt-3 text-base text-muted-foreground">До встречи в студии.</p>
        </div>
        <div className="px-6 pb-8 pt-4">
          <Button
            className="w-full h-12 text-base font-semibold"
            onClick={finish}
            disabled={saving}
          >
            {saving ? <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" /> : "Начать"}
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <StepHeader
        step={step}
        total={TOTAL_STEPS}
        onBack={() => setStep((s) => Math.max(0, s - 1))}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col justify-center [&>*]:w-full">
        {step === 1 && (
          <StepGoal
            value={form.primary_goal}
            other={form.goal_other}
            onChange={(v) => update("primary_goal", v)}
            onOtherChange={(v) => update("goal_other", v)}
          />
        )}
        {step === 2 && (
          <StepExperience
            value={form.experience_level}
            onChange={(v) => update("experience_level", v)}
          />
        )}
        {step === 3 && (
          <StepActivity
            value={form.current_weekly_activity}
            onChange={(v) => update("current_weekly_activity", v)}
          />
        )}
        {step === 4 && (
          <StepHealth
            flags={form.health_flags}
            notes={form.health_notes}
            onFlagsChange={(v) => update("health_flags", v)}
            onNotesChange={(v) => update("health_notes", v)}
          />
        )}
        {step === 5 && (
          <StepBody
            weight={form.weight_kg}
            birthDate={form.birth_date}
            onWeightChange={(v) => update("weight_kg", v)}
            onBirthDateChange={(v) => update("birth_date", v)}
          />
        )}
        {step === 6 && (
          <StepLogistics
            frequency={form.desired_frequency}
            times={form.preferred_times}
            onFreqChange={(v) => update("desired_frequency", v)}
            onTimesChange={(v) => update("preferred_times", v)}
          />
        )}
        {step === 7 && (
          <StepReferral
            value={form.referral_source}
            onChange={(v) => update("referral_source", v)}
          />
        )}
      </div>

      <StepFooter
        disabled={!stepValid}
        saving={saving}
        last={step === TOTAL_STEPS}
        onNext={() => goNext(step + 1)}
      />
    </Shell>
  );
}

function StepGoal({
  value,
  other,
  onChange,
  onOtherChange,
}: {
  value: Goal | null;
  other: string;
  onChange: (v: Goal) => void;
  onOtherChange: (v: string) => void;
}) {
  return (
    <div>
      <StepTitle title="Что для вас главное прямо сейчас?" />
      <div className="space-y-2">
        {GOALS.map((o) => (
          <OptionButton key={o.v} active={value === o.v} onClick={() => onChange(o.v)}>
            {o.label}
          </OptionButton>
        ))}
      </div>
      {value === "other" && (
        <div className="mt-5 space-y-2">
          <Label htmlFor="goal_other">Расскажите, чего хотите добиться</Label>
          <Textarea
            id="goal_other"
            value={other}
            onChange={(e) => onOtherChange(e.target.value)}
            maxLength={GOAL_OTHER_MAX}
            rows={3}
            className="resize-none"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

function StepBody({
  weight,
  birthDate,
  onWeightChange,
  onBirthDateChange,
}: {
  weight: string;
  birthDate: string;
  onWeightChange: (v: string) => void;
  onBirthDateChange: (v: string) => void;
}) {
  const weightNum = weight ? Number(weight.replace(",", ".")) : null;
  const invalidDate = birthDate !== "" && !validBirthDate(birthDate);
  return (
    <div>
      <StepTitle
        title="Базовые параметры — чтобы правильно рассчитать статистику"
        subtitle={`Эти данные увидите только вы и тренеры ${CLUB.gen}.`}
      />
      <div className="space-y-7">
        <div>
          <Label className="text-sm block text-center mb-3">Вес</Label>
          <RulerPicker
            min={30}
            max={200}
            value={weightNum}
            onChange={(v) => onWeightChange(String(v))}
            unit="кг"
          />
        </div>

        <div className="max-w-[320px] mx-auto">
          <Label htmlFor="birth_date" className="text-sm block text-center mb-3">
            Дата рождения
          </Label>
          <Input
            id="birth_date"
            type="date"
            value={birthDate}
            min={BIRTH_MIN}
            max={birthMax()}
            onChange={(e) => onBirthDateChange(e.target.value)}
            className="text-center text-base font-semibold"
          />
          {invalidDate && (
            <p className="mt-2 text-center text-xs text-destructive">Проверьте дату рождения</p>
          )}
        </div>
      </div>
    </div>
  );
}
