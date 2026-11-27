import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AltArrowLeft,
  Camera,
  CheckCircle,
  CloseCircle,
  QuestionCircle,
  Refresh,
} from "@solar-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RulerPicker } from "@/components/ui/ruler-picker";
import { Textarea } from "@/components/ui/textarea";
import { DarkFrame } from "@/formats/packages/dark-frame";
import { msg, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  diagnosticFormQuery,
  diagnosticPhotosQuery,
  removeDiagnosticPhotos,
  saveDiagnostic,
  uploadDiagnosticPhoto,
  type BodyDiagnostic,
  type DiagnosticFields,
  type DiagnosticFormData,
} from "./data";
import {
  BALANCE_HINT,
  BALANCE_OPTIONS,
  BEND_NOT_REACH,
  DIRECTIONS,
  FORWARD_BEND_HINTS,
  FORWARD_BEND_OPTIONS,
  GOAL_GROUPS,
  MAX_PHOTOS,
  RESTRICTIONS,
  STAGES,
  TRAINING_PRESETS,
} from "./options";
import { recFocusText } from "./texts";

/**
 * Форма диагностики тела для тренера (решение владельца 2026-11-27: перенос
 * из прежнего продукта на Lovable — те же шаги и поля). Открывается кнопкой
 * «Заполнить» у диагностики в «Моём расписании» (/trainer-diagnostic?entry=…&client=…).
 * Имя и телефон — из карточки клиента (тренер их не правит), дата
 * рождения — из анкеты или карточки, дата диагностики — день занятия.
 * Пока форма открыта, черновик хранится на телефоне (вылетело приложение —
 * ответы не пропали); фото загружаются сразу при выборе. Сохранение — RPC
 * trainer_save_diagnostic, повтор — правка той же диагностики.
 */

const STEPS = [
  { key: "client", title: msg("Клиент") },
  { key: "health", title: msg("Здоровье") },
  { key: "goals", title: msg("Цели") },
  { key: "body", title: msg("Замеры") },
  { key: "recs", title: msg("Рекомендации") },
] as const;

const EMPTY: DiagnosticFields = {
  birth_date: null,
  activity_level: null,
  emotional_level: null,
  emotional_comment: null,
  directions: [],
  no_restrictions: false,
  restrictions: [],
  restrictions_other: null,
  goals: [],
  priority_today: null,
  measure_skipped: false,
  chest_cm: null,
  waist_cm: null,
  hips_cm: null,
  weight_kg: null,
  balance_test: null,
  balance_comment: null,
  forward_bend: null,
  forward_bend_cm: null,
  forward_bend_comment: null,
  split_right_cm: null,
  split_left_cm: null,
  split_middle_cm: null,
  photo_paths: [],
  stage: null,
  rec_trainings: null,
  rec_directions: [],
  rec_focus: null,
};

function pickFields(d: BodyDiagnostic): DiagnosticFields {
  const out = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof DiagnosticFields)[]) {
    (out as Record<string, unknown>)[k] = d[k];
  }
  return out;
}

/** Новая диагностика: замеры — с прошлой (если была), иначе как в прежней форме. */
function initialFields(data: DiagnosticFormData): DiagnosticFields {
  if (data.diagnostic) return pickFields(data.diagnostic);
  const prev = data.previous;
  return {
    ...EMPTY,
    birth_date: data.client.birth_date ?? prev?.birth_date ?? null,
    chest_cm: prev?.chest_cm ?? 90,
    waist_cm: prev?.waist_cm ?? 60,
    hips_cm: prev?.hips_cm ?? 90,
  };
}

type Draft = { fields: DiagnosticFields; step: number; savedAt: string | null };

function draftKey(entry: string, client: string) {
  return `base40.diagnostic-draft.${entry}.${client}`;
}

function readDraft(entry: string, client: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(entry, client));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(entry: string, client: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(draftKey(entry, client), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(entry, client));
  } catch {
    // Нет хранилища (приватный режим) — без черновика.
  }
}

