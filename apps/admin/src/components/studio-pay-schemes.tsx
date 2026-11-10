import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { useStudios } from "@/hooks/use-studios";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useCatalogStudioIds } from "@/hooks/use-catalog-studios";
import { useConfirm } from "@/components/confirm-dialog";
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
  Dialog,
  DialogBody,
  DialogContent,
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
  type PayBonus,
  type PayScheme,
  type StudioPaySettings,
} from "@/lib/pay-schemes";
import { formatPay } from "@/lib/payroll";

/**
 * «Ставки» → «Групповые по числу людей» (пакетные клубы, решение владельца
 * 2026-11-11; схема — db/migrations/2026-11-11_studio_per_person_pay.sql):
 * в выбранном клубе групповые оплачиваются по числу «Посетил» по схемам
 * клуба (обычная группа, TRX, гамаки — тренировки выбираются в схеме), плюс
 * бонус тренеру пробного за абонемент после пробного. Правило расчёта —
 * lib/pay-schemes.ts и pay_scheme_amount в базе; считает «Зарплаты».
 */

const TIPS = {
  perPerson:
    "Включено — групповые в этом клубе оплачиваются по схемам ниже по числу клиентов с отметкой «Посетил». Выключено — ставкой «Групповая тренировка» сотрудника.",
  trialBonus:
    "Сколько тренер пробного занятия получает, когда клиент купил абонемент после пробного (в день пробного или позже, один раз на клиента). Задано — 5 % от продаж тренеру при продаже в этом клубе не идут. Пусто — как раньше, 5 %.",
  minAmount: "Оплата за занятие, когда людей мало.",
  minUpTo: "До скольких человек включительно платится минимальная оплата.",
  perPersonRate:
    "Когда людей больше — столько ₾ за каждого пришедшего (а не только сверх минимума).",
  bonuses:
    "Бонус за наполняемость: «от 7 человек +5 ₾», «от 10 человек +10 ₾» — берётся самый крупный порог, до которого дошли.",
  workouts:
    "Тренировки, которые оплачиваются по этой схеме. У тренировки в клубе одна схема: выбранная здесь уйдёт из другой схемы.",
  isDefault: "Тренировки без своей схемы оплачиваются по этой. Такая схема в клубе одна.",
};

const SETTINGS_KEY = "studio_pay_settings";
const SCHEMES_KEY = "studio_pay_schemes";

type SchemeWorkout = { scheme_id: string; workout_id: string };
type Workout = { id: string; name: string };

const num = (v: string) => Number(v.trim().replace(",", "."));

