import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useEffect, useMemo, useState } from "react";
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
import { DataPagination, usePagination } from "@/components/data-pagination";
import { ClientCardDialog } from "@/components/client-card-dialog";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({ meta: [{ title: "Продажи — CLUB 40 Admin" }] }),
  component: SalesPage,
});

type ClientRow = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  notes: string | null;
  registration_date: string | null;
  last_visit_date: string | null;
  crm_link: string | null;
  photo_url: string | null;
  avatar_url: string | null;
};

type MembershipRow = {
  id: string;
  name: string;
  price: number;
  duration_days: number | null;
  visits_count: number | null;
};

type Sale = {
  id: string;
  studio_id: string;
  client_id: string;
  membership_id: string;
  admin_id: string | null;
  admin_name: string | null;
  sold_at: string;
  total_amount: number;
  installments: number;
  comment: string | null;
  created_at: string;
  clients: { id: string; full_name: string; first_name: string | null; last_name: string | null } | null;
  memberships: { id: string; name: string } | null;
};

function clientName(c: { first_name: string | null; last_name: string | null; full_name: string }) {
  return [c.last_name, c.first_name].filter(Boolean).join(" ").trim() || c.full_name || "—";
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
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
  // Split into equal parts; last one absorbs rounding.
  const part = Math.round((total / parts) * 100) / 100;
  const arr = Array(parts).fill(part);
  const sum = part * parts;
  arr[parts - 1] = Math.round((total - part * (parts - 1)) * 100) / 100;
  return sum === total ? arr.map((v) => Math.round(v * 100) / 100) : arr;
}

function SalesPage() {
  const studioId = useActiveStudioId();
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardClient, setCardClient] = useState<ClientRow | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);

  const fetchSales = async () => {
    if (!studioId) {
      setSales([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("sales")
      .select(
        "id, studio_id, client_id, membership_id, admin_id, admin_name, sold_at, total_amount, installments, comment, created_at, clients(id, full_name, first_name, last_name), memberships(id, name)",
      )
      .eq("studio_id", studioId)
      .order("sold_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить продажи: " + error.message);
      return;
    }
    setSales((data as unknown as Sale[]) ?? []);
  };

  const fetchClients = async () => {
    if (!studioId) return;
    const { data } = await supabase
      .from("clients")
      .select("*")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    setClients((data as ClientRow[]) ?? []);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchSales();
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshSignal]);

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

  const openClientCard = (clientId: string) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) {
      toast.error("Клиент не найден");
      return;
    }
    setCardClient(c);
    setCardOpen(true);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? sales.filter((s) => {
        const name = s.clients ? clientName(s.clients).toLowerCase() : "";
        const m = (s.memberships?.name ?? "").toLowerCase();
        return name.includes(q) || m.includes(q);
      })
    : sales;

  const pg = usePagination(filtered);

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
      <div className="mx-auto max-w-6xl space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-background px-3 py-2">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по клиенту или абонементу"
                  className="h-8 pl-9"
                />
              </div>
            </div>

            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Абонемент</TableHead>
                    <TableHead>Сумма</TableHead>
                    <TableHead>Рассрочка</TableHead>
                    <TableHead>Администратор</TableHead>
                    <TableHead>Комментарий</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                        {sales.length === 0
                          ? "Продаж пока нет. Нажмите «Новая продажа»."
                          : "Ничего не найдено."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.paged.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{formatDate(s.sold_at)}</TableCell>
                        <TableCell>
                          {s.clients ? (
                            <button
                              type="button"
                              onClick={() => openClientCard(s.client_id)}
                              className="text-left underline-offset-2 hover:underline hover:text-primary"
                            >
                              {clientName(s.clients)}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{s.memberships?.name ?? "—"}</TableCell>
                        <TableCell className="font-medium">{formatMoney(Number(s.total_amount))}</TableCell>
                        <TableCell>
                          {s.installments > 1 ? `${s.installments} мес.` : "Сразу"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.admin_name ?? "—"}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-muted-foreground">
                          {s.comment ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(s)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
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

      <ClientCardDialog open={cardOpen} onOpenChange={setCardOpen} client={cardClient} />
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
  const [installments, setInstallments] = useState<1 | 2 | 3>(1);
  const [comment, setComment] = useState<string>("");
  const [adminName, setAdminName] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setMembershipId("");
    setSoldAt(todayISO());
    setAmount("");
    setInstallments(1);
    setComment("");
  }, [open]);

  useEffect(() => {
    if (!open || !studioId) return;
    supabase
      .from("memberships")
      .select("id, name, price, duration_days, visits_count")
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
        const name = (data?.full_name as string | null) || (data?.email as string | null) || adminEmail || "";
        setAdminName(name);
      });
  }, [open, adminId, adminEmail]);

  const selectedMembership = memberships.find((m) => m.id === membershipId) ?? null;
  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  // Auto-fill price when membership changes.
  useEffect(() => {
    if (selectedMembership) setAmount(String(selectedMembership.price ?? 0));
  }, [selectedMembership]);

  const total = Number(amount) || 0;
  const schedule = useMemo(() => {
    if (installments === 1) return [];
    const parts = splitAmount(total, installments);
    return parts.map((p, i) => ({
      date: i === 0 ? soldAt : addMonthsISO(soldAt, i),
      amount: p,
    }));
  }, [installments, total, soldAt]);

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
        installments,
        comment: comment.trim() || null,
      })
      .select("id")
      .single();
    if (error || !sale) {
      setSaving(false);
      toast.error("Ошибка сохранения: " + (error?.message ?? "unknown"));
      return;
    }
    if (installments > 1 && schedule.length > 0) {
      const rows = schedule.map((s) => ({
        sale_id: sale.id,
        due_date: s.date,
        amount: s.amount,
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
              <Input id="s-date" type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
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
            <Label htmlFor="s-amount">Стоимость, ₽</Label>
            <Input
              id="s-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Рассрочка</Label>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={installments === n ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setInstallments(n)}
                >
                  {n === 1 ? "Сразу" : `${n} мес.`}
                </Button>
              ))}
            </div>
            {schedule.length > 0 && (
              <ul className="mt-2 divide-y rounded-md border bg-muted/30 text-sm">
                {schedule.map((p, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-muted-foreground">
                      Платёж {i + 1} — {formatDate(p.date)}
                    </span>
                    <span className="font-medium">{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
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
