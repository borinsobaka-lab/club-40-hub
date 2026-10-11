import { AltArrowLeft, Refresh } from "@solar-icons/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

// Общее для анкет обоих приложений: подписочного (src/routes/onboarding.tsx)
// и пакетного (src/formats/packages/onboarding.tsx). Ответы — member_profiles.

export function OnboardingLoading() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center">
      <Refresh className="h-6 w-6 text-muted-foreground animate-spin" weight="BoldDuotone" />
    </div>
  );
}

/** Шапка шага: «Назад» и прогресс «N/всего». */
export function StepHeader({
  step,
  total,
  onBack,
}: {
  step: number;
  total: number;
  onBack: () => void;
}) {
  const progress = (step / total) * 100;
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-center gap-3 mb-3">
        <button
          type="button"
          onClick={onBack}
          className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          aria-label="Назад"
        >
          <AltArrowLeft className="h-5 w-5" weight="BoldDuotone" />
        </button>
        <div className="flex-1">
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {step}/{total}
        </span>
      </div>
    </div>
  );
}

/** Подвал шага: «Далее», на последнем — «Завершить». */
export function StepFooter({
  disabled,
  saving,
  last,
  onNext,
}: {
  disabled: boolean;
  saving: boolean;
  last: boolean;
  onNext: () => void;
}) {
  return (
    <div className="px-4 pb-6 pt-2 space-y-2 border-t border-border/40">
      <Button
        className="w-full h-12 text-base font-semibold"
        disabled={disabled || saving}
        onClick={onNext}
      >
        {saving ? (
          <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
        ) : last ? (
          "Завершить"
        ) : (
          "Далее"
        )}
      </Button>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col h-[100dvh] bg-background">{children}</div>;
}

/* ===== Reusable controls ===== */

export function OptionButton({
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
          ? "bg-primary text-primary-foreground border-primary font-semibold"
          : "bg-card text-card-foreground border-border hover:border-foreground/30"
      }`}
    >
      {children}
    </button>
  );
}

export function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-2xl font-semibold leading-tight">{title}</h2>
      {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/* ===== Вопросы =====
   Заголовки (STEP_TITLES, lib/onboarding.ts) и варианты ответов (…Options) — отдельно: в
   подписочной анкете они идут одним блоком (Step…), в пакетной заголовок —
   в тёмной шапке, варианты — в белой панели. */

function ChoiceList<T extends string | number>({
  opts,
  isActive,
  onPick,
}: {
  opts: { v: T; label: string }[];
  isActive: (v: T) => boolean;
  onPick: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      {opts.map((o) => (
        <OptionButton key={o.v} active={isActive(o.v)} onClick={() => onPick(o.v)}>
          {o.label}
        </OptionButton>
      ))}
    </div>
  );
}

const EXPERIENCE_OPTS: { v: Experience; label: string }[] = [
  { v: "beginner", label: "Новичок или большой перерыв" },
  { v: "occasional", label: "Тренируюсь время от времени" },
  { v: "regular", label: "Регулярно, 2–3 раза в неделю" },
  { v: "advanced", label: "Опытный, тренируюсь интенсивно" },
];

export function ExperienceOptions({
  value,
  onChange,
}: {
  value: Experience | null;
  onChange: (v: Experience) => void;
}) {
  return <ChoiceList opts={EXPERIENCE_OPTS} isActive={(v) => value === v} onPick={onChange} />;
}

const ACTIVITY_OPTS: { v: number; label: string }[] = [
  { v: 0, label: "Почти не двигаюсь" },
  { v: 1, label: "1 раз в неделю" },
  { v: 3, label: "2–3 раза в неделю" },
  { v: 5, label: "4 и больше" },
];

export function ActivityOptions({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return <ChoiceList opts={ACTIVITY_OPTS} isActive={(v) => value === v} onPick={onChange} />;
}

const HEALTH_OPTS: { v: HealthFlag; label: string }[] = [
  { v: "back_joints", label: "Спина или суставы" },
  { v: "cardio_pressure", label: "Сердце или давление" },
  { v: "recent_injury", label: "Недавняя травма или операция" },
  { v: "pregnancy", label: "Беременность" },
  { v: "chronic", label: "Хроническое заболевание" },
  { v: "none", label: "Ничего из перечисленного" },
];

export function HealthOptions({
  flags,
  onChange,
}: {
  flags: HealthFlag[];
  onChange: (v: HealthFlag[]) => void;
}) {
  const toggle = (f: HealthFlag) => {
    if (f === "none") {
      onChange(["none"]);
      return;
    }
    const next = flags.includes(f)
      ? flags.filter((x) => x !== f)
      : [...flags.filter((x) => x !== "none"), f];
    onChange(next);
  };
  return <ChoiceList opts={HEALTH_OPTS} isActive={(v) => flags.includes(v)} onPick={toggle} />;
}

export function HealthNotesInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Textarea
      id="health_notes"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Необязательно"
      rows={3}
      className="resize-none"
    />
  );
}

function tileClass(active: boolean) {
  return `h-12 rounded-xl border font-semibold transition-colors ${
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-card border-border hover:border-foreground/30"
  }`;
}

export function FrequencyPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {[1, 2, 3, 4].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={tileClass(value === n)}
        >
          {n === 4 ? "4+" : n}
        </button>
      ))}
    </div>
  );
}

const TIME_OPTS: { v: PrefTime; label: string }[] = [
  { v: "morning", label: "Утро" },
  { v: "day", label: "День" },
  { v: "evening", label: "Вечер" },
];

export function TimesPicker({
  value,
  onChange,
}: {
  value: PrefTime[];
  onChange: (v: PrefTime[]) => void;
}) {
  const toggle = (t: PrefTime) =>
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div className="grid grid-cols-3 gap-2">
      {TIME_OPTS.map((t) => (
        <button
          key={t.v}
          type="button"
          onClick={() => toggle(t.v)}
          className={tileClass(value.includes(t.v))}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const REFERRAL_OPTS: { v: Referral; label: string }[] = [
  { v: "instagram", label: "Instagram / соцсети" },
  { v: "referral", label: "Рекомендация друга" },
  { v: "walk_by", label: "Проходил(а) мимо" },
  { v: "search", label: "Поиск / карты" },
  { v: "other", label: "Другое" },
];

export function ReferralOptions({
  value,
  onChange,
}: {
  value: Referral | null;
  onChange: (v: Referral) => void;
}) {
  return <ChoiceList opts={REFERRAL_OPTS} isActive={(v) => value === v} onPick={onChange} />;
}

/* ===== Шаги подписочной анкеты: заголовок + варианты ===== */

export function StepExperience(props: {
  value: Experience | null;
  onChange: (v: Experience) => void;
}) {
  return (
    <div>
      <StepTitle {...STEP_TITLES.experience} />
      <ExperienceOptions {...props} />
    </div>
  );
}

export function StepActivity(props: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div>
      <StepTitle {...STEP_TITLES.activity} />
      <ActivityOptions {...props} />
    </div>
  );
}

export function StepHealth({
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
  return (
    <div>
      <StepTitle {...STEP_TITLES.health} />
      <HealthOptions flags={flags} onChange={onFlagsChange} />
      {hasHealthIssues(flags) && (
        <div className="mt-5 space-y-2">
          <Label htmlFor="health_notes">{HEALTH_NOTES_LABEL}</Label>
          <HealthNotesInput value={notes} onChange={onNotesChange} />
        </div>
      )}
    </div>
  );
}

export function StepLogistics({
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
  return (
    <div className="space-y-6">
      <StepTitle {...STEP_TITLES.logistics} />
      <div>
        <Label className="text-sm">{FREQUENCY_LABEL}</Label>
        <div className="mt-2">
          <FrequencyPicker value={frequency} onChange={onFreqChange} />
        </div>
      </div>
      <div>
        <Label className="text-sm">{TIMES_LABEL}</Label>
        <div className="mt-2">
          <TimesPicker value={times} onChange={onTimesChange} />
        </div>
      </div>
    </div>
  );
}

export function StepReferral(props: { value: Referral | null; onChange: (v: Referral) => void }) {
  return (
    <div>
      <StepTitle {...STEP_TITLES.referral} />
      <ReferralOptions {...props} />
    </div>
  );
}
