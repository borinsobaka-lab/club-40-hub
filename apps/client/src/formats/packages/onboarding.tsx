import { useNavigate } from "@tanstack/react-router";
import { Children, useEffect, useMemo, useState, type ReactNode } from "react";
import { AltArrowLeft, Refresh } from "@solar-icons/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RulerPicker } from "@/components/ui/ruler-picker";
import { Textarea } from "@/components/ui/textarea";
import { DarkFrame as Frame } from "@/formats/packages/dark-frame";
import introArt from "@/assets/onboarding-intro.webp";
import finalArt from "@/assets/onboarding-final.webp";
import scheduleArt from "@/assets/onboarding-schedule.webp";
import {
  ActivityOptions,
  ExperienceOptions,
  FrequencyPicker,
  HealthNotesInput,
  HealthOptions,
  OnboardingLoading,
  OptionButton,
  ReferralOptions,
  TimesPicker,
} from "@/components/onboarding";
import {
  FREQUENCY_LABEL,
  HEALTH_NOTES_LABEL,
  STEP_TITLES,
  TIMES_LABEL,
  hasHealthIssues,
  type Experience,
  type HealthFlag,
  type PrefTime,
  type Referral,
} from "@/lib/onboarding";
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
      <Frame
        tall
        art={introArt}
        header={
          <div className="px-6 pt-2 pb-10">
            <h1 className="text-3xl font-semibold leading-tight">
              Пара вопросов — и вы сможете следить за своим прогрессом
            </h1>
          </div>
        }
        footer={<PrimaryButton onClick={() => setStep(1)}>Начать</PrimaryButton>}
      >
        <p className="px-6 pt-6 text-base text-muted-foreground">
          Это займёт около 2 минут. Ответы помогут отслеживать ваш прогресс, а нашим тренерам —
          давать вам рекомендации.
        </p>
      </Frame>
    );
  }

  if (step > TOTAL_STEPS) {
    return (
      <Frame
        tall
        art={finalArt}
        header={
          <div className="px-6 pt-2 pb-10">
            <h1 className="text-3xl font-semibold leading-tight">
              Спасибо, что поделились с нами!
            </h1>
          </div>
        }
        footer={
          <PrimaryButton onClick={finish} disabled={saving} saving={saving}>
            Начать
          </PrimaryButton>
        }
      >
        <p className="px-6 pt-6 text-base text-muted-foreground">До встречи в студии.</p>
      </Frame>
    );
  }

  const titles = STEP_HEADERS[step];
  const art = STEP_ART[step];

  return (
    <Frame
      tall={!!art}
      art={art}
      top={
        <div className="px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors active:bg-white/20"
              aria-label="Назад"
            >
              <AltArrowLeft className="h-5 w-5" weight="BoldDuotone" />
            </button>
            <Progress step={step} total={TOTAL_STEPS} />
          </div>
        </div>
      }
      header={
        <div className="px-4 pt-5 pb-8">
          <h1 className="text-2xl font-semibold leading-tight">{titles.title}</h1>
          {titles.subtitle && <p className="mt-2 text-sm text-white/70">{titles.subtitle}</p>}
        </div>
      }
      footer={
        <PrimaryButton
          onClick={() => goNext(step + 1)}
          disabled={!stepValid || saving}
          saving={saving}
        >
          {step === TOTAL_STEPS ? "Завершить" : "Далее"}
        </PrimaryButton>
      }
    >
      {step === 1 && (
        <Blocks>
          <Block>
            <GoalOptions value={form.primary_goal} onChange={(v) => update("primary_goal", v)} />
          </Block>
          {form.primary_goal === "other" && (
            <Block title="Расскажите, чего хотите добиться">
              <Textarea
                value={form.goal_other}
                onChange={(e) => update("goal_other", e.target.value)}
                maxLength={GOAL_OTHER_MAX}
                rows={3}
                className="resize-none"
                aria-label="Расскажите, чего хотите добиться"
                autoFocus
              />
            </Block>
          )}
        </Blocks>
      )}
      {step === 2 && (
        <Blocks>
          <Block>
            <ExperienceOptions
              value={form.experience_level}
              onChange={(v) => update("experience_level", v)}
            />
          </Block>
        </Blocks>
      )}
      {step === 3 && (
        <Blocks>
          <Block>
            <ActivityOptions
              value={form.current_weekly_activity}
              onChange={(v) => update("current_weekly_activity", v)}
            />
          </Block>
        </Blocks>
      )}
      {step === 4 && (
        <Blocks>
          <Block>
            <HealthOptions flags={form.health_flags} onChange={(v) => update("health_flags", v)} />
          </Block>
          {hasHealthIssues(form.health_flags) && (
            <Block title={HEALTH_NOTES_LABEL}>
              <HealthNotesInput
                value={form.health_notes}
                onChange={(v) => update("health_notes", v)}
              />
            </Block>
          )}
        </Blocks>
      )}
      {step === 5 && (
        <Blocks>
          <Block title="Вес">
            <RulerPicker
              min={30}
              max={200}
              value={form.weight_kg ? Number(form.weight_kg.replace(",", ".")) : null}
              onChange={(v) => update("weight_kg", String(v))}
              unit="кг"
            />
          </Block>
          <Block title="Дата рождения">
            <BirthDateInput value={form.birth_date} onChange={(v) => update("birth_date", v)} />
          </Block>
        </Blocks>
      )}
      {step === 6 && (
        <Blocks>
          <Block title={FREQUENCY_LABEL}>
            <FrequencyPicker
              value={form.desired_frequency}
              onChange={(v) => update("desired_frequency", v)}
            />
          </Block>
          <Block title={TIMES_LABEL}>
            <TimesPicker
              value={form.preferred_times}
              onChange={(v) => update("preferred_times", v)}
            />
          </Block>
        </Blocks>
      )}
      {step === 7 && (
        <Blocks>
          <Block>
            <ReferralOptions
              value={form.referral_source}
              onChange={(v) => update("referral_source", v)}
            />
          </Block>
        </Blocks>
      )}
    </Frame>
  );
}

