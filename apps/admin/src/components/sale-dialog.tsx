import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { useStudios } from "@/hooks/use-studios";
import { unwrap } from "@/lib/query";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  PAYMENT_TYPE_LABEL,
  PAYMENT_TYPES,
  SALE_TIPS,
  type PaymentMethod,
  type PaymentType,
} from "@/lib/payments";
import { celebrateSale } from "@/lib/confetti";
import { clientName, formatDate, formatMoney, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, InfoNote } from "@/components/ui/form-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
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
import { ClientCombobox, type ClientOption } from "@/components/client-combobox";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { useConfirm } from "@/components/confirm-dialog";

// Диалог «Новая продажа» абонемента. Открывается из «Продаж» и из карточки
// клиента («Добавить продажу» — клиент уже подставлен).
//
// Рассрочка зависит от формата студии (STUDIO_FORMATS.md):
// - подписочный — у тарифа флаг installment_enabled, остаток на 2 или 3 мес.;
// - пакетный — у пакета max_payments («сколькими платежами можно оплатить»),
//   администратор выбирает число платежей от 1 до него; поля «Тип оплаты» нет.
// В обоих случаях первый платёж — в день продажи, остальные — ежемесячно.

type MembershipRow = {
  id: string;
  name: string;
  price: number;
  duration_days: number | null;
  visits_count: number | null;
  installment_enabled: boolean;
  /** Пакетный формат: сколькими платежами можно оплатить (1 — только сразу). */
  max_payments: number;
};

// Календарная арифметика по Y-M-D: без Date-парсинга (он читает дату как UTC)
// и с прижатием к концу месяца — 31 января + 1 мес. = 28/29 февраля, а не 3 марта.
function addMonthsISO(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

function splitAmount(total: number, parts: number) {
  const part = Math.round((total / parts) * 100) / 100;
  const arr = Array(parts).fill(part);
  arr[parts - 1] = Math.round((total - part * (parts - 1)) * 100) / 100;
  return arr.map((v) => Math.round(v * 100) / 100);
}

// ---------------------------------------------------------------------------
// Новая продажа
// ---------------------------------------------------------------------------

type SaleFields = {
  clientId: string;
  /** Имя выбранного клиента — для итоговой строки под формой. */
  clientLabel: string;
  membershipId: string;
  soldAt: string;
  amount: string;
  downPayment: string;
  /** Подписочный формат: на сколько месяцев разбить остаток. */
  remainingCount: 2 | 3;
  /** Пакетный формат: всего платежей, включая первый (1 — оплата сразу). */
  paymentsCount: number;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  promoCode: string;
  comment: string;
};

/** Суммы продажи по форме: итог, первый взнос, скидка от тарифа, график рассрочки. */
function saleTotals(form: SaleFields, membership: MembershipRow | null, isPackages: boolean) {
  const installment = isPackages
    ? form.paymentsCount > 1
    : (membership?.installment_enabled ?? false);
  const total = Number(form.amount) || 0;
  const down = installment ? Number(form.downPayment) || 0 : total;
  const remaining = !installment ? 0 : isPackages ? form.paymentsCount - 1 : form.remainingCount;
  const remainingTotal = Math.max(0, total - down);
  const listPrice = membership?.price != null ? Number(membership.price) : null;
  const discount = listPrice != null ? Math.max(0, listPrice - total) : 0;
  const schedule =
    !form.soldAt || remaining === 0 || remainingTotal <= 0
      ? []
      : [
          { date: form.soldAt, amount: down, isDownPayment: true },
          ...splitAmount(remainingTotal, remaining).map((amount, i) => ({
            date: addMonthsISO(form.soldAt, i + 1),
            amount,
            isDownPayment: false,
          })),
        ];
  return { installment, total, down, remaining, listPrice, discount, schedule };
}

/** Первая ошибка заполнения формы продажи (текст для тоста) или null. */
function saleFormError(form: SaleFields, t: ReturnType<typeof saleTotals>) {
  if (!form.clientId) return "Выберите клиента";
  if (!form.membershipId) return "Выберите абонемент";
  if (t.total <= 0) return "Укажите стоимость";
  if (!form.soldAt) return "Укажите дату продажи";
  if (t.installment) {
    if (t.down <= 0) return "Укажите первый взнос";
    if (t.down >= t.total) return "Первый взнос должен быть меньше общей суммы";
  }
  return null;
}

/** Действующий абонемент клиента (embed memberships — объект или массив). */
type CurrentMembership = {
  status: string;
  memberships: { name: string } | { name: string }[] | null;
};

export type SaleDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  onSaved: () => void;
  /** Клиент, подставленный заранее (продажа из карточки клиента); сменить можно. */
  initialClient?: ClientOption | null;
};

