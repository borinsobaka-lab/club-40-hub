import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Trash2, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { useServerTable } from "@/hooks/use-server-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  saleSourceLabel,
  type PaymentMethod,
} from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarSearch } from "@/components/table-toolbar";
import { ClientNameLink } from "@/components/client-name-link";
import { ClientCombobox } from "@/components/client-combobox";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { clientName, formatMoney, formatDate, todayISO } from "@/lib/format";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";
import {
  MembershipStatusBadge,
  AutoRenewBadge,
  effectiveStatus,
} from "@/components/membership-status-badge";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({ meta: [{ title: "Продажи — Base40 Admin" }] }),
  component: SalesPage,
});

// Колонки вью sales_list. search_text не запрашиваем — он нужен только для
// фильтра на сервере. Связанные объекты (clients / memberships /
// client_memberships) вью отдаёт в той же форме, что раньше вложенный select.
const SALE_COLUMNS =
  "id, studio_id, client_id, membership_id, admin_id, admin_name, sold_at, total_amount, " +
  "down_payment_amount, remaining_installments, source, payment_type, promo_code, comment, " +
  "created_at, clients, memberships, client_memberships";

type MembershipRow = {
  id: string;
  name: string;
  price: number;
  duration_days: number | null;
  visits_count: number | null;
  installment_enabled: boolean;
};

type PaymentType = "first" | "recurring" | "other";

type Sale = {
  id: string;
  studio_id: string;
  client_id: string;
  membership_id: string;
  admin_id: string | null;
  admin_name: string | null;
  sold_at: string;
  total_amount: number;
  down_payment_amount: number;
  remaining_installments: number;
  source: "admin" | "mobile";
  payment_type: PaymentType | null;
  promo_code: string | null;
  comment: string | null;
  created_at: string;
  clients: {
    id: string;
    full_name: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  memberships: { id: string; name: string } | null;
  client_memberships:
    | {
        id: string;
        status: string;
        auto_renew: boolean | null;
        ends_at: string | null;
        cancelled_at: string | null;
      }[]
    | null;
};

const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  first: "Первая оплата",
  recurring: "Регулярная оплата",
  other: "Другое",
};
const PAYMENT_TYPES: PaymentType[] = ["first", "recurring", "other"];

function SourceBadge({ source }: { source: Sale["source"] | null }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        source === "mobile" ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground",
      )}
    >
      {saleSourceLabel(source)}
    </span>
  );
}

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

function SalesPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [saleOpen, setSaleOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundSale, setRefundSale] = useState<Sale | null>(null);

  const term = useDebouncedValue(search).trim();
  const table = useServerTable<Sale>({
    queryKey: ["sales_list", studioId, term],
    queryFn: ({ from, to }) => {
      let q = supabase
        .from("sales_list")
        .select(SALE_COLUMNS, { count: "exact" })
        .eq("studio_id", studioId!);
      if (term) q = q.ilike("search_text", `%${term}%`);
      return q.order("sold_at", { ascending: false }).range(from, to);
    },
    enabled: !!studioId,
    errorMessage: "Не удалось загрузить продажи",
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["sales_list"] });

  const handleDelete = async (s: Sale) => {
    if (
      !(await confirm({
        title: "Удалить продажу?",
        description: "Продажа будет удалена. Выданный по ней абонемент останется у клиента.",
      }))
    )
      return;
    const { error } = await supabase.from("sales").delete().eq("id", s.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Продажа удалена");
    reload();
  };

  const openRefund = (s: Sale) => {
    setRefundSale(s);
    setRefundOpen(true);
  };

  return (
    <AdminShell
      title="Продажи"
      actions={
        <Button onClick={() => setSaleOpen(true)} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Новая продажа
        </Button>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Поиск по клиенту или абонементу"
            />
          </TableToolbar>

          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Клиент</TableHead>
                  <TableHead>Контакты</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Абонемент</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Тип оплаты</TableHead>
                  <TableHead>Промо-код</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Первый взнос</TableHead>
                  <TableHead>Рассрочка</TableHead>
                  <TableHead>Администратор</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.loading ? (
                  <TableSkeletonRows columns={13} />
                ) : table.rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={13}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {term ? "Ничего не найдено." : "Продаж пока нет. Нажмите «Новая продажа»."}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.rows.map((s) => {
                    const cm = s.client_memberships?.[0] ?? null;
                    return (
                      <RowContextMenu
                        key={s.id}
                        actions={[
                          {
                            label: "Оформить возврат",
                            icon: Receipt,
                            onSelect: () => openRefund(s),
                          },
                          {
                            label: "Удалить",
                            icon: Trash2,
                            destructive: true,
                            onSelect: () => handleDelete(s),
                          },
                        ]}
                      >
                        <TableRow>
                          <TableCell className="font-medium">
                            {s.clients ? (
                              <ClientNameLink clientId={s.client_id}>
                                {clientName(s.clients)}
                              </ClientNameLink>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            <div>{s.clients?.phone ?? "—"}</div>
                            <div className="text-xs">{s.clients?.email ?? "—"}</div>
                          </TableCell>
                          <TableCell>{formatDate(s.sold_at)}</TableCell>
                          <TableCell>
                            <SourceBadge source={s.source} />
                          </TableCell>
                          <TableCell>{s.memberships?.name ?? "—"}</TableCell>
                          <TableCell>
                            {cm ? (
                              <div className="flex flex-col gap-1">
                                <MembershipStatusBadge m={cm} />
                                {effectiveStatus(cm) === "active" && (
                                  <AutoRenewBadge on={cm.auto_renew} />
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {PAYMENT_TYPE_LABEL[s.payment_type ?? "other"]}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {s.promo_code ?? "—"}
                          </TableCell>
                          <TableCell className="font-medium tabular-nums">
                            {formatMoney(Number(s.total_amount))}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {s.remaining_installments > 0
                              ? formatMoney(Number(s.down_payment_amount))
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {s.remaining_installments > 0 ? `1 + ${s.remaining_installments}` : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {s.admin_name ?? "—"}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate text-muted-foreground">
                            {s.comment ?? "—"}
                          </TableCell>
                        </TableRow>
                      </RowContextMenu>
                    );
                  })
                )}
              </TableBody>
            </Table>

            <DataPagination {...table.pagination} />
          </div>
        </RequireStudio>
      </div>

      <SaleDialog open={saleOpen} onOpenChange={setSaleOpen} studioId={studioId} onSaved={reload} />
      <RefundDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        sale={refundSale}
        onSaved={reload}
      />
      {confirmDialog}
    </AdminShell>
  );
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
  remainingCount: 2 | 3;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  promoCode: string;
  comment: string;
};

/** Суммы продажи по форме: итог, первый взнос, скидка от тарифа, график рассрочки. */
function saleTotals(form: SaleFields, membership: MembershipRow | null) {
  const installment = membership?.installment_enabled ?? false;
  const total = Number(form.amount) || 0;
  const down = installment ? Number(form.downPayment) || 0 : total;
  const remaining = installment ? form.remainingCount : 0;
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

type SaleDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  onSaved: () => void;
};

function SaleDialog(props: SaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <SaleForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function SaleForm({ onOpenChange, studioId, onSaved }: SaleDialogProps) {
  const { confirm, confirmDialog } = useConfirm();
  const { data: staff } = useStaffProfile();
  const [form, setForm] = useState<SaleFields>(() => ({
    clientId: "",
    clientLabel: "",
    membershipId: "",
    soldAt: todayISO(),
    amount: "",
    downPayment: "",
    remainingCount: 2,
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
          .select("id, name, price, duration_days, visits_count, installment_enabled")
          .eq("studio_id", studioId!)
          .order("name"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить абонементы" },
  });

  const membership = memberships.find((m) => m.id === form.membershipId) ?? null;
  const t = saleTotals(form, membership);

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
    }));
  };

  const handleSave = async () => {
    if (!studioId || saving) return;
    const invalid = saleFormError(form, t);
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

      const { data: sale, error } = await supabase
        .from("sales")
        .insert({
          studio_id: studioId,
          client_id: form.clientId,
          membership_id: form.membershipId,
          admin_id: staff?.id ?? null,
          admin_name: staff?.displayName || null,
          sold_at: form.soldAt,
          total_amount: t.total,
          down_payment_amount: t.down,
          remaining_installments: t.remaining,
          source: "admin",
          payment_type: form.paymentType,
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
      <DialogBody>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Клиент</Label>
            <ClientCombobox
              studioId={studioId}
              value={form.clientId}
              onChange={(id, c) =>
                setForm((f) => ({ ...f, clientId: id, clientLabel: c ? clientName(c) : "" }))
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-date">Дата продажи</Label>
              <Input
                id="s-date"
                type="date"
                value={form.soldAt}
                onChange={(e) => set("soldAt", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Администратор</Label>
              <Input value={staff?.displayName ?? ""} disabled readOnly />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Абонемент</Label>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-amount">Стоимость, ₾</Label>
              <Input
                id="s-amount"
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
              {t.discount > 0 && t.listPrice != null && (
                <p className="text-xs text-muted-foreground">
                  Цена по тарифу {formatMoney(t.listPrice)}, скидка {formatMoney(t.discount)}.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Способ оплаты</Label>
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
            </div>
          </div>

          {t.installment ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-down">Первый взнос, ₾</Label>
                <Input
                  id="s-down"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.downPayment}
                  onChange={(e) => set("downPayment", e.target.value)}
                  placeholder="Сколько клиент вносит сейчас"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Ещё платежей</Label>
                <div className="flex gap-2">
                  {([2, 3] as const).map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant={form.remainingCount === n ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => set("remainingCount", n)}
                    >
                      {n} мес.
                    </Button>
                  ))}
                </div>
              </div>

              {t.schedule.length > 0 && (
                <ul className="divide-y rounded-md border bg-background text-sm">
                  {t.schedule.map((p, i) => (
                    <li key={i} className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-muted-foreground">
                        {p.isDownPayment ? "Первый взнос" : `Платёж ${i + 1}`} —{" "}
                        {formatDate(p.date)}
                      </span>
                      <span className="font-medium">{formatMoney(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : membership ? (
            <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              Рассрочка недоступна для этого абонемента. Оплата производится сразу.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Тип оплаты</Label>
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-promo">Промо-код</Label>
              <Input
                id="s-promo"
                value={form.promoCode}
                onChange={(e) => set("promoCode", e.target.value)}
                placeholder="Необязательно"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-comment">Комментарий</Label>
            <Textarea
              id="s-comment"
              rows={2}
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="Необязательно"
            />
          </div>

          {form.clientId && membership && (
            <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              Продажа абонемента «{membership.name}» клиенту {form.clientLabel}.
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
      </DialogFooter>
      {confirmDialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Возврат
// ---------------------------------------------------------------------------

type RefundDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sale: Sale | null;
  onSaved: () => void;
};

function RefundDialog({ open, onOpenChange, sale, onSaved }: RefundDialogProps) {
  // Продажу не сбрасываем при закрытии: форма остаётся на месте, пока окно
  // уезжает анимацией.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        {sale && (
          <RefundForm key={sale.id} sale={sale} onOpenChange={onOpenChange} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RefundForm({
  sale,
  onOpenChange,
  onSaved,
}: Omit<RefundDialogProps, "open"> & { sale: Sale }) {
  const { data: staff } = useStaffProfile();
  const [amount, setAmount] = useState(String(sale.total_amount ?? ""));
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    const raw = amount.replace(",", ".").trim();
    const amt = Number(raw);
    if (!raw || !Number.isFinite(amt) || amt <= 0) {
      toast.error("Укажите сумму возврата больше нуля");
      return;
    }
    if (amt > Number(sale.total_amount ?? 0)) {
      toast.error("Сумма возврата больше суммы продажи");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("refunds").insert({
        studio_id: sale.studio_id,
        sale_id: sale.id,
        amount: amt,
        reason: reason.trim() || null,
        method,
        refunded_by: staff?.id ?? null,
        refunded_by_name: staff?.displayName || null,
      });
      if (error) {
        toast.error("Ошибка возврата: " + error.message);
        return;
      }
      toast.success("Возврат зафиксирован");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Возврат</DialogTitle>
        <DialogDescription>
          Возврат по продаже{sale.memberships?.name ? ` «${sale.memberships.name}»` : ""}.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="r-amount">Сумма возврата, ₾</Label>
            <Input
              id="r-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Способ</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-reason">Причина (по желанию)</Label>
            <Textarea
              id="r-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Оформить возврат
        </Button>
      </DialogFooter>
    </>
  );
}