/**
 * Иллюстрации шагов, где мало полей (на шагах со списками их нет): шаг
 * становится tall — картинка в тёмной зоне, белая панель по содержимому.
 */
const STEP_ART: Record<number, string> = {
  6: scheduleArt,
};

/** Вопрос шага — в тёмной шапке. */
const STEP_HEADERS: Record<number, { title: string; subtitle?: string }> = {
  1: { title: "Что для вас главное прямо сейчас?" },
  2: STEP_TITLES.experience,
  3: STEP_TITLES.activity,
  4: STEP_TITLES.health,
  5: {
    title: "Базовые параметры — чтобы правильно рассчитать статистику",
    subtitle: `Эти данные увидите только вы и тренеры ${CLUB.gen}.`,
  },
  6: STEP_TITLES.logistics,
  7: STEP_TITLES.referral,
};

/** Прогресс анкеты: «Шаг N из M» и полоска по шагам. */
function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 text-xs font-semibold text-white/70 tabular-nums">
        Шаг {step} из {total}
      </div>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              i < step ? "bg-white" : "bg-white/20"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Смысловые блоки шага с разделителями, как на главной: серая полоса между
 * белыми блоками со скруглёнными краями. Первый блок примыкает к верху
 * панели, последний — к кнопке.
 */
function Blocks({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <div className="bg-muted">
      {items.map((child, i) => {
        const first = i === 0;
        const last = i === items.length - 1;
        return (
          <div
            key={i}
            className={`bg-background ${first ? "" : "mt-3 rounded-t-[14px]"} ${
              last ? "" : "rounded-b-[14px]"
            }`}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}

function Block({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="px-4 pt-5 pb-5">
      {title && <h2 className="mb-3 text-lg font-semibold leading-tight">{title}</h2>}
      {children}
    </section>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  saving,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  saving?: boolean;
  children: ReactNode;
}) {
  return (
    <Button className="h-12 w-full text-base font-semibold" onClick={onClick} disabled={disabled}>
      {saving ? <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" /> : children}
    </Button>
  );
}

function GoalOptions({ value, onChange }: { value: Goal | null; onChange: (v: Goal) => void }) {
  return (
    <div className="space-y-2">
      {GOALS.map((o) => (
        <OptionButton key={o.v} active={value === o.v} onClick={() => onChange(o.v)}>
          {o.label}
        </OptionButton>
      ))}
    </div>
  );
}

function BirthDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const invalid = value !== "" && !validBirthDate(value);
  return (
    <div>
      <Input
        type="date"
        value={value}
        min={BIRTH_MIN}
        max={birthMax()}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Дата рождения"
        className="text-base font-semibold"
      />
      {invalid && <p className="mt-2 text-xs text-destructive">Проверьте дату рождения</p>}
    </div>
  );
}