export function StudioPaySchemes() {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const activeId = useActiveStudioId();
  const { data: studios = [] } = useStudios();
  const clubs = studios.filter((s) => s.format === "packages");
  const [picked, setPicked] = useState<string | null>(null);
  const studioId =
    picked ?? (clubs.some((s) => s.id === activeId) ? activeId : (clubs[0]?.id ?? null));
  const [editing, setEditing] = useState<PayScheme | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = useQuery({
    queryKey: [SETTINGS_KEY, studioId],
    queryFn: async () =>
      (
        await unwrap<StudioPaySettings[]>(
          supabase.from("studio_pay_settings").select("*").eq("studio_id", studioId!),
        )
      )[0] ?? null,
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить настройки оплаты клуба" },
  });
  const schemes = useQuery({
    queryKey: [SCHEMES_KEY, studioId],
    queryFn: async () => {
      const [list, links] = await Promise.all([
        unwrap<PayScheme[]>(
          supabase
            .from("studio_pay_schemes")
            .select("*")
            .eq("studio_id", studioId!)
            .order("sort_order")
            .order("created_at"),
        ),
        unwrap<SchemeWorkout[]>(
          supabase
            .from("studio_pay_scheme_workouts")
            .select("scheme_id, workout_id")
            .eq("studio_id", studioId!),
        ),
      ]);
      return { list, links };
    },
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить схемы оплаты" },
  });
  const catalogIds = useCatalogStudioIds(studioId);
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
    queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] });
    queryClient.invalidateQueries({ queryKey: [SCHEMES_KEY] });
    queryClient.invalidateQueries({ queryKey: ["payroll_lines"] });
  };

  const saveSettings = async (patch: Partial<Omit<StudioPaySettings, "studio_id">>) => {
    if (!studioId) return false;
    const current = settings.data;
    const { error } = await supabase.from("studio_pay_settings").upsert({
      studio_id: studioId,
      per_person: current?.per_person ?? false,
      trial_sale_bonus: current?.trial_sale_bonus ?? null,
      ...patch,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      toast.error("Не сохранено: " + error.message);
      return false;
    }
    reload();
    return true;
  };

  const fillPreset = async () => {
    if (!studioId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("studio_pay_schemes")
        .insert(PRESET_SCHEMES.map((s, i) => ({ ...s, studio_id: studioId, sort_order: i })));
      if (error) throw error;
      if (settings.data?.trial_sale_bonus == null)
        await saveSettings({ trial_sale_bonus: PRESET_TRIAL_SALE_BONUS });
      toast.success("Схемы добавлены — выберите тренировки для TRX и гамаков");
      reload();
    } catch (e) {
      toast.error("Не удалось добавить схемы: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: PayScheme) => {
    const ok = await confirm({
      title: `Удалить схему «${s.name}»?`,
      description: s.is_default
        ? "Тренировки без своей схемы будут оплачиваться ставкой сотрудника, пока не назначите другую схему «для остальных»."
        : "Её тренировки будут оплачиваться по схеме для остальных тренировок.",
      confirmLabel: "Удалить",
    });
    if (!ok) return;
    const { error } = await supabase.from("studio_pay_schemes").delete().eq("id", s.id);
    if (error) {
      toast.error("Не удалось удалить: " + error.message);
      return;
    }
    reload();
  };

  if (clubs.length === 0) return null;
  const list = schemes.data?.list ?? [];
  const links = schemes.data?.links ?? [];
  const workoutName = new Map((workouts.data ?? []).map((w) => [w.id, w.name]));

  return (
    <section className="space-y-4 rounded-lg border bg-background p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Групповые по числу людей</h2>
          <p className="text-sm text-muted-foreground">
            Оплата групповой тренировки зависит от того, сколько клиентов пришло («Посетил»).
            Настраивается для клуба.
          </p>
        </div>
        {clubs.length > 1 && (
          <Select value={studioId ?? ""} onValueChange={setPicked}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Клуб" />
            </SelectTrigger>
            <SelectContent>
              {clubs.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <SwitchRow
          title="Считать групповые по числу людей"
          tip={TIPS.perPerson}
          checked={settings.data?.per_person ?? false}
          disabled={settings.isLoading}
          onCheckedChange={(v) => saveSettings({ per_person: v })}
        />
        <TrialBonusField
          key={`${studioId}:${settings.data?.trial_sale_bonus ?? ""}`}
          value={settings.data?.trial_sale_bonus ?? null}
          onSave={(v) => saveSettings({ trial_sale_bonus: v })}
        />
      </div>

      {schemes.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Загрузка схем…
        </div>
      ) : list.length === 0 ? (
        <InfoNote>
          <div className="space-y-3">
            <p>
              Схем ещё нет. Можно заполнить условиями купленной студии: до 3 человек — 15 ₾, больше
              — 4 ₾ за человека на коврике и 6 ₾ на TRX и гамаках; от 7 человек +5 ₾, от 10 — +10 ₾;
              +10 ₾ тренеру пробного за абонемент после пробного. Суммы потом можно поменять.
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
          <ul className="grid gap-3 lg:grid-cols-3">
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
                  <p className="text-sm">
                    До {s.min_up_to} чел. — {formatPay(Number(s.min_amount))}, больше —{" "}
                    {formatPay(Number(s.per_person))} за человека
                    {s.bonuses.length > 0 &&
                      "; " +
                        s.bonuses
                          .map((b) => `от ${b.from} чел. +${formatPay(Number(b.amount))}`)
                          .join(", ")}
                  </p>
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

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-xl">
          {editing !== null && studioId && (
            <SchemeForm
              key={editing === "new" ? "new" : editing.id}
              studioId={studioId}
              scheme={editing === "new" ? null : editing}
              schemes={list}
              links={links}
              workouts={workouts.data ?? []}
              nextSortOrder={list.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1}
              onClose={() => setEditing(null)}
              onSaved={reload}
            />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </section>
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
        placeholder="5 % как раньше"
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
  studioId,
  scheme,
  schemes,
  links,
  workouts,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  studioId: string;
  scheme: PayScheme | null;
  schemes: PayScheme[];
  links: SchemeWorkout[];
  workouts: Workout[];
  nextSortOrder: number;
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
          .from("studio_pay_schemes")
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
        const { error } = await supabase.from("studio_pay_schemes").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("studio_pay_schemes")
          .insert({ ...payload, studio_id: studioId, sort_order: nextSortOrder })
          .select("id")
          .single<{ id: string }>();
        if (error) throw error;
        id = data.id;
      }
      // Тренировки схемы: снятые — удаляем, выбранные — к этой схеме (из
      // другой схемы тренировка переезжает: ключ — клуб + тренировка).
      const { error: delErr } = await supabase
        .from("studio_pay_scheme_workouts")
        .delete()
        .eq("scheme_id", id);
      if (delErr) throw delErr;
      if (picked.size > 0) {
        const { error: insErr } = await supabase.from("studio_pay_scheme_workouts").upsert(
          [...picked].map((w) => ({ studio_id: studioId, workout_id: w, scheme_id: id })),
          { onConflict: "studio_id,workout_id" },
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
            Отмена
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
