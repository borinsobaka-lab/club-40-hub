import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useCatalogStudioIds } from "@/hooks/use-catalog-studios";
import { SCHEMES_KEY, useTrainerPaySchemes } from "@/hooks/use-trainer-pay-schemes";
import { useConfirm } from "@/components/confirm-dialog";
import { StaffOption } from "@/components/employee-photo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckboxOption, FormField, InfoNote, SwitchRow } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PRESET_SCHEMES,
  PRESET_TRIAL_SALE_BONUS,
  cleanBonuses,
  schemeExamples,
  schemeSummary,
  type PayBonus,
  type PayScheme,
  type SchemeWorkout,
} from "@/lib/pay-schemes";
import { formatPay } from "@/lib/payroll";
import type { Employee, PayRates } from "@/lib/staff-directory";

/**
 * «Ставки» → суммы прогрессивной ставки тренера (решение владельца
 * 2026-11-24; схема — db/migrations/2026-11-24_trainer_progressive_pay.sql):
 * у каждого тренера свои схемы оплаты групповых по числу «Посетил»
 * (обычная группа, TRX, гамаки — тренировки выбираются в схеме) и бонус
 * тренеру пробного за абонемент после пробного. Заполняются у всех,
 * действуют у тренеров с форматом «Прогрессивная». Правило расчёта —
 * lib/pay-schemes.ts и pay_scheme_amount в базе; считает «Зарплаты».
 */

const TIPS = {
  trialBonus:
    "Сколько тренер получает, когда клиент купил абонемент после своего первого пробного занятия у этого тренера (в день пробного или позже, один раз на клиента). Задано — 5 % от продаж тренеру при продаже не идут. Пусто — 5 %, как на классической ставке.",
  minAmount: "Оплата за занятие, когда людей мало.",
  minUpTo: "До скольких человек включительно платится минимальная оплата.",
  perPersonRate:
    "Когда людей больше — столько ₾ за каждого пришедшего (а не только сверх минимума).",
  bonuses:
    "Бонус за наполняемость: «от 7 человек +5 ₾», «от 10 человек +10 ₾» — берётся самый крупный порог, до которого дошли.",
  workouts:
    "Тренировки, которые оплачиваются по этой схеме. У тренировки одна схема: выбранная здесь уйдёт из другой схемы тренера.",
  isDefault: "Тренировки без своей схемы оплачиваются по этой. Такая схема у тренера одна.",
  copy: "Перенести суммы другого тренера: его схемы с тренировками и бонус за абонемент после пробного. Нынешние схемы этого тренера заменятся.",
};

type Workout = { id: string; name: string };

const num = (v: string) => Number(v.trim().replace(",", "."));

