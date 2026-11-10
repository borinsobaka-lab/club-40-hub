import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { useStudios } from "@/hooks/use-studios";
import { useCatalogStudioIds } from "@/hooks/use-catalog-studios";
import { unwrap } from "@/lib/query";
import { SALE_KIND_HINT, SALE_KIND_LABEL, addMonthsISO } from "@/lib/payments";
import { carryoverError, carryoverBalanceKind, type CarryoverFields } from "@/lib/carryover";
import { clientName, formatDate, formatMoney, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, InfoNote } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
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
import { ClientCombobox, type ClientOption } from "@/components/client-combobox";
import { useConfirm } from "@/components/confirm-dialog";

/**
 * Выдача абонемента переноса (тип продажи «Перенос», пакетные клубы, решение
 * владельца 2026-11-10): клиенту купленной студии — её остаток тренировок и
 * срок. Номенклатура — «Абонемент переноса» из «Номенклатур» (только
 * название), остатки и срок пишутся в продажу (sales.carryover_*), абонемент
 * клиента по ним выдаёт база
 * (db/migrations/2026-11-10_packages_carryover_membership.sql). Долг за
 * абонемент — сумма продажи и невнесённый платёж рассрочки; без долга сумма
 * 0. Администратора нет — бонуса нет; нужно, чтобы доплата пошла в
 * зарплату, — «Поменять администратора» в «Абонементах».
 */

const TIPS = {
  membership:
    "Номенклатура с типом «Абонемент переноса» из «Номенклатур». Её название клиент увидит в приложении.",
  studio:
    "Клуб, к которому относится перенос: в его кассу и выручку пойдёт доплата долга. Абонемент действует во всех клубах сети.",
  visits:
    "Сколько групповых тренировок осталось у клиента в прежней студии (вместе с подарочными). Списываются при «Посетил», как у пакета.",
  personal: "Сколько персональных тренировок осталось. Отдельный баланс. 0 — нет.",
  diagnostics: "Сколько диагностик тела осталось. Отдельный баланс. 0 — нет.",
  startsOn: "Начало срока абонемента в прежней студии.",
  endsOn:
    "До какого дня действует абонемент — как в прежней студии (с продлениями за заморозки). После этой даты тренировки не списываются.",
  debt: "Сколько клиент ещё должен за этот абонемент. Станет платежом рассрочки — его отмечают «Внесён», как обычную доплату. Нет долга — оставьте пустым.",
  debtDue: "Когда клиент должен внести долг. После этой даты платёж считается просроченным.",
};

type MembershipOption = { id: string; name: string };

