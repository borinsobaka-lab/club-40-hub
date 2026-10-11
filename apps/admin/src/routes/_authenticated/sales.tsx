import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Trash2, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useActiveStudio } from "@/hooks/use-studios";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { useServerTable } from "@/hooks/use-server-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  PAYMENT_TYPE_LABEL,
  SALE_KIND_DOT,
  SALE_KIND_LABEL,
  SALE_KINDS,
  SALE_TIPS,
  saleSourceLabel,
  type PaymentMethod,
  type PaymentType,
  type SaleKind,
} from "@/lib/payments";
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
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { celebrateSale } from "@/lib/confetti";
import { DataPagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarSearch } from "@/components/table-toolbar";
import { ClientNameLink } from "@/components/client-name-link";
import { useCrmLinks } from "@/hooks/use-crm-links";
import { SaleDialog } from "@/components/sale-dialog";
import { CommentCell } from "@/components/comment-cell";
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

/** Подсказки «?» колонок — те же, что у полей формы продажи. */
const TIPS = SALE_TIPS;

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({ meta: [{ title: "Продажи — Base40 Admin" }] }),
  component: SalesPage,
});

// Колонки вью sales_list. search_text не запрашиваем — он нужен только для
// фильтра на сервере. Связанные объекты (clients / memberships /
// client_memberships) вью отдаёт в той же форме, что раньше вложенный select.
const SALE_COLUMNS =
  "id, studio_id, client_id, membership_id, admin_id, admin_name, sold_at, total_amount, " +
  "down_payment_amount, remaining_installments, source, payment_type, sale_kind, trainer_name, promo_code, comment, " +
  "created_at, clients, memberships, client_memberships";

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
  /** Тип продажи пакетной студии; null — без типа (подписочная, приложение). */
  sale_kind: SaleKind | null;
  /** Пакетная студия: тренер при продаже (снимок имени). */
  trainer_name: string | null;
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

function SaleKindDot({ kind }: { kind: SaleKind }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2.5 shrink-0 rounded-full", SALE_KIND_DOT[kind])}
    />
  );
}

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

function SalesPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  // Пакетная студия: четыре типа продаж и колонка «Тип продажи» вместо
  // «Типа оплаты» (STUDIO_FORMATS.md).
  const isPackages = useActiveStudio()?.format === "packages";
  // У пакетной студии ещё колонка «Тренер».
  const columns = isPackages ? 14 : 13;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleKind, setSaleKind] = useState<SaleKind>("new");
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
  const crmLinkOf = useCrmLinks(
    studioId,
    "id",
    table.rows.map((s) => s.client_id),
  );

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

  const openSale = (k: SaleKind) => {
    setSaleKind(k);
    setSaleOpen(true);
  };

  const openRefund = (s: Sale) => {
    setRefundSale(s);
    setRefundOpen(true);
  };

  return (
    <AdminShell
      title="Продажи"
      actions={
        isPackages ? (
          // Обёртка с отступами: на широком экране .shell-actions — не flex,
          // и кнопки без неё слипались; до lg её раскладывает .shell-actions > div.
          <div className="flex flex-wrap gap-2">
            {SALE_KINDS.map((k) => (
              <Button key={k} onClick={() => openSale(k)} disabled={!studioId}>
                <SaleKindDot kind={k} />
                {SALE_KIND_LABEL[k]}
              </Button>
            ))}
          </div>
        ) : (
          <Button onClick={() => openSale("new")} disabled={!studioId}>
            <Plus />
            Новая продажа
          </Button>
        )
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
                  <TableHead tip={TIPS.soldAt}>Дата</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead tip={TIPS.membership}>Абонемент</TableHead>
                  <TableHead>Статус</TableHead>
                  {isPackages ? (
                    <TableHead tip={TIPS.saleKind}>Тип продажи</TableHead>
                  ) : (
                    <TableHead tip={TIPS.paymentType}>Тип оплаты</TableHead>
                  )}
                  <TableHead tip={TIPS.promo}>Промо-код</TableHead>
                  <TableHead tip={TIPS.amount}>Сумма</TableHead>
                  <TableHead tip={TIPS.downPayment}>Первый взнос</TableHead>
                  <TableHead tip={TIPS.installments}>Рассрочка</TableHead>
                  <TableHead tip={TIPS.admin}>Администратор</TableHead>
                  {isPackages && <TableHead tip={TIPS.trainer}>Тренер</TableHead>}
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.loading ? (
                  <TableSkeletonRows columns={columns} />
                ) : table.rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns}
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
                              <ClientNameLink
                                clientId={s.client_id}
                                crmLink={crmLinkOf(s.client_id)}
                              >
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
                            {isPackages ? (
                              s.sale_kind ? (
                                <span className="inline-flex items-center gap-2">
                                  <SaleKindDot kind={s.sale_kind} />
                                  {SALE_KIND_LABEL[s.sale_kind]}
                                </span>
                              ) : (
                                "—"
                              )
                            ) : (
                              PAYMENT_TYPE_LABEL[s.payment_type ?? "other"]
                            )}
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
                          {isPackages && (
                            <TableCell className="text-muted-foreground">
                              {s.trainer_name ?? "—"}
                            </TableCell>
                          )}
                          <TableCell>
                            <CommentCell text={s.comment} />
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

      <SaleDialog
        open={saleOpen}
        onOpenChange={setSaleOpen}
        studioId={studioId}
        onSaved={reload}
        kind={saleKind}
      />
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
      <DialogContent className="max-w-md">
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
  const { ensure: ensureStaff } = useStaffProfile();
  // Уже оформленные возвраты по продаже: сумма всех возвратов не должна
  // превышать сумму продажи.
  const { data: refunded, isLoading: loadingRefunded } = useQuery({
    queryKey: ["refunds", "by-sale", sale.id],
    queryFn: async () => {
      const rows = await unwrap<{ amount: number | string | null }[]>(
        supabase.from("refunds").select("amount").eq("sale_id", sale.id),
      );
      return rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    },
    meta: { errorMessage: "Не удалось загрузить прошлые возвраты" },
  });
  const available = Math.max(0, Number(sale.total_amount ?? 0) - (refunded ?? 0));
  // По умолчанию — остаток к возврату; пока админ не ввёл своё значение.
  const [amountInput, setAmount] = useState<string | null>(null);
  const amount = amountInput ?? (refunded === undefined ? "" : String(available));
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
    if (refunded === undefined) {
      toast.error("Не удалось проверить прошлые возвраты — обновите страницу");
      return;
    }
    if (amt > available) {
      toast.error(
        refunded > 0
          ? `Сумма возврата больше остатка: по продаже уже возвращено ${formatMoney(refunded)}`
          : "Сумма возврата больше суммы продажи",
      );
      return;
    }
    setSaving(true);
    try {
      const staff = await ensureStaff();
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
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField
              label="Сумма возврата, ₾"
              required
              tip="Можно вернуть часть. Абонемент клиента возврат не отменяет — при необходимости измените его в карточке клиента."
              hint={
                refunded
                  ? `Уже возвращено ${formatMoney(refunded)}, доступно ${formatMoney(available)}`
                  : undefined
              }
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FormField>
            <FormField
              label="Способ"
              tip="Как вернули деньги. В «Кассу» возврат сам не попадает."
              required
            >
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
            </FormField>
            <FormField label="Причина" optional>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving || loadingRefunded}>
            {saving && <Loader2 className="animate-spin" />}
            Оформить возврат
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