/** Содержимое окна «Прогрессивная ставка» сотрудника (внутри DialogContent). */
export function TrainerPaySchemes({
  employee,
  rates,
  employees,
  allRates,
  onSaveRates,
  onClose,
}: {
  employee: Employee;
  rates: PayRates | null;
  /** Сотрудники — источники для «Скопировать у…». */
  employees: Employee[];
  allRates: PayRates[];
  onSaveRates: (patch: { trial_sale_bonus: number | null }) => Promise<boolean>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const activeId = useActiveStudioId();
  const [editing, setEditing] = useState<PayScheme | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");

  const schemes = useTrainerPaySchemes();
  const catalogIds = useCatalogStudioIds(activeId);
  const workouts = useQuery({
    queryKey: ["workouts", "pay-schemes", catalogIds?.join(",")],
    queryFn: () =>
      unwrap<Workout[]>(
        supabase.from("workouts").select("id, name").in("studio_id", catalogIds!).order("name"),
      ),
    enabled: !!catalogIds && catalogIds.length > 0,
    meta: { errorMessage: "Не удалось загрузить тренировки" },
  });

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: [SCHEMES_KEY] });
    queryClient.invalidateQueries({ queryKey: ["payroll_lines"] });
  };

  const all = schemes.data?.list ?? [];
  const allLinks = schemes.data?.links ?? [];
  const list = all.filter((s) => s.trainer_id === employee.id);
  const links = allLinks.filter((l) => l.trainer_id === employee.id);
  const workoutName = new Map((workouts.data ?? []).map((w) => [w.id, w.name]));
  const withSchemes = new Set(all.map((s) => s.trainer_id));
  const sources = employees.filter((e) => e.id !== employee.id && withSchemes.has(e.id));
  const trialBonus = rates?.trial_sale_bonus ?? null;

  const insertSchemes = async (
    items: (Omit<PayScheme, "id" | "trainer_id" | "sort_order"> & { workouts?: string[] })[],
  ) => {
    for (const [i, { workouts: own, ...terms }] of items.entries()) {
      const { data, error } = await supabase
        .from("trainer_pay_schemes")
        .insert({ ...terms, trainer_id: employee.id, sort_order: i })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      if (own?.length) {
        const { error: linkErr } = await supabase
          .from("trainer_pay_scheme_workouts")
          .insert(own.map((w) => ({ trainer_id: employee.id, workout_id: w, scheme_id: data.id })));
        if (linkErr) throw linkErr;
      }
    }
  };

  const fillPreset = async () => {
    setBusy(true);
    try {
      // TRX и гамаки — сразу со своими тренировками (по слову в названии): иначе
      // до выбора руками они считались бы по схеме «для остальных» (4 ₾, а не 6 ₾).
      const catalog = workouts.data ?? [];
      const taken = new Set<string>();
      const items = PRESET_SCHEMES.map(({ match, ...terms }) => {
        const own = match
          ? catalog.filter((w) => match.test(w.name) && !taken.has(w.id)).map((w) => w.id)
          : [];
        own.forEach((id) => taken.add(id));
        return { ...terms, workouts: own };
      });
      await insertSchemes(items);
      if (trialBonus == null) await onSaveRates({ trial_sale_bonus: PRESET_TRIAL_SALE_BONUS });
      toast.success(
        taken.size > 0
          ? "Схемы добавлены — проверьте тренировки у TRX и гамаков"
          : "Схемы добавлены — выберите тренировки для TRX и гамаков",
      );
    } catch (e) {
      toast.error("Не удалось добавить схемы: " + (e as Error).message);
    } finally {
      reload();
      setBusy(false);
    }
  };

  const copySchemes = async () => {
    const source = employees.find((e) => e.id === copyFrom);
    if (!source) return;
    if (
      list.length > 0 &&
      !(await confirm({
        title: `Заменить суммы на суммы сотрудника «${source.full_name}»?`,
        description: `Нынешние схемы сотрудника «${employee.full_name}» будут удалены.`,
        confirmLabel: "Заменить",
      }))
    )
      return;
    setBusy(true);
    try {
      if (list.length > 0) {
        const { error } = await supabase
          .from("trainer_pay_schemes")
          .delete()
          .eq("trainer_id", employee.id);
        if (error) throw error;
      }
      await insertSchemes(
        all
          .filter((s) => s.trainer_id === source.id)
          .map((s) => ({
            name: s.name,
            is_default: s.is_default,
            min_amount: s.min_amount,
            min_up_to: s.min_up_to,
            per_person: s.per_person,
            bonuses: s.bonuses,
            workouts: allLinks.filter((l) => l.scheme_id === s.id).map((l) => l.workout_id),
          })),
      );
      const sourceBonus =
        allRates.find((r) => r.trainer_id === source.id)?.trial_sale_bonus ?? null;
      if (sourceBonus !== trialBonus) await onSaveRates({ trial_sale_bonus: sourceBonus });
      setCopyFrom("");
      toast.success("Суммы скопированы");
    } catch (e) {
      toast.error("Не удалось скопировать: " + (e as Error).message);
    } finally {
      reload();
      setBusy(false);
    }
  };

  const remove = async (s: PayScheme) => {
    const ok = await confirm({
      title: `Удалить схему «${s.name}»?`,
      description: s.is_default
        ? "Тренировки без своей схемы будут оплачиваться ставкой «Групповая тренировка», пока не назначите другую схему «для остальных»."
        : "Её тренировки будут оплачиваться по схеме для остальных тренировок.",
      confirmLabel: "Удалить",
    });
    if (!ok) return;
    const { error } = await supabase.from("trainer_pay_schemes").delete().eq("id", s.id);
    if (error) {
      toast.error("Не удалось удалить: " + error.message);
      return;
    }
    reload();
  };

  if (editing !== null)
    return (
      <SchemeForm
        key={editing === "new" ? "new" : editing.id}
        trainerId={employee.id}
        scheme={editing === "new" ? null : editing}
        schemes={list}
        links={links}
        workouts={workouts.data ?? []}
        nextSortOrder={list.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
    );

  const copyControl = sources.length > 0 && (
    <FormField label="Скопировать у сотрудника" tip={TIPS.copy} htmlFor={null} optional>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={copyFrom} onValueChange={setCopyFrom}>
          <SelectTrigger className="w-64 max-w-full">
            <SelectValue placeholder="Выберите сотрудника" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                <StaffOption name={e.full_name} photo={e.photo_url} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={!copyFrom || busy} onClick={copySchemes}>
          {busy && <Loader2 className="animate-spin" />} Скопировать
        </Button>
      </div>
    </FormField>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Прогрессивная ставка — {employee.full_name}</DialogTitle>
        <DialogDescription>
          Оплата групповой тренировки по числу пришедших клиентов («Посетил»), в любом клубе.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          {rates?.pay_format !== "progressive" && (
            <InfoNote>
              Сейчас у сотрудника классическая ставка. Суммы сохранятся и начнут действовать, когда
              переключите формат оплаты на «Прогрессивная».
            </InfoNote>
          )}
          <TrialBonusField
            key={trialBonus ?? ""}
            value={trialBonus}
            onSave={(v) => onSaveRates({ trial_sale_bonus: v })}
          />

          {schemes.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Загрузка схем…
            </div>
          ) : list.length === 0 ? (
            <InfoNote>
              <div className="space-y-3">
                <p>
                  Схем ещё нет. Можно заполнить условиями купленной студии: до 3 человек — 15 ₾,
                  больше — 4 ₾ за человека на коврике и 6 ₾ на TRX и гамаках; от 7 человек +5 ₾, от
                  10 — +10 ₾; +10 ₾ тренеру пробного за абонемент после пробного. Суммы потом можно
                  поменять.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={fillPreset} disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />} Заполнить условиями студии
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                    <Plus /> Своя схема
                  </Button>
                </div>
              </div>
            </InfoNote>
          ) : (
            <>
              <ul className="grid gap-3 sm:grid-cols-2">
                {list.map((s) => {
                  const own = links.filter((l) => l.scheme_id === s.id);
                  return (
                    <li key={s.id} className="flex flex-col gap-2 rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{s.name}</div>
                          {s.is_default && (
                            <Badge variant="outline" className="mt-1">
                              Остальные тренировки
                            </Badge>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Изменить «${s.name}»`}
                            onClick={() => setEditing(s)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Удалить «${s.name}»`}
                            onClick={() => remove(s)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm">{schemeSummary(s, formatPay)}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {schemeExamples(s)
                          .map((e) => `${e.people} чел. — ${formatPay(e.amount)}`)
                          .join(" · ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {own.length > 0
                          ? own.map((l) => workoutName.get(l.workout_id) ?? "—").join(", ")
                          : s.is_default
                            ? "Все тренировки без своей схемы"
                            : "Тренировки не выбраны"}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                <Plus /> Добавить схему
              </Button>
            </>
          )}
          {copyControl}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Готово</Button>
      </DialogFooter>
      {confirmDialog}
    </>
  );
}

function TrialBonusField({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<boolean>;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const commit = async () => {
    const t = text.trim();
    const v = t === "" ? null : num(t);
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      toast.error("Сумма — неотрицательное число");
      setText(value == null ? "" : String(value));
      return;
    }
    if (v === value) return;
    if (!(await onSave(v))) setText(value == null ? "" : String(value));
  };
  return (
    <FormField label="За абонемент после пробного, ₾" tip={TIPS.trialBonus} optional>
      <Input
        inputMode="decimal"
        value={text}
        placeholder="5 % с продажи"
        className="sm:w-64"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </FormField>
  );
}

function SchemeForm({
  trainerId,
  scheme,
  schemes,
  links,
  workouts,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  trainerId: string;
  scheme: PayScheme | null;
  schemes: PayScheme[];
  links: SchemeWorkout[];
  workouts: Workout[];
  nextSortOrder: number;
  /** Назад к списку схем сотрудника. */
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(scheme?.name ?? "");
  const [minAmount, setMinAmount] = useState(String(scheme?.min_amount ?? 15));
  const [minUpTo, setMinUpTo] = useState(String(scheme?.min_up_to ?? 3));
  const [perPerson, setPerPerson] = useState(String(scheme?.per_person ?? ""));
  const [bonuses, setBonuses] = useState<{ from: string; amount: string }[]>(
    (scheme?.bonuses ?? []).map((b) => ({ from: String(b.from), amount: String(b.amount) })),
  );
  const [isDefault, setIsDefault] = useState(
    scheme?.is_default ?? !schemes.some((s) => s.is_default),
  );
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(links.filter((l) => l.scheme_id === scheme?.id).map((l) => l.workout_id)),
  );
  const [saving, setSaving] = useState(false);
  const schemeName = new Map(schemes.map((s) => [s.id, s.name]));
  const elsewhere = new Map(
    links.filter((l) => l.scheme_id !== scheme?.id).map((l) => [l.workout_id, l.scheme_id]),
  );

  const handleSave = async () => {
    const min = num(minAmount);
    const upTo = Number(minUpTo.trim());
    const rate = num(perPerson);
    if (!name.trim()) return toast.error("Укажите название схемы");
    if (!Number.isFinite(min) || min < 0) return toast.error("Минимальная оплата — число от 0");
    if (!Number.isInteger(upTo) || upTo < 0 || upTo > 100)
      return toast.error("«До скольких человек» — целое число от 0");
    if (!Number.isFinite(rate) || rate < 0) return toast.error("Укажите ₾ за человека");
    const parsed: PayBonus[] = bonuses
      .filter((b) => b.from.trim() || b.amount.trim())
      .map((b) => ({ from: Number(b.from.trim()), amount: num(b.amount) }));
    if (parsed.some((b) => !Number.isInteger(b.from) || b.from < 1 || !(b.amount > 0)))
      return toast.error("Бонус: «от N человек» — целое от 1, сумма больше 0");

    setSaving(true);
    try {
      const otherDefault = schemes.find((s) => s.is_default && s.id !== scheme?.id);
      if (isDefault && otherDefault) {
        const { error } = await supabase
          .from("trainer_pay_schemes")
          .update({ is_default: false })
          .eq("id", otherDefault.id);
        if (error) throw error;
      }
      const payload = {
        name: name.trim(),
        is_default: isDefault,
        min_amount: min,
        min_up_to: upTo,
        per_person: rate,
        bonuses: cleanBonuses(parsed),
      };
      let id = scheme?.id;
      if (id) {
        const { error } = await supabase.from("trainer_pay_schemes").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("trainer_pay_schemes")
          .insert({ ...payload, trainer_id: trainerId, sort_order: nextSortOrder })
          .select("id")
          .single<{ id: string }>();
        if (error) throw error;
        id = data.id;
      }
      // Тренировки схемы: снятые — удаляем, выбранные — к этой схеме (из
      // другой схемы тренировка переезжает: ключ — тренер + тренировка).
      const { error: delErr } = await supabase
        .from("trainer_pay_scheme_workouts")
        .delete()
        .eq("scheme_id", id);
      if (delErr) throw delErr;
      if (picked.size > 0) {
        const { error: insErr } = await supabase.from("trainer_pay_scheme_workouts").upsert(
          [...picked].map((w) => ({ trainer_id: trainerId, workout_id: w, scheme_id: id })),
          { onConflict: "trainer_id,workout_id" },
        );
        if (insErr) throw insErr;
      }
      toast.success(scheme ? "Схема сохранена" : "Схема добавлена");
      onSaved();
      onClose();
    } catch (e) {
      toast.error("Не сохранено: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{scheme ? "Схема оплаты" : "Новая схема оплаты"}</DialogTitle>
        <DialogDescription>
          До указанного числа человек — минимальная оплата, больше — ставка за каждого пришедшего.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: TRX"
                maxLength={60}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Минимум, ₾" tip={TIPS.minAmount} required>
                <Input
                  inputMode="decimal"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                />
              </FormField>
              <FormField label="До скольких человек" tip={TIPS.minUpTo} required>
                <Input
                  type="number"
                  min={0}
                  value={minUpTo}
                  onChange={(e) => setMinUpTo(e.target.value)}
                />
              </FormField>
              <FormField label="Больше — ₾ за человека" tip={TIPS.perPersonRate} required>
                <Input
                  inputMode="decimal"
                  value={perPerson}
                  onChange={(e) => setPerPerson(e.target.value)}
                  placeholder="4"
                />
              </FormField>
            </div>

            <FormField label="Бонус за наполняемость" tip={TIPS.bonuses} htmlFor={null} optional>
              <div className="space-y-2">
                {bonuses.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">от</span>
                    <Input
                      type="number"
                      min={1}
                      className="w-20"
                      aria-label="От скольких человек"
                      value={b.from}
                      onChange={(e) =>
                        setBonuses((l) =>
                          l.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)),
                        )
                      }
                    />
                    <span className="text-muted-foreground">чел. +</span>
                    <Input
                      inputMode="decimal"
                      className="w-24"
                      aria-label="Бонус, ₾"
                      value={b.amount}
                      onChange={(e) =>
                        setBonuses((l) =>
                          l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                        )
                      }
                    />
                    <span className="text-muted-foreground">₾</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Убрать бонус"
                      onClick={() => setBonuses((l) => l.filter((_, j) => j !== i))}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setBonuses((l) => [...l, { from: "", amount: "" }])}
                >
                  <Plus /> Порог
                </Button>
              </div>
            </FormField>

            <SwitchRow
              title="Для всех остальных тренировок"
              tip={TIPS.isDefault}
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />

            <FormField label="Тренировки" tip={TIPS.workouts} htmlFor={null} optional>
              <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
                {workouts.length === 0 ? (
                  <span className="text-sm text-muted-foreground">Тренировок нет.</span>
                ) : (
                  workouts.map((w) => {
                    const other = elsewhere.get(w.id);
                    return (
                      <CheckboxOption
                        key={w.id}
                        checked={picked.has(w.id)}
                        onCheckedChange={(v) =>
                          setPicked((p) => {
                            const next = new Set(p);
                            if (v) next.add(w.id);
                            else next.delete(w.id);
                            return next;
                          })
                        }
                      >
                        {w.name}
                        {other && !picked.has(w.id) && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            · {schemeName.get(other)}
                          </span>
                        )}
                      </CheckboxOption>
                    );
                  })
                )}
              </div>
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Назад
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