export function CarryoverForm({
  onOpenChange,
  studioId,
  onSaved,
  initialClient,
}: {
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  onSaved: () => void;
  initialClient?: ClientOption | null;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const { ensure: ensureStaff } = useStaffProfile();
  const { data: studios } = useStudios();
  const saleStudios = (studios ?? []).filter((s) => s.format === "packages");
  const [saleStudioId, setSaleStudioId] = useState(studioId);
  const today = todayISO();
  const [form, setForm] = useState<CarryoverFields>(() => ({
    clientId: initialClient?.id ?? "",
    membershipId: "",
    visits: "",
    personal: "",
    diagnostics: "",
    startsOn: today,
    endsOn: "",
    debt: "",
    debtDue: addMonthsISO(today, 1),
  }));
  const [clientLabel, setClientLabel] = useState(initialClient ? clientName(initialClient) : "");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof CarryoverFields>(key: K, value: CarryoverFields[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const catalogIds = useCatalogStudioIds(studioId);
  const { data: options = [], isFetched } = useQuery({
    queryKey: ["memberships", studioId, "carryover", catalogIds?.join(",")],
    queryFn: () =>
      unwrap<MembershipOption[]>(
        supabase
          .from("memberships")
          .select("id, name")
          .in("studio_id", catalogIds!)
          .eq("kind", "carryover")
          .order("sort_order")
          .order("name"),
      ),
    enabled: !!studioId && !!catalogIds,
    meta: { errorMessage: "Не удалось загрузить абонементы переноса" },
  });
  // Абонемент переноса обычно один — подставляется сам, как только загрузится
  // список (состояние правится в рендере: условие выполняется один раз).
  const firstId = options[0]?.id ?? "";
  if (firstId && !form.membershipId) set("membershipId", firstId);
  const membership = options.find((m) => m.id === form.membershipId) ?? null;
  const debt = Number(form.debt) || 0;

  const handleSave = async () => {
    if (saving) return;
    const invalid = (!saleStudioId ? "Выберите клуб" : null) ?? carryoverError(form);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setSaving(true);
    try {
      // Живой абонемент того же вида не вытесняется: перенос встаёт в очередь.
      const balanceKind = carryoverBalanceKind(form);
      const { data: liveRows, error: liveErr } = await supabase
        .from("client_memberships")
        .select("id, memberships(name)")
        .eq("client_id", form.clientId)
        .eq("balance_kind", balanceKind)
        .in("status", ["active", "frozen"])
        .limit(1);
      if (liveErr) {
        toast.error("Не удалось проверить абонементы клиента: " + liveErr.message);
        return;
      }
      const live = (
        liveRows as { memberships: { name: string } | { name: string }[] | null }[] | null
      )?.[0];
      if (live) {
        const ref = Array.isArray(live.memberships) ? live.memberships[0] : live.memberships;
        const ok = await confirm({
          title: "У клиента уже есть абонемент",
          description: `Действующий абонемент «${ref?.name ?? "—"}» останется. Абонемент переноса встанет в очередь и начнёт списываться, когда текущий закончится.`,
          confirmLabel: "Выдать",
          destructive: false,
        });
        if (!ok) return;
      }

      const admin = await ensureStaff();
      const { data: sale, error } = await supabase
        .from("sales")
        .insert({
          studio_id: saleStudioId,
          client_id: form.clientId,
          membership_id: form.membershipId,
          admin_id: admin?.id ?? null,
          sold_at: today,
          total_amount: debt,
          down_payment_amount: 0,
          remaining_installments: debt > 0 ? 1 : 0,
          source: "admin",
          sale_kind: "carryover",
          carryover_visits: Number(form.visits) || 0,
          carryover_personal: Number(form.personal) || 0,
          carryover_diagnostics: Number(form.diagnostics) || 0,
          carryover_starts_on: form.startsOn,
          carryover_ends_on: form.endsOn,
          comment: comment.trim() || null,
        })
        .select("id")
        .single();
      if (error || !sale) {
        toast.error("Ошибка сохранения: " + (error?.message ?? "база не вернула продажу"));
        return;
      }
      if (debt > 0) {
        const { error: instErr } = await supabase
          .from("sale_installments")
          .insert({ sale_id: sale.id, due_date: form.debtDue, amount: debt, paid: false });
        if (instErr) {
          // Без платежа долг потерялся бы — убираем перенос целиком (выданный
          // абонемент удаляет триггер), форма остаётся открытой.
          const { error: delErr } = await supabase.from("sales").delete().eq("id", sale.id);
          toast.error(
            delErr
              ? `Не записан долг (${instErr.message}), и перенос не удалось отменить (${delErr.message}) — удалите его в «Абонементах» и выдайте заново`
              : "Перенос не сохранён: не записан долг — " + instErr.message,
          );
          if (delErr) {
            queryClient.invalidateQueries({ queryKey: ["client_packages_list"] });
            onSaved();
          }
          return;
        }
      }
      toast.success(
        live ? "Абонемент переноса выдан и ждёт в очереди" : "Абонемент переноса выдан",
      );
      queryClient.invalidateQueries({ queryKey: ["client_packages_list"] });
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const numberInput = (key: "visits" | "personal" | "diagnostics") => (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      step={1}
      value={form[key]}
      onChange={(e) => set(key, e.target.value)}
      placeholder="0"
    />
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{SALE_KIND_LABEL.carryover}</DialogTitle>
        <DialogDescription>{SALE_KIND_HINT.carryover}</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Клиент" required>
              <ClientCombobox
                studioId={studioId}
                initialClient={initialClient}
                creatable
                value={form.clientId}
                onChange={(id, c) => {
                  set("clientId", id);
                  setClientLabel(c ? clientName(c) : "");
                }}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Клуб" tip={TIPS.studio} required>
                <Select value={saleStudioId ?? ""} onValueChange={setSaleStudioId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите клуб" />
                  </SelectTrigger>
                  <SelectContent>
                    {saleStudios.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                label="Абонемент"
                tip={TIPS.membership}
                required
                hint={
                  isFetched && options.length === 0
                    ? "Нет абонемента переноса. Добавьте в «Номенклатурах» номенклатуру с типом «Абонемент переноса»."
                    : undefined
                }
              >
                <Select value={form.membershipId} onValueChange={(v) => set("membershipId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите абонемент" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Групповых" tip={TIPS.visits} required>
                {numberInput("visits")}
              </FormField>
              <FormField label="Персональных" tip={TIPS.personal} optional>
                {numberInput("personal")}
              </FormField>
              <FormField label="Диагностик" tip={TIPS.diagnostics} optional>
                {numberInput("diagnostics")}
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Начало срока" tip={TIPS.startsOn} required>
                <Input
                  type="date"
                  value={form.startsOn}
                  onChange={(e) => set("startsOn", e.target.value)}
                />
              </FormField>
              <FormField
                label="Действует до"
                tip={TIPS.endsOn}
                required
                hint={
                  form.endsOn && form.endsOn < today
                    ? "Срок уже прошёл — тренировки по абонементу списываться не будут."
                    : undefined
                }
              >
                <Input
                  type="date"
                  value={form.endsOn}
                  onChange={(e) => set("endsOn", e.target.value)}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Долг, ₾" tip={TIPS.debt} optional>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.debt}
                  onChange={(e) => set("debt", e.target.value)}
                  placeholder="0"
                />
              </FormField>
              {debt > 0 && (
                <FormField label="Внести до" tip={TIPS.debtDue} required>
                  <Input
                    type="date"
                    value={form.debtDue}
                    onChange={(e) => set("debtDue", e.target.value)}
                  />
                </FormField>
              )}
            </div>

            <FormField label="Комментарий" optional>
              <Textarea
                note
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </FormField>

            {form.clientId && membership && (
              <InfoNote>
                {clientLabel || "Клиенту"} — «{membership.name}»: {Number(form.visits) || 0} групп.
                {(Number(form.personal) || 0) > 0 && ` + ${Number(form.personal)} перс.`}
                {(Number(form.diagnostics) || 0) > 0 && ` + ${Number(form.diagnostics)} диагн.`}
                {form.endsOn && `, до ${formatDate(form.endsOn)}`}
                {debt > 0 && `; долг ${formatMoney(debt)} до ${formatDate(form.debtDue)}`}. Срок уже
                идёт — абонемент действует сразу во всех клубах сети.
              </InfoNote>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Выдать
          </Button>
        </DialogFooter>
      </DialogForm>
      {confirmDialog}
    </>
  );
}
