import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Loader2, Trash2, Search, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination, useServerPagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarSearch } from "@/components/table-toolbar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ClientNameLink } from "@/components/client-name-link";
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

// Диалогу новой продажи нужны только имя и контакты для выпадающего списка.
type ClientRow = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};

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

function SourceBadge({ source }: { source: "admin" | "mobile" }) {
  const isMobile = source === "mobile";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        isMobile
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : "bg-muted text-muted-foreground",
      )}
    >
      {isMobile ? "Приложение" : "Портал"}
    </span>
  );
}

function clientName(c: { first_name: string | null; last_name: string | null; full_name: string }) {
  return [c.last_name, c.first_name].filter(Boolean).join(" ").trim() || c.full_name || "—";
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "GEL",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("ru-RU");
  } catch {
    return v;
  }
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function addMonthsISO(iso: string, months: number) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function splitAmount(total: number, parts: number) {
  const part = Math.round((total / parts) * 100) / 100;
  const arr = Array(parts).fill(part);
  arr[parts - 1] = Math.round((total - part * (parts - 1)) * 100) / 100;
  return arr.map((v) => Math.round(v * 100) / 100);
}

function SalesPage() {
  const studioId = useActiveStudioId();
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientRow[]>([]);

  const debouncedSearch = useDebouncedValue(search);
  const pg = useServerPagination();
  const { from, to, setTotal, setPage } = pg;

  useEffect(() => {
    setPage(1);
  }, [studioId, debouncedSearch, setPage]);

  const fetchSales = useCallback(async () => {
    if (!studioId) {
      setSales([]);
      setTotal(0);
      return;
    }
    setLoading(true);

    let query = supabase
      .from("sales_list")
      .select(SALE_COLUMNS, { count: "exact" })
      .eq("studio_id", studioId);

    const term = debouncedSearch.trim();
    if (term) query = query.ilike("search_text", `%${term}%`);

    const { data, error, count } = await query
      .order("sold_at", { ascending: false })
      .range(from, to);

    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить продажи: " + error.message);
      return;
    }
    setSales((data as unknown as Sale[]) ?? []);
    setTotal(count ?? 0);
  }, [studioId, debouncedSearch, from, to, setTotal]);

  const fetchClients = useCallback(async () => {
    if (!studioId) return;
    // Диалогу продажи нужны только имя и контакты — тянуть всю карточку
    // клиента (заметки, фото, CRM-ссылку) на каждую загрузку страницы незачем.
    const { data } = await supabase
      .from("clients")
      .select("id, full_name, first_name, last_name, phone, email")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    setClients((data as ClientRow[]) ?? []);
  }, [studioId]);

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchSales();
  }, [fetchSales, refreshSignal]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients, refreshSignal]);

  const handleDelete = async (s: Sale) => {
    if (!confirm("Удалить эту продажу?")) return;
    const { error } = await supabase.from("sales").delete().eq("id", s.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Продажа удалена");
    fetchSales();
  };

  return (
    <AdminShell
      title="Продажи"
      actions={
        <Button onClick={() => setOpen(true)} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Новая продажа
        </Button>
      }
    >
      <div className="space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
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
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={14} className="py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : sales.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={14}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        {debouncedSearch.trim()
                          ? "Ничего не найдено."
                          : "Продаж пока нет. Нажмите «Новая продажа»."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sales.map((s) => {
                      const cm = s.client_memberships?.[0] ?? null;
                      return (
                        <TableRow key={s.id}>
                          <TableCell>
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
                            <SourceBadge source={s.source ?? "admin"} />
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
                            {PAYMENT_TYPE_LABEL[(s.payment_type ?? "other") as PaymentType]}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {s.promo_code ?? "—"}
                          </TableCell>
                          <TableCell className="font-medium">
                            {formatMoney(Number(s.total_amount))}
                          </TableCell>
                          <TableCell>
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
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(s)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>

              <DataPagination {...pg} />
            </div>
          </>
        )}
      </div>

      <SaleDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        adminId={user?.id ?? null}
        adminEmail={user?.email ?? null}
        clients={clients}
        onSaved={fetchSales}
      />
    </AdminShell>
  );
}

function SaleDialog({
  open,
  onOpenChange,
  studioId,
  adminId,
  adminEmail,
  clients,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  adminId: string | null;
  adminEmail: string | null;
  clients: ClientRow[];
  onSaved: () => void;
}) {
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [membershipId, setMembershipId] = useState<string>("");
  const [soldAt, setSoldAt] = useState<string>(todayISO());
  const [amount, setAmount] = useState<string>("");
  const [downPayment, setDownPayment] = useState<string>("");
  const [remainingCount, setRemainingCount] = useState<2 | 3>(2);
  const [comment, setComment] = useState<string>("");
  const [paymentType, setPaymentType] = useState<PaymentType>("first");
  const [promoCode, setPromoCode] = useState<string>("");
  const [adminName, setAdminName] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setMembershipId("");
    setSoldAt(todayISO());
    setAmount("");
    setDownPayment("");
    setRemainingCount(2);
    setComment("");
    setPaymentType("first");
    setPromoCode("");
  }, [open]);

  useEffect(() => {
    if (!open || !studioId) return;
    supabase
      .from("memberships")
      .select("id, name, price, duration_days, visits_count, installment_enabled")
      .eq("studio_id", studioId)
      .order("name")
      .then(({ data }) => setMemberships((data as MembershipRow[]) ?? []));
  }, [open, studioId]);

  // Resolve admin display name from profiles, fall back to email.
  useEffect(() => {
    if (!open || !adminId) return;
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", adminId)
      .maybeSingle()
      .then(({ data }) => {
        const name =
          (data?.full_name as string | null) || (data?.email as string | null) || adminEmail || "";
        setAdminName(name);
      });
  }, [open, adminId, adminEmail]);

  const selectedMembership = memberships.find((m) => m.id === membershipId) ?? null;
  const selectedClient = clients.find((c) => c.id === clientId) ?? null;
  const installmentEnabled = selectedMembership?.installment_enabled ?? false;

  // Auto-fill price when membership changes.
  useEffect(() => {
    if (selectedMembership) {
      const price = String(selectedMembership.price ?? 0);
      setAmount(price);
      if (selectedMembership.installment_enabled) {
        setDownPayment("");
        setRemainingCount(2);
      } else {
        setDownPayment(price);
      }
    } else {
      setAmount("");
      setDownPayment("");
    }
  }, [selectedMembership]);

  const total = Number(amount) || 0;
  const down = installmentEnabled ? Number(downPayment) || 0 : total;
  const remaining = installmentEnabled ? remainingCount : 0;
  const remainingTotal = Math.max(0, total - down);

  const schedule = useMemo(() => {
    if (!installmentEnabled || remaining === 0 || remainingTotal <= 0) return [];
    const parts = splitAmount(remainingTotal, remaining);
    return [
      { date: soldAt, amount: down, isDownPayment: true },
      ...parts.map((p, i) => ({
        date: addMonthsISO(soldAt, i + 1),
        amount: p,
        isDownPayment: false,
      })),
    ];
  }, [installmentEnabled, remaining, remainingTotal, down, soldAt]);

  const handleSave = async () => {
    if (!studioId) return;
    if (!clientId) {
      toast.error("Выберите клиента");
      return;
    }
    if (!membershipId) {
      toast.error("Выберите абонемент");
      return;
    }
    if (!total || total <= 0) {
      toast.error("Укажите стоимость");
      return;
    }
    if (installmentEnabled) {
      if (down <= 0) {
        toast.error("Укажите первый взнос");
        return;
      }
      if (down >= total) {
        toast.error("Первый взнос должен быть меньше общей суммы");
        return;
      }
      if (remainingTotal <= 0) {
        toast.error("Остаток после первого взноса должен быть больше 0");
        return;
      }
    }

    // Confirm replacement when client already has an active membership.
    const { data: existing } = await supabase
      .from("client_memberships")
      .select("id, memberships(name)")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();
    if (existing) {
      const m = (
        existing as unknown as { memberships: { name: string } | { name: string }[] | null }
      ).memberships;
      const name = Array.isArray(m) ? (m[0]?.name ?? "—") : (m?.name ?? "—");
      if (
        !confirm(
          `У клиента уже есть активный абонемент «${name}». Новая продажа заменит его. Продолжить?`,
        )
      ) {
        return;
      }
    }

    setSaving(true);
    const { data: sale, error } = await supabase
      .from("sales")
      .insert({
        studio_id: studioId,
        client_id: clientId,
        membership_id: membershipId,
        admin_id: adminId,
        admin_name: adminName || null,
        sold_at: soldAt,
        total_amount: total,
        down_payment_amount: down,
        remaining_installments: remaining,
        source: "admin",
        payment_type: paymentType,
        promo_code: promoCode.trim() || null,
        comment: comment.trim() || null,
      })
      .select("id")
      .single();
    if (error || !sale) {
      setSaving(false);
      toast.error("Ошибка сохранения: " + (error?.message ?? "unknown"));
      return;
    }
    if (schedule.length > 0) {
      const rows = schedule.map((s) => ({
        sale_id: sale.id,
        due_date: s.date,
        amount: s.amount,
        paid: s.isDownPayment,
      }));
      const { error: instErr } = await supabase.from("sale_installments").insert(rows);
      if (instErr) {
        toast.error("Продажа создана, но не записан график: " + instErr.message);
      }
    }
    setSaving(false);
    toast.success("Продажа создана");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая продажа</DialogTitle>
          <DialogDescription>
            Выберите клиента и абонемент. Стоимость подтянется автоматически.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Клиент</Label>
            <SearchableCombobox
              placeholder="Выбрать клиента"
              searchPlaceholder="Поиск по имени, телефону, email"
              emptyText="Ничего не найдено"
              value={clientId}
              onChange={setClientId}
              options={clients.map((c) => ({
                value: c.id,
                label: clientName(c),
                hint: c.phone ?? c.email ?? "",
                searchText: `${clientName(c)} ${c.phone ?? ""} ${c.email ?? ""}`,
              }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-date">Дата продажи</Label>
              <Input
                id="s-date"
                type="date"
                value={soldAt}
                onChange={(e) => setSoldAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Администратор</Label>
              <Input value={adminName} disabled readOnly />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Абонемент</Label>
            <SearchableCombobox
              placeholder="Выбрать абонемент"
              searchPlaceholder="Поиск по названию"
              emptyText="Ничего не найдено"
              value={membershipId}
              onChange={setMembershipId}
              options={memberships.map((m) => ({
                value: m.id,
                label: m.name,
                hint: formatMoney(Number(m.price ?? 0)),
                searchText: m.name,
              }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-amount">Стоимость, ₾</Label>
            <Input
              id="s-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {installmentEnabled ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-down">Первый взнос, ₾</Label>
                <Input
                  id="s-down"
                  type="number"
                  min={0}
                  step="0.01"
                  value={downPayment}
                  onChange={(e) => setDownPayment(e.target.value)}
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
                      variant={remainingCount === n ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setRemainingCount(n)}
                    >
                      {n} мес.
                    </Button>
                  ))}
                </div>
              </div>

              {schedule.length > 0 && (
                <ul className="divide-y rounded-md border bg-background text-sm">
                  {schedule.map((p, i) => (
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
          ) : selectedMembership ? (
            <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              Рассрочка недоступна для этого абонемента. Оплата производится сразу.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Тип оплаты</Label>
              <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first">Первая оплата</SelectItem>
                  <SelectItem value="recurring">Регулярная оплата</SelectItem>
                  <SelectItem value="other">Другое</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-promo">Промо-код</Label>
              <Input
                id="s-promo"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Необязательно"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-comment">Комментарий</Label>
            <Textarea
              id="s-comment"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Необязательно"
            />
          </div>

          {selectedClient && selectedMembership && (
            <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              Продажа абонемента «{selectedMembership.name}» клиенту {clientName(selectedClient)}.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ComboOption = { value: string; label: string; hint?: string; searchText: string };

function SearchableCombobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const opt = options.find((o) => o.value === itemValue);
            if (!opt) return 0;
            return opt.searchText.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={(v) => {
                    onChange(v);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">{o.hint}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