export function SaleDialog(props: SaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <SaleForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function SaleForm({ onOpenChange, studioId, onSaved, initialClient }: SaleDialogProps) {
  const { confirm, confirmDialog } = useConfirm();
  const { data: staff, ensure: ensureStaff } = useStaffProfile();
  const { data: studios } = useStudios();
  const isPackages = studios?.find((s) => s.id === studioId)?.format === "packages";
  const [form, setForm] = useState<SaleFields>(() => ({
    clientId: initialClient?.id ?? "",
    clientLabel: initialClient ? clientName(initialClient) : "",
    membershipId: "",
    soldAt: todayISO(),
    amount: "",
    downPayment: "",
    remainingCount: 2,
    paymentsCount: 1,
    paymentType: "first",
    paymentMethod: "cash",
    promoCode: "",
    comment: "",
  }));
  const set = <K extends keyof SaleFields>(key: K, value: SaleFields[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const [saving, setSaving] = useState(false);

  const { data: memberships = [] } = useQuery({
    queryKey: ["memberships", studioId, "options"],
    queryFn: () =>
      unwrap<MembershipRow[]>(
        supabase
          .from("memberships")
          .select("id, name, price, duration_days, visits_count, installment_enabled, max_payments")
          .eq("studio_id", studioId!)
          .order("name"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить абонементы" },
  });

  const membership = memberships.find((m) => m.id === form.membershipId) ?? null;
  const t = saleTotals(form, membership, isPackages);
  const maxPayments = isPackages ? Math.max(1, membership?.max_payments ?? 1) : 1;

  // Цена подставляется при выборе, а не эффектом по выбранному абонементу:
  // эффект срабатывал и на перезагрузку списка и затирал введённую скидку.
  const pickMembership = (id: string) => {
    const m = memberships.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      membershipId: id,
      amount: m ? String(m.price ?? 0) : "",
      downPayment: "",
      remainingCount: 2,
      paymentsCount: 1,
    }));
  };

  // Пакетный формат: при выборе числа платежей первый платёж предлагается
  // равной долей — график виден сразу, администратор правит сумму, внесённую
  // на месте, остаток пересчитывается на следующие платежи.
  const pickPaymentsCount = (n: number) => {
    setForm((f) => {
      const total = Number(f.amount) || 0;
      return {
        ...f,
        paymentsCount: n,
        downPayment: n > 1 && total > 0 ? String(splitAmount(total, n)[0]) : "",
      };
    });
  };

  const handleSave = async () => {
    if (!studioId || saving) return;
    const invalid =
      saleFormError(form, t) ??
      (isPackages && form.paymentsCount > maxPayments
        ? `Этот пакет можно оплатить не больше чем ${maxPayments} платежами`
        : null);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    // Блокируем сразу, до проверки текущего абонемента: пока шёл тот запрос,
    // кнопка оставалась активной, и двойной клик создавал две продажи.
    setSaving(true);
    try {
      // Новая продажа вытесняет действующий абонемент — и активный, и
      // замороженный (activate_membership_from_sale), поэтому предупреждаем о
      // любом из них. limit(1), а не maybeSingle: при двух строках maybeSingle
      // отдаёт ошибку, и предупреждение молча пропадало.
      const { data: currentRows, error: currentErr } = await supabase
        .from("client_memberships")
        .select("id, status, memberships(name)")
        .eq("client_id", form.clientId)
        .in("status", ["active", "frozen"])
        .limit(1);
      if (currentErr) {
        toast.error("Не удалось проверить абонементы клиента: " + currentErr.message);
        return;
      }
      const current = (currentRows as CurrentMembership[] | null)?.[0];
      if (current) {
        const m = current.memberships;
        const name = (Array.isArray(m) ? m[0]?.name : m?.name) ?? "—";
        const kind = current.status === "frozen" ? "замороженный" : "активный";
        const ok = await confirm({
          title: `Заменить ${kind} абонемент?`,
          description: `У клиента уже есть ${kind} абонемент «${name}». Новая продажа заменит его.`,
          confirmLabel: "Заменить",
          destructive: false,
        });
        if (!ok) return;
      }

      const admin = await ensureStaff();
      const { data: sale, error } = await supabase
        .from("sales")
        .insert({
          studio_id: studioId,
          client_id: form.clientId,
          membership_id: form.membershipId,
          admin_id: admin?.id ?? null,
          admin_name: admin?.displayName || null,
          sold_at: form.soldAt,
          total_amount: t.total,
          down_payment_amount: t.down,
          remaining_installments: t.remaining,
          source: "admin",
          // В пакетных студиях типа оплаты нет — колонка остаётся по умолчанию.
          ...(isPackages ? {} : { payment_type: form.paymentType }),
          payment_method: form.paymentMethod,
          list_price: t.listPrice,
          discount_amount: t.discount,
          promo_code: form.promoCode.trim() || null,
          comment: form.comment.trim() || null,
        })
        .select("id")
        .single();
      if (error || !sale) {
        toast.error("Ошибка сохранения: " + (error?.message ?? "база не вернула продажу"));
        return;
      }
      if (t.schedule.length > 0) {
        const rows = t.schedule.map((p) => ({
          sale_id: sale.id,
          due_date: p.date,
          amount: p.amount,
          paid: p.isDownPayment,
        }));
        const { error: instErr } = await supabase.from("sale_installments").insert(rows);
        if (instErr) {
          toast.error("Продажа создана, но не записан график: " + instErr.message);
        }
      }
      toast.success("Продажа создана");
      celebrateSale();
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Новая продажа</DialogTitle>
        <DialogDescription>
          Выберите клиента и абонемент. Стоимость подтянется автоматически.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Клиент" required>
              <ClientCombobox
                studioId={studioId}
                initialClient={initialClient}
                value={form.clientId}
                onChange={(id, c) =>
                  setForm((f) => ({ ...f, clientId: id, clientLabel: c ? clientName(c) : "" }))
                }
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Дата продажи" tip={SALE_TIPS.soldAt} required>
                <Input
                  type="date"
                  value={form.soldAt}
                  onChange={(e) => set("soldAt", e.target.value)}
                />
              </FormField>
              {/* Только для чтения — продажу записываем на того, кто вошёл. */}
              <FormField label="Администратор" tip={SALE_TIPS.admin} htmlFor={null}>
                <div className="flex h-10 items-center text-sm">{staff?.displayName || "—"}</div>
              </FormField>
            </div>

            <FormField label="Абонемент" tip={SALE_TIPS.membership} required>
              <SearchableCombobox
                placeholder="Выбрать абонемент"
                searchPlaceholder="Поиск по названию"
                emptyText="Ничего не найдено"
                value={form.membershipId}
                onChange={pickMembership}
                options={memberships.map((m) => ({
                  value: m.id,
                  label: m.name,
                  hint: formatMoney(Number(m.price ?? 0)),
                  searchText: m.name,
                }))}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Стоимость, ₾"
                tip={SALE_TIPS.amount}
                required
                hint={
                  t.discount > 0 && t.listPrice != null
                    ? `Цена по тарифу ${formatMoney(t.listPrice)}, скидка ${formatMoney(t.discount)}.`
                    : undefined
                }
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => set("amount", e.target.value)}
                />
              </FormField>
              <FormField
                label="Способ оплаты"
                tip="Как платил клиент. В «Кассу» продажа сама не попадает."
                required
              >
                <Select
                  value={form.paymentMethod}
                  onValueChange={(v) => set("paymentMethod", v as PaymentMethod)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            {isPackages ? (
              maxPayments > 1 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Платежей" tip={SALE_TIPS.paymentsCount} required>
                    <Select
                      value={String(form.paymentsCount)}
                      onValueChange={(v) => pickPaymentsCount(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: maxPayments }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n === 1 ? "1 — оплата сразу" : n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  {t.installment && (
                    <FormField label="Первый платёж, ₾" tip={SALE_TIPS.firstPayment} required>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.downPayment}
                        onChange={(e) => set("downPayment", e.target.value)}
                        placeholder="Сколько внесено сейчас"
                      />
                    </FormField>
                  )}
                  {t.schedule.length > 0 && (
                    <InfoNote className="sm:col-span-2">
                      <ul className="space-y-1">
                        {t.schedule.map((p, i) => (
                          <li key={i} className="flex items-center justify-between gap-3">
                            <span>
                              Платёж {i + 1} — {formatDate(p.date)}
                              {p.isDownPayment && " (сегодня, в студии)"}
                            </span>
                            <span className="font-medium tabular-nums text-foreground">
                              {formatMoney(p.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </InfoNote>
                  )}
                </div>
              )
            ) : t.installment ? (
              <div className="space-y-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Рассрочка</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Первый взнос, ₾" tip={SALE_TIPS.downPayment} required>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.downPayment}
                      onChange={(e) => set("downPayment", e.target.value)}
                      placeholder="Сколько вносит сейчас"
                    />
                  </FormField>
                  <FormField
                    label="Ещё платежей"
                    tip={SALE_TIPS.installments}
                    htmlFor={null}
                    required
                  >
                    <RadioGroup
                      value={String(form.remainingCount)}
                      onValueChange={(v) => set("remainingCount", v === "3" ? 3 : 2)}
                      className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3"
                    >
                      {([2, 3] as const).map((n) => (
                        <label key={n} className="flex cursor-pointer items-center gap-2 text-sm">
                          <RadioGroupItem value={String(n)} />
                          <span>{n} мес.</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </FormField>
                </div>

                {t.schedule.length > 0 && (
                  <InfoNote>
                    <ul className="space-y-1">
                      {t.schedule.map((p, i) => (
                        <li key={i} className="flex items-center justify-between gap-3">
                          <span>
                            {p.isDownPayment ? "Первый взнос" : `Платёж ${i + 1}`} —{" "}
                            {formatDate(p.date)}
                          </span>
                          <span className="font-medium tabular-nums text-foreground">
                            {formatMoney(p.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </InfoNote>
                )}
              </div>
            ) : membership ? (
              <InfoNote>
                Рассрочка недоступна для этого абонемента. Оплата производится сразу.
              </InfoNote>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!isPackages && (
                <FormField label="Тип оплаты" tip={SALE_TIPS.paymentType} required>
                  <Select
                    value={form.paymentType}
                    onValueChange={(v) => set("paymentType", v as PaymentType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_TYPES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PAYMENT_TYPE_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
              <FormField label="Промокод" tip={SALE_TIPS.promo} optional>
                <Input value={form.promoCode} onChange={(e) => set("promoCode", e.target.value)} />
              </FormField>
            </div>

            <FormField label="Комментарий" optional>
              <Textarea
                rows={2}
                value={form.comment}
                onChange={(e) => set("comment", e.target.value)}
              />
            </FormField>

            {form.clientId && membership && (
              <InfoNote>
                Продажа абонемента «{membership.name}» клиенту {form.clientLabel}.
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
            Продать
          </Button>
        </DialogFooter>
      </DialogForm>
      {confirmDialog}
    </>
  );
}