export function DiagnosticFormPage({ entryId, clientId }: { entryId: string; clientId: string }) {
  const t = useT();
  const query = useQuery(diagnosticFormQuery(entryId, clientId));

  if (query.isPending && !query.data) {
    return (
      <Overlay>
        <DarkFrame header={<div className="h-24" />} footer={null}>
          <div className="flex h-40 items-center justify-center">
            <Refresh className="h-6 w-6 animate-spin text-muted-foreground" weight="BoldDuotone" />
          </div>
        </DarkFrame>
      </Overlay>
    );
  }
  if (!query.data) {
    return (
      <Overlay>
        <MessageFrame
          title={t("Не удалось открыть диагностику")}
          text={t(
            "Диагностика доступна тренеру, который её проводит, и только записанному клиенту.",
          )}
        />
      </Overlay>
    );
  }
  if (!query.data.entry.editable) {
    return (
      <Overlay>
        <MessageFrame
          title={t("Диагностику уже нельзя изменить")}
          text={t("Заполнить или поправить диагностику можно в течение 14 дней после занятия.")}
        />
      </Overlay>
    );
  }
  return (
    <Overlay>
      <DiagnosticForm data={query.data} entryId={entryId} clientId={clientId} />
    </Overlay>
  );
}

/** Поверх нижнего меню и шапки разделов. */
function Overlay({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-50">{children}</div>;
}

function useGoBack() {
  const navigate = useNavigate();
  return () => {
    if (window.history.length > 1) window.history.back();
    else navigate({ to: "/", replace: true });
  };
}

function MessageFrame({ title, text }: { title: string; text: string }) {
  const t = useT();
  const back = useGoBack();
  return (
    <DarkFrame
      tall
      header={
        <div className="px-6 pt-2 pb-10">
          <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
        </div>
      }
      footer={
        <Button className="w-full" onClick={back}>
          {t("Назад")}
        </Button>
      }
    >
      <p className="px-6 pt-6 text-base text-muted-foreground">{text}</p>
    </DarkFrame>
  );
}

function DiagnosticForm({
  data,
  entryId,
  clientId,
}: {
  data: DiagnosticFormData;
  entryId: string;
  clientId: string;
}) {
  const t = useT();
  const back = useGoBack();
  const queryClient = useQueryClient();
  const savedAt = data.diagnostic?.updated_at ?? null;
  // Черновик — только если он сделан поверх той же сохранённой версии.
  const [initial] = useState(() => {
    const draft = readDraft(entryId, clientId);
    if (draft && draft.savedAt === savedAt) return draft;
    return { fields: initialFields(data), step: 0, savedAt };
  });
  const [f, setF] = useState<DiagnosticFields>(initial.fields);
  const [step, setStep] = useState(initial.step);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errKey, setErrKey] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);

  useEffect(() => {
    if (done) return;
    const id = window.setTimeout(
      () => writeDraft(entryId, clientId, { fields: f, step, savedAt }),
      300,
    );
    return () => window.clearTimeout(id);
  }, [f, step, savedAt, entryId, clientId, done]);

  useEffect(() => {
    document.querySelector("[data-dark-frame] .no-scrollbar")?.scrollTo({ top: 0 });
  }, [step]);

  const set = <K extends keyof DiagnosticFields>(key: K, value: DiagnosticFields[K]) =>
    setF((prev) => ({ ...prev, [key]: value }));
  const toggleIn = (key: "directions" | "restrictions" | "goals" | "rec_directions", v: string) =>
    setF((prev) => ({
      ...prev,
      [key]: prev[key].includes(v) ? prev[key].filter((x) => x !== v) : [...prev[key], v],
    }));

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function fail(message: string, key: string) {
    setErrKey(key);
    toast.error(message);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-field="${key}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }

  /** Первое незаполненное обязательное поле шага: [текст, поле] или null. */
  function missing(): [string, string] | null {
    if (step === 0) {
      if (!f.birth_date) return [t("Укажите дату рождения"), "birth"];
      if (f.activity_level == null) return [t("Выберите уровень активности"), "activity"];
    }
    if (
      step === 1 &&
      !f.no_restrictions &&
      f.restrictions.length === 0 &&
      !f.restrictions_other?.trim()
    )
      return [t("Отметьте ограничения или выберите «Ограничений нет»"), "restrictions"];
    if (step === 2) {
      if (f.goals.length === 0) return [t("Выберите хотя бы одну цель"), "goals"];
      if (!f.priority_today?.trim())
        return [t("Заполните «Что наиболее актуально сегодня»"), "priority"];
    }
    if (step === 3 && !f.balance_test)
      return [t("Выберите результат теста на равновесие"), "balance"];
    if (step === 4) {
      if (f.stage == null) return [t("Выберите этап тренировочного процесса"), "stage"];
      if (!f.rec_trainings?.trim())
        return [t("Укажите рекомендацию по тренировкам"), "recTrainings"];
      if (f.rec_directions.length === 0 && !f.rec_focus?.trim())
        return [t("Выберите рекомендованные направления"), "recFocus"];
    }
    return null;
  }

  function validate(): boolean {
    const m = missing();
    if (m) {
      fail(m[0], m[1]);
      return false;
    }
    setErrKey(null);
    return true;
  }

  async function submit() {
    setSaving(true);
    try {
      await saveDiagnostic(entryId, clientId, {
        ...f,
        forward_bend_cm: f.forward_bend === BEND_NOT_REACH ? f.forward_bend_cm : null,
      });
      void removeDiagnosticPhotos(removed);
      writeDraft(entryId, clientId, null);
      void queryClient.invalidateQueries({ queryKey: ["trainer-diagnostics-state"] });
      void queryClient.invalidateQueries({ queryKey: ["trainer-diagnostics-todo"] });
      void queryClient.invalidateQueries({
        queryKey: ["trainer-diagnostic-form", entryId, clientId],
      });
      setDone(true);
    } catch (e) {
      toast.error(t("Не удалось сохранить, попробуйте ещё раз: {error}", { error: errorText(e) }));
    } finally {
      setSaving(false);
    }
  }

  function next() {
    if (!validate()) return;
    if (isLast) void submit();
    else setStep(step + 1);
  }

  if (done) {
    return (
      <DarkFrame
        tall
        header={
          <div className="px-6 pt-2 pb-10">
            <CheckCircle className="mb-4 h-14 w-14 text-primary" weight="BoldDuotone" />
            <h1 className="text-3xl font-semibold leading-tight">{t("Диагностика сохранена")}</h1>
          </div>
        }
        footer={
          <Button className="w-full" onClick={back}>
            {t("Готово")}
          </Button>
        }
      >
        <p className="px-6 pt-6 text-base text-muted-foreground">
          {t(
            "Клиент уже видит её в приложении: в расписании, во вкладке «Диагностика». Поправить ответы можно в течение 14 дней — кнопкой у диагностики.",
          )}
        </p>
      </DarkFrame>
    );
  }

  const err = (k: string) => (errKey === k ? "ring-2 ring-destructive/50" : "");
  const dateLabel = t.date(`${data.entry.date}T12:00:00`, { day: "numeric", month: "long" });

  return (
    <DarkFrame
      top={
        <div className="px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (step === 0 ? back() : setStep(step - 1))}
              className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition active:bg-white/20"
              aria-label={t("Назад")}
            >
              <AltArrowLeft className="h-5 w-5" weight="BoldDuotone" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 text-xs font-semibold text-white/70 tabular-nums">
                {t("Шаг {step} из {total}", { step: step + 1, total: STEPS.length })}
              </div>
              <div className="flex gap-1">
                {STEPS.map((s, i) => (
                  <span
                    key={s.key}
                    className={`h-1.5 flex-1 rounded-full transition duration-300 ${
                      i <= step ? "bg-white" : "bg-white/20"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      }
      header={
        <div className="px-4 pt-5 pb-8">
          <h1 className="text-2xl font-semibold leading-tight">{t(current.title)}</h1>
          <p className="frame-hide-typing mt-1 text-sm text-white/70">
            {t("Диагностика {date} · {name}", {
              date: dateLabel,
              name: data.client.name ?? t("Клиент"),
            })}
          </p>
        </div>
      }
      footer={
        <Button className="w-full" onClick={next} disabled={saving}>
          {saving ? (
            <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
          ) : isLast ? (
            t("Сохранить диагностику")
          ) : (
            t("Далее")
          )}
        </Button>
      }
    >
      <div onClickCapture={() => setErrKey(null)}>
        {current.key === "client" && (
          <Blocks>
            <Block title={t("Из карточки клиента")}>
              <InfoRow label={t("Имя и фамилия")} value={data.client.name ?? "—"} />
              <InfoRow label={t("Телефон")} value={data.client.phone ?? "—"} />
              <InfoRow label={t("Дата диагностики")} value={dateLabel} />
              {data.entry.studio_name && (
                <InfoRow label={t("Студия")} value={data.entry.studio_name} />
              )}
            </Block>
            <Block title={t("Дата рождения")} required>
              <div data-field="birth" className={cn("rounded-2xl", err("birth"))}>
                <Input
                  type="date"
                  value={f.birth_date ?? ""}
                  min="1940-01-01"
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => set("birth_date", e.target.value || null)}
                  aria-label={t("Дата рождения")}
                  className="text-base font-semibold"
                />
              </div>
            </Block>
            <Block
              title={t("Уровень активности")}
              hint={t("0 — не двигается, 10 — спортсмен")}
              required
            >
              <div data-field="activity" className={cn("rounded-xl", err("activity"))}>
                <NumberGrid
                  from={0}
                  to={10}
                  cols={6}
                  value={f.activity_level}
                  onChange={(v) => set("activity_level", v)}
                />
              </div>
            </Block>
            <Block
              title={t("Как вы оцениваете своё эмоциональное состояние сейчас?")}
              hint={t("1 — тяжело, 10 — отлично")}
            >
              <NumberGrid
                from={1}
                to={10}
                cols={5}
                value={f.emotional_level}
                onChange={(v) => set("emotional_level", v)}
              />
              <Textarea
                className="mt-3"
                rows={3}
                maxLength={2000}
                value={f.emotional_comment ?? ""}
                onChange={(e) => set("emotional_comment", e.target.value)}
                placeholder={t("Комментарий: сон, стресс на работе, тревожность — словами клиента")}
              />
            </Block>
            <Block title={t("Первое занятие")} hint={t("можно выбрать несколько")}>
              <div className="grid grid-cols-2 gap-2">
                {DIRECTIONS.map((d) => (
                  <Tile
                    key={d}
                    active={f.directions.includes(d)}
                    onClick={() => toggleIn("directions", d)}
                  >
                    {d}
                  </Tile>
                ))}
              </div>
            </Block>
          </Blocks>
        )}

        {current.key === "health" && (
          <Blocks>
            <Block
              title={t("Ограничения по здоровью")}
              hint={t("Отметьте всё, что есть у клиента, или «Ограничений нет»")}
              required
            >
              <div
                data-field="restrictions"
                className={cn("space-y-2 rounded-xl", err("restrictions"))}
              >
                <Choice
                  active={f.no_restrictions}
                  onClick={() =>
                    setF((p) => ({
                      ...p,
                      no_restrictions: !p.no_restrictions,
                      restrictions: p.no_restrictions ? p.restrictions : [],
                    }))
                  }
                >
                  {t("Ограничений нет")}
                </Choice>
                <div
                  className={cn("space-y-2", f.no_restrictions && "pointer-events-none opacity-40")}
                >
                  {RESTRICTIONS.map((r) => (
                    <Choice
                      key={r}
                      active={f.restrictions.includes(r)}
                      onClick={() => toggleIn("restrictions", r)}
                    >
                      {t(r)}
                    </Choice>
                  ))}
                </div>
              </div>
            </Block>
            <Block title={t("Другое")} hint={t("необязательно")}>
              <Textarea
                rows={4}
                maxLength={2000}
                disabled={f.no_restrictions}
                value={f.restrictions_other ?? ""}
                onChange={(e) => set("restrictions_other", e.target.value)}
                placeholder={t("Что важно учитывать на тренировке")}
              />
            </Block>
          </Blocks>
        )}

        {current.key === "goals" && (
          <Blocks>
            <Block title={t("Цели клиента")} hint={t("выберите хотя бы одну")} required>
              <div data-field="goals" className={cn("space-y-5 rounded-xl", err("goals"))}>
                {GOAL_GROUPS.map((g) => (
                  <div key={g.title} className="space-y-2">
                    <div className="text-base font-semibold text-primary">{t(g.title)}</div>
                    {g.items.map((i) => (
                      <Choice
                        key={i}
                        active={f.goals.includes(i)}
                        onClick={() => toggleIn("goals", i)}
                      >
                        {t(i)}
                      </Choice>
                    ))}
                  </div>
                ))}
              </div>
            </Block>
            <Block title={t("Что наиболее актуально сегодня")} required>
              <div data-field="priority" className={cn("rounded-2xl", err("priority"))}>
                <Textarea
                  rows={4}
                  maxLength={2000}
                  value={f.priority_today ?? ""}
                  onChange={(e) => set("priority_today", e.target.value)}
                  placeholder={t("Словами клиента")}
                />
              </div>
            </Block>
          </Blocks>
        )}

        {current.key === "body" && (
          <BodyStep
            f={f}
            set={set}
            setF={setF}
            err={err}
            clientId={clientId}
            onRemovePhoto={(p) => setRemoved((r) => [...r, p])}
          />
        )}

        {current.key === "recs" && (
          <Blocks>
            <Block title={t("Этап тренировочного процесса")} required>
              <div data-field="stage" className={cn("space-y-2 rounded-xl", err("stage"))}>
                {STAGES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => set("stage", s.key)}
                    aria-pressed={f.stage === s.key}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition",
                      f.stage === s.key
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border-border bg-card",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                        f.stage === s.key ? "border-primary" : "border-muted-foreground/40",
                      )}
                    >
                      {f.stage === s.key && <span className="h-3 w-3 rounded-full bg-primary" />}
                    </span>
                    <span>
                      <span className="block font-semibold">
                        {t("Этап {n} — {title}", { n: s.key, title: t(s.title) })}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {t(s.volume)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Block>
            <TrainingsBlock f={f} set={set} err={err} />
            <FocusBlock f={f} set={set} toggle={(d) => toggleIn("rec_directions", d)} err={err} />
          </Blocks>
        )}
      </div>
    </DarkFrame>
  );
}

function errorText(e: unknown) {
  const m = (e as { message?: string } | null)?.message ?? String(e);
  return m.replace(/^diagnostic_/, "");
}

// ---- Шаг «Замеры» ----

function BodyStep({
  f,
  set,
  setF,
  err,
  clientId,
  onRemovePhoto,
}: {
  f: DiagnosticFields;
  set: <K extends keyof DiagnosticFields>(key: K, value: DiagnosticFields[K]) => void;
  setF: React.Dispatch<React.SetStateAction<DiagnosticFields>>;
  err: (k: string) => string;
  clientId: string;
  onRemovePhoto: (path: string) => void;
}) {
  const t = useT();
  const [bendHint, setBendHint] = useState(false);
  const measures: {
    key: "chest_cm" | "waist_cm" | "hips_cm";
    label: string;
    min: number;
    max: number;
  }[] = [
    { key: "chest_cm", label: t("Обхват груди"), min: 50, max: 160 },
    { key: "waist_cm", label: t("Обхват талии"), min: 40, max: 140 },
    { key: "hips_cm", label: t("Обхват бёдер"), min: 50, max: 170 },
  ];
  const splits: { key: "split_right_cm" | "split_left_cm" | "split_middle_cm"; label: string }[] = [
    { key: "split_right_cm", label: t("Правый продольный шпагат") },
    { key: "split_left_cm", label: t("Левый продольный шпагат") },
    { key: "split_middle_cm", label: t("Поперечный шпагат") },
  ];

  return (
    <Blocks>
      <Block title={t("Антропометрия")} hint={t("По желанию клиентки — можно пропустить")}>
        <div className={cn("space-y-6", f.measure_skipped && "pointer-events-none opacity-40")}>
          {measures.map((m) => (
            <div key={m.key}>
              <div className="mb-2 text-sm font-semibold">{m.label}</div>
              <RulerPicker
                min={m.min}
                max={m.max}
                value={f[m.key]}
                onChange={(v) => set(m.key, v)}
                unit={t("см")}
              />
            </div>
          ))}
          <div>
            <div className="mb-2 text-sm font-semibold">
              {t("Вес")}{" "}
              <span className="font-normal text-muted-foreground">· {t("необязательно")}</span>
            </div>
            {f.weight_kg != null ? (
              <>
                <RulerPicker
                  min={35}
                  max={150}
                  value={f.weight_kg}
                  onChange={(v) => set("weight_kg", v)}
                  unit={t("кг")}
                />
                <button
                  type="button"
                  onClick={() => set("weight_kg", null)}
                  className="mt-2 text-sm font-semibold text-primary"
                >
                  {t("Не указывать вес")}
                </button>
              </>
            ) : (
              <DashedButton onClick={() => set("weight_kg", 60)}>{t("Указать вес")}</DashedButton>
            )}
          </div>
        </div>
        <div className="mt-5">
          <Choice
            active={f.measure_skipped}
            onClick={() => set("measure_skipped", !f.measure_skipped)}
          >
            {t("Клиент отказался от проведения замеров")}
          </Choice>
        </div>
      </Block>

      <Block title={t("Тест на равновесие")} required>
        <div data-field="balance" className={cn("space-y-2 rounded-xl", err("balance"))}>
          {BALANCE_OPTIONS.map((b) => (
            <Choice
              key={b}
              round
              active={f.balance_test === b}
              onClick={() => set("balance_test", f.balance_test === b ? null : b)}
            >
              {t(b)}
            </Choice>
          ))}
        </div>
        <Textarea
          className="mt-3"
          rows={3}
          maxLength={2000}
          value={f.balance_comment ?? ""}
          onChange={(e) => set("balance_comment", e.target.value)}
          placeholder={t("Комментарий тренера. {hint}", { hint: t(BALANCE_HINT) })}
        />
      </Block>

      <Block title={t("Наклон вперёд")} hint={t("необязательно")}>
        <div className="space-y-2">
          {FORWARD_BEND_OPTIONS.map((b) => (
            <Choice
              key={b}
              round
              active={f.forward_bend === b}
              onClick={() =>
                setF((p) => ({
                  ...p,
                  forward_bend: p.forward_bend === b ? null : b,
                  forward_bend_cm: b === BEND_NOT_REACH ? (p.forward_bend_cm ?? 10) : null,
                }))
              }
            >
              {t(b)}
            </Choice>
          ))}
        </div>
        {f.forward_bend === BEND_NOT_REACH && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold">{t("Сколько см до пола")}</div>
            <RulerPicker
              min={1}
              max={60}
              value={f.forward_bend_cm}
              onChange={(v) => set("forward_bend_cm", v)}
              unit={t("см")}
            />
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{t("Комментарий тренера")}</span>
          <button
            type="button"
            onClick={() => setBendHint((v) => !v)}
            className="flex items-center gap-1 text-sm font-semibold text-primary"
            aria-expanded={bendHint}
          >
            <QuestionCircle className="h-5 w-5" weight="BoldDuotone" />
            {t("На что смотрим")}
          </button>
        </div>
        {bendHint && (
          <ul className="mt-2 space-y-1.5 rounded-xl bg-muted p-3 text-sm leading-snug text-muted-foreground">
            {FORWARD_BEND_HINTS.map((h) => (
              <li key={h}>• {t(h)}</li>
            ))}
          </ul>
        )}
        <Textarea
          className="mt-2"
          rows={3}
          maxLength={2000}
          value={f.forward_bend_comment ?? ""}
          onChange={(e) => set("forward_bend_comment", e.target.value)}
          placeholder={t("Что важно отметить по наклону")}
        />
      </Block>

      <Block
        title={t("Расстояние до пола в шпагате")}
        hint={t("Необязательно — можно заполнить один или несколько вариантов")}
      >
        <div className="space-y-5">
          {splits.map((s) => (
            <div key={s.key}>
              <div className="mb-2 text-sm font-semibold">
                {s.label}{" "}
                <span className="font-normal text-muted-foreground">· {t("см до пола")}</span>
              </div>
              {f[s.key] != null ? (
                <>
                  <RulerPicker
                    min={0}
                    max={100}
                    value={f[s.key]}
                    onChange={(v) => set(s.key, v)}
                    unit={t("см")}
                  />
                  <button
                    type="button"
                    onClick={() => set(s.key, null)}
                    className="mt-2 text-sm font-semibold text-primary"
                  >
                    {t("Не указывать")}
                  </button>
                </>
              ) : (
                <DashedButton onClick={() => set(s.key, 20)}>{t("Добавить замер")}</DashedButton>
              )}
            </div>
          ))}
        </div>
      </Block>

      <PhotosBlock
        clientId={clientId}
        paths={f.photo_paths}
        onChange={(paths) => set("photo_paths", paths)}
        onRemove={onRemovePhoto}
      />
    </Blocks>
  );
}

function PhotosBlock({
  clientId,
  paths,
  onChange,
  onRemove,
}: {
  clientId: string;
  paths: string[];
  onChange: (paths: string[]) => void;
  onRemove: (path: string) => void;
}) {
  const t = useT();
  const [uploading, setUploading] = useState(0);
  const urls = useQuery(diagnosticPhotosQuery(paths));
  // Свежезагруженные — сразу с телефона, пока нет подписанной ссылки.
  const [local, setLocal] = useState<Record<string, string>>({});
  const latest = useRef(paths);
  latest.current = paths;

  useEffect(() => () => Object.values(local).forEach((u) => URL.revokeObjectURL(u)), [local]);

  async function add(files: File[]) {
    const room = MAX_PHOTOS - paths.length - uploading;
    if (files.length > room) toast.error(t("Можно добавить не более 5 фотографий"));
    const list = files.slice(0, Math.max(0, room));
    if (list.length === 0) return;
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const path = await uploadDiagnosticPhoto(clientId, file);
        setLocal((m) => ({ ...m, [path]: URL.createObjectURL(file) }));
        latest.current = [...latest.current, path];
        onChange(latest.current);
      } catch (e) {
        const bad = (e as Error)?.message === "bad_image";
        toast.error(
          bad
            ? t("Не удалось открыть фото. Выберите снимок в формате JPG или PNG.")
            : t("Не удалось загрузить фото: {error}", { error: errorText(e) }),
        );
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  return (
    <Block title={t("Фотографии клиентки")}>
      <p className="-mt-1 mb-3 text-sm leading-relaxed text-muted-foreground">
        {t(
          "Желательно добавить фотографии для оценки динамики, но только с разрешения клиентки. Можно загрузить до 5 фотографий.",
        )}
      </p>
      {(paths.length > 0 || uploading > 0) && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {paths.map((p, i) => (
            <div key={p} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">
              {(local[p] ?? urls.data?.[p]) && (
                <img
                  src={local[p] ?? urls.data?.[p]}
                  alt={t("Фото {n}", { n: i + 1 })}
                  className="h-full w-full object-cover"
                />
              )}
              <button
                type="button"
                onClick={() => {
                  onRemove(p);
                  onChange(paths.filter((x) => x !== p));
                }}
                className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label={t("Удалить фото {n}", { n: i + 1 })}
              >
                <CloseCircle className="h-5 w-5" weight="Bold" />
              </button>
            </div>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <div
              key={`u${i}`}
              className="flex aspect-[3/4] items-center justify-center rounded-xl bg-muted"
            >
              <Refresh
                className="h-5 w-5 animate-spin text-muted-foreground"
                weight="BoldDuotone"
              />
            </div>
          ))}
        </div>
      )}
      {paths.length + uploading < MAX_PHOTOS && (
        <label className="flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card text-base font-semibold active:opacity-80">
          <Camera className="h-5 w-5 text-primary" weight="BoldDuotone" />
          {t("Добавить фото")}
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void add(files);
            }}
          />
        </label>
      )}
    </Block>
  );
}

// ---- Шаг «Рекомендации» ----

function TrainingsBlock({
  f,
  set,
  err,
}: {
  f: DiagnosticFields;
  set: <K extends keyof DiagnosticFields>(key: K, value: DiagnosticFields[K]) => void;
  err: (k: string) => string;
}) {
  const t = useT();
  const preset = TRAINING_PRESETS.find((p) => p.text === f.rec_trainings);
  const [editing, setEditing] = useState(!!f.rec_trainings && !preset);
  return (
    <Block title={t("Тренировки")} required>
      <div data-field="recTrainings" className={cn("rounded-xl", err("recTrainings"))}>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {TRAINING_PRESETS.map((p) => (
            <Tile
              key={p.label}
              center
              active={f.rec_trainings === p.text}
              onClick={() => {
                set("rec_trainings", p.text);
                setEditing(false);
              }}
            >
              {t(p.label)}
            </Tile>
          ))}
        </div>
        {!editing && preset ? (
          <div className="rounded-xl bg-muted p-4">
            <p className="whitespace-pre-line text-[15px] leading-relaxed">{t(preset.text)}</p>
            <button
              type="button"
              onClick={() => {
                set("rec_trainings", t(preset.text));
                setEditing(true);
              }}
              className="mt-3 text-sm font-semibold text-primary"
            >
              {t("Редактировать текст")}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                "Готовый текст клиент увидит на своём языке. Изменённый — так, как вы его написали.",
              )}
            </p>
          </div>
        ) : (
          <Textarea
            rows={6}
            maxLength={3000}
            value={f.rec_trainings ?? ""}
            onChange={(e) => set("rec_trainings", e.target.value)}
            placeholder={t("Например: рекомендую посещать 3 тренировки в неделю…")}
          />
        )}
      </div>
    </Block>
  );
}

function FocusBlock({
  f,
  set,
  toggle,
  err,
}: {
  f: DiagnosticFields;
  set: <K extends keyof DiagnosticFields>(key: K, value: DiagnosticFields[K]) => void;
  toggle: (d: string) => void;
  err: (k: string) => string;
}) {
  const t = useT();
  const edited = f.rec_focus != null;
  const auto = useMemo(() => recFocusText(f.rec_directions, t), [f.rec_directions, t]);
  return (
    <Block title={t("Рекомендованные направления")} required>
      <div data-field="recFocus" className={cn("rounded-xl", err("recFocus"))}>
        <div className="grid grid-cols-2 gap-2">
          {DIRECTIONS.map((d) => (
            <Tile key={d} active={f.rec_directions.includes(d)} onClick={() => toggle(d)}>
              {d}
            </Tile>
          ))}
        </div>
        {(f.rec_directions.length > 0 || edited) && (
          <div className="mt-3 rounded-xl bg-muted p-4">
            {!edited ? (
              <>
                <p className="text-[15px] leading-relaxed">{auto}</p>
                <button
                  type="button"
                  onClick={() => set("rec_focus", auto)}
                  className="mt-3 text-sm font-semibold text-primary"
                >
                  {t("Редактировать текст")}
                </button>
              </>
            ) : (
              <>
                <Textarea
                  rows={4}
                  maxLength={3000}
                  className="bg-background focus:bg-background"
                  value={f.rec_focus ?? ""}
                  onChange={(e) => set("rec_focus", e.target.value)}
                  placeholder={t("Я рекомендую вам направления…")}
                />
                <p className="mt-2 text-xs text-destructive">
                  {t("Изменённый текст не переводится — клиент увидит его так, как вы написали.")}
                </p>
                <button
                  type="button"
                  onClick={() => set("rec_focus", null)}
                  className="mt-2 text-sm font-semibold text-primary"
                >
                  {t("Вернуть готовый текст")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Block>
  );
}

// ---- Общие элементы ----

function Blocks({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <div className="bg-muted">
      {items.map((child, i) => (
        <div
          key={i}
          className={`bg-background ${i === 0 ? "" : "mt-3 rounded-t-[14px]"} ${
            i === items.length - 1 ? "" : "rounded-b-[14px]"
          }`}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

function Block({
  title,
  hint,
  required = false,
  children,
}: {
  title: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="px-4 pt-5 pb-5">
      <h2 className="text-lg font-semibold leading-tight">
        {title}
        {required && <span className="ml-1 text-destructive">*</span>}
      </h2>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

/** Крупный вариант выбора с галочкой (или кружком у одного из нескольких). */
function Choice({
  active,
  round = false,
  onClick,
  children,
}: {
  active: boolean;
  round?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] leading-snug transition",
        active
          ? "border-primary bg-primary/10 font-medium ring-1 ring-primary"
          : "border-border bg-card",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center border-2",
          round ? "rounded-full" : "rounded-md",
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40",
        )}
      >
        {active && (round ? <span className="h-2.5 w-2.5 rounded-full bg-white" /> : <TickIcon />)}
      </span>
      <span>{children}</span>
    </button>
  );
}

function TickIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Tile({
  active,
  center = false,
  onClick,
  children,
}: {
  active: boolean;
  center?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-[52px] items-center rounded-xl border px-3 text-[15px] leading-snug transition",
        center ? "justify-center text-center font-semibold" : "text-left",
        active
          ? "border-primary bg-primary/10 font-medium ring-1 ring-primary"
          : "border-border bg-card",
      )}
    >
      {children}
    </button>
  );
}

function NumberGrid({
  from,
  to,
  cols,
  value,
  onChange,
}: {
  from: number;
  to: number;
  cols: 5 | 6;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className={cn("grid gap-2", cols === 6 ? "grid-cols-6" : "grid-cols-5")}>
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          aria-pressed={value === n}
          className={cn(
            "h-12 rounded-xl border text-[15px] font-semibold tabular-nums transition",
            value === n
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function DashedButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center justify-center rounded-2xl border border-dashed border-border bg-card text-base font-semibold active:opacity-80"
    >
      {children}
    </button>
  );
}
