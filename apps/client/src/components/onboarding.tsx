import { AltArrowLeft, Refresh } from "@solar-icons/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// Общее для анкет обоих приложений: подписочного (src/routes/onboarding.tsx)
// и пакетного (src/formats/packages/onboarding.tsx). Ответы — member_profiles.

export type Experience = "beginner" | "occasional" | "regular" | "advanced";
export type HealthFlag =
  | "back_joints"
  | "cardio_pressure"
  | "recent_injury"
  | "pregnancy"
  | "chronic"
  | "none";
export type PrefTime = "morning" | "day" | "evening";
export type Referral = "instagram" | "referral" | "walk_by" | "search" | "other";

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

/* ===== Steps ===== */

export function StepExperience({
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

export function StepActivity({
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
    const next = flags.includes(f)
      ? flags.filter((x) => x !== f)
      : [...flags.filter((x) => x !== "none"), f];
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
                  ? "bg-primary text-primary-foreground border-primary"
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
                  ? "bg-primary text-primary-foreground border-primary"
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

export function StepReferral({
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
