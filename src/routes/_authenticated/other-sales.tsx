import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Loader2, Pencil, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { useRefreshSignal } from "@/lib/refresh-bus";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { ClientNameLink } from "@/components/client-name-link";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { formatMoneyPrecise as formatMoney, formatDate, todayISO } from "@/lib/format";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/other-sales")({
  head: () => ({ meta: [{ title: "Прочие продажи — Base40 Admin" }] }),
  component: OtherSalesPage,
});

// ---------------------------------------------------------------------------
// Типы и справочники
// ---------------------------------------------------------------------------
type ItemKind = "service" | "product";
type PaymentMethod = "cash" | "card" | "transfer" | "app";

type SaleItem = {
  id: string;
  studio_id: string;
  kind: ItemKind;
  name: string;
  price: number;
  is_active: boolean;
  created_at: string;
};

type OtherSale = {
  id: string;
  studio_id: string;
  item_id: string | null;
  item_kind: ItemKind;
  item_name: string;
  client_id: string | null;
  admin_name: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  payment_method: PaymentMethod | null;
  comment: string | null;
  sold_at: string;
  created_at: string;
  clients?: { first_name: string | null; last_name: string | null; full_name: string } | null;
};

type ClientRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
};

const KIND_LABEL: Record<ItemKind, string> = { service: "Услуга", product: "Товар" };
const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  app: "Приложение",
};

function clientName(c: { first_name: string | null; last_name: string | null; full_name: string }) {
  const joined = [c.last_name, c.first_name].filter(Boolean).join(" ").trim();
  return joined || c.full_name || "—";
}

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------
function OtherSalesPage() {
  const studioId = useActiveStudioId();
  const refreshSignal = useRefreshSignal();

  const [items, setItems] = useState<SaleItem[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);

  const fetchItems = useCallback(async () => {
    if (!studioId) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from("sale_items")
      .select("*")
      .eq("studio_id", studioId)
      .order("kind", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      toast.error("Не удалось загрузить позиции: " + error.message);
      return;
    }
    setItems((data as SaleItem[]) ?? []);
  }, [studioId]);

  const fetchClients = useCallback(async () => {
    if (!studioId) {
      setClients([]);
      return;
    }
    const { data } = await supabase
      .from("clients")
      .select("id, first_name, last_name, full_name, phone, email")
      .eq("studio_id", studioId)
      .order("full_name", { ascending: true });
    setClients((data as ClientRow[]) ?? []);
  }, [studioId]);

  useEffect(() => {
    fetchItems();
    fetchClients();
  }, [fetchItems, fetchClients, refreshSignal]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", data.user.id)
        .maybeSingle();
      setMe({ id: data.user.id, name: (p?.full_name as string) || data.user.email || "" });
    });
  }, []);

  return (
    <AdminShell title="Прочие продажи" description="Разовые продажи услуг и товаров">
      {!studioId ? (
        <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
          Сначала выберите студию в шапке.
        </div>
      ) : (
        <Tabs defaultValue="sales" className="space-y-3">
          <TabsList>
            <TabsTrigger value="sales">Продажи</TabsTrigger>
            <TabsTrigger value="catalog">Позиции</TabsTrigger>
          </TabsList>

          <TabsContent value="sales" className="space-y-3">
            <SalesTab
              studioId={studioId}
              items={items}
              clients={clients}
              me={me}
              refreshSignal={refreshSignal}
            />
          </TabsContent>

          <TabsContent value="catalog" className="space-y-3">
            <CatalogTab studioId={studioId} items={items} onChanged={fetchItems} />
          </TabsContent>
        </Tabs>
      )}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Вкладка «Продажи»
// ---------------------------------------------------------------------------
function SalesTab({
  studioId,
  items,
  clients,
  me,
  refreshSignal,
}: {
  studioId: string;
  items: SaleItem[];
  clients: ClientRow[];
  me: { id: string; name: string } | null;
  refreshSignal: number;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [rows, setRows] = useState<OtherSale[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("other_sales")
      .select("*, clients(first_name, last_name, full_name)")
      .eq("studio_id", studioId)
      .order("sold_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить продажи: " + error.message);
      return;
    }
    setRows((data as OtherSale[]) ?? []);
  }, [studioId]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales, refreshSignal]);

  const handleDelete = async (s: OtherSale) => {
    if (
      !(await confirm({
        title: "Удалить продажу?",
        description: `Продажа «${s.item_name}» будет удалена.`,
      }))
    )
      return;
    const { error } = await supabase.from("other_sales").delete().eq("id", s.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Продажа удалена");
    fetchSales();
  };

  const pg = usePagination(rows);

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)} disabled={items.length === 0}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить продажу
        </Button>
      </div>

      {items.length === 0 && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Сначала добавьте позиции во вкладке «Позиции» — их можно будет продавать.
        </div>
      )}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Позиция</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead className="text-right">Кол-во</TableHead>
              <TableHead className="text-right">Цена</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead>Оплата</TableHead>
              <TableHead>Дата</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={8} />
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Пока нет продаж. Нажмите «Добавить продажу».
                </TableCell>
              </TableRow>
            ) : (
              pg.paged.map((s) => (
                <RowContextMenu
                  key={s.id}
                  actions={[
                    {
                      label: "Удалить",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => handleDelete(s),
                    },
                  ]}
                >
                  <TableRow>
                    <TableCell className="font-medium">{s.item_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{KIND_LABEL[s.item_kind]}</Badge>
                    </TableCell>
                    <TableCell>
                      {s.client_id && s.clients ? (
                        <ClientNameLink clientId={s.client_id}>
                          {clientName(s.clients)}
                        </ClientNameLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(s.unit_price))}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(Number(s.total_amount))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.payment_method ? PAYMENT_LABEL[s.payment_method] : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(s.sold_at)}</TableCell>
                  </TableRow>
                </RowContextMenu>
              ))
            )}
          </TableBody>
        </Table>
        <DataPagination {...pg} />
      </div>

      <AddSaleDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        items={items}
        clients={clients}
        me={me}
        onSaved={fetchSales}
      />
      {confirmDialog}
    </>
  );
}

function AddSaleDialog({
  open,
  onOpenChange,
  studioId,
  items,
  clients,
  me,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string;
  items: SaleItem[];
  clients: ClientRow[];
  me: { id: string; name: string } | null;
  onSaved: () => void;
}) {
  const [itemId, setItemId] = useState("");
  const [clientId, setClientId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [soldAt, setSoldAt] = useState(todayISO());
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const activeItems = useMemo(() => items.filter((i) => i.is_active), [items]);
  const selectedItem = items.find((i) => i.id === itemId) ?? null;

  useEffect(() => {
    if (open) {
      setItemId("");
      setClientId("");
      setQuantity("1");
      setUnitPrice("");
      setPayment("cash");
      setSoldAt(todayISO());
      setComment("");
    }
  }, [open]);

  // При выборе позиции подставляем её цену
  useEffect(() => {
    if (selectedItem) setUnitPrice(String(selectedItem.price));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  const price = Number(String(unitPrice).replace(",", ".")) || 0;
  const total = qty * price;

  const handleSave = async () => {
    if (!selectedItem) {
      toast.error("Выберите позицию");
      return;
    }
    if (qty <= 0) {
      toast.error("Количество должно быть больше нуля");
      return;
    }
    if (price < 0) {
      toast.error("Цена не может быть отрицательной");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("other_sales").insert({
      studio_id: studioId,
      item_id: selectedItem.id,
      item_kind: selectedItem.kind,
      item_name: selectedItem.name,
      client_id: clientId || null,
      admin_id: me?.id ?? null,
      admin_name: me?.name ?? null,
      quantity: qty,
      unit_price: price,
      total_amount: total,
      payment_method: payment,
      sold_at: soldAt,
      comment: comment.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success("Продажа добавлена");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая продажа</DialogTitle>
          <DialogDescription>
            Выберите позицию, количество и цену. Клиент — по желанию.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Позиция</Label>
            <SearchableCombobox
              placeholder="Выбрать услугу или товар"
              searchPlaceholder="Поиск по названию"
              emptyText="Ничего не найдено"
              value={itemId}
              onChange={setItemId}
              options={activeItems.map((i) => ({
                value: i.id,
                label: i.name,
                hint: `${KIND_LABEL[i.kind]} · ${formatMoney(Number(i.price))}`,
                searchText: `${i.name} ${KIND_LABEL[i.kind]}`,
              }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="os-qty">Количество</Label>
              <Input
                id="os-qty"
                type="number"
                min={1}
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="os-price">Цена за штуку, ₾</Label>
              <Input
                id="os-price"
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Итого</span>
            <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>

          <div className="space-y-1.5">
            <Label>Клиент (по желанию)</Label>
            <SearchableCombobox
              placeholder="Без клиента"
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
            {clientId && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setClientId("")}
              >
                Убрать клиента
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Оплата</Label>
              <Select value={payment} onValueChange={(v) => setPayment(v as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="os-date">Дата</Label>
              <Input
                id="os-date"
                type="date"
                value={soldAt}
                onChange={(e) => setSoldAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Комментарий (по желанию)</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Заметка к продаже"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Продать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Вкладка «Позиции» (каталог услуг/товаров)
// ---------------------------------------------------------------------------
function CatalogTab({
  studioId,
  items,
  onChanged,
}: {
  studioId: string;
  items: SaleItem[];
  onChanged: () => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SaleItem | null>(null);

  const handleDelete = async (i: SaleItem) => {
    if (
      !(await confirm({
        title: "Удалить позицию?",
        description: `«${i.name}» пропадёт из каталога. Прошлые продажи сохранятся.`,
      }))
    )
      return;
    const { error } = await supabase.from("sale_items").delete().eq("id", i.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Позиция удалена");
    onChanged();
  };

  const toggleActive = async (i: SaleItem, next: boolean) => {
    const { error } = await supabase.from("sale_items").update({ is_active: next }).eq("id", i.id);
    if (error) {
      toast.error("Ошибка: " + error.message);
      return;
    }
    onChanged();
  };

  const pg = usePagination(items);

  return (
    <>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить позицию
        </Button>
      </div>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead className="text-right">Цена</TableHead>
              <TableHead className="w-[100px]">Активна</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  Пока нет позиций. Нажмите «Добавить позицию».
                </TableCell>
              </TableRow>
            ) : (
              pg.paged.map((i) => (
                <RowContextMenu
                  key={i.id}
                  actions={[
                    {
                      label: "Редактировать",
                      icon: Pencil,
                      onSelect: () => {
                        setEditing(i);
                        setOpen(true);
                      },
                    },
                    {
                      label: "Удалить",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => handleDelete(i),
                    },
                  ]}
                >
                  <TableRow>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{KIND_LABEL[i.kind]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(i.price))}
                    </TableCell>
                    <TableCell>
                      <Switch checked={i.is_active} onCheckedChange={(v) => toggleActive(i, v)} />
                    </TableCell>
                  </TableRow>
                </RowContextMenu>
              ))
            )}
          </TableBody>
        </Table>
        <DataPagination {...pg} />
      </div>

      <CatalogDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        item={editing}
        onSaved={onChanged}
      />
      {confirmDialog}
    </>
  );
}

function CatalogDialog({
  open,
  onOpenChange,
  studioId,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string;
  item: SaleItem | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ItemKind>("service");
  const [price, setPrice] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(item?.name ?? "");
      setKind(item?.kind ?? "service");
      setPrice(item ? String(item.price) : "");
      setIsActive(item?.is_active ?? true);
    }
  }, [open, item]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    const p = Number(String(price).replace(",", "."));
    if (!Number.isFinite(p) || p < 0) {
      toast.error("Укажите цену");
      return;
    }
    setSaving(true);
    const payload = {
      studio_id: studioId,
      kind,
      name: name.trim(),
      price: p,
      is_active: isActive,
    };
    const { error } = item
      ? await supabase.from("sale_items").update(payload).eq("id", item.id)
      : await supabase.from("sale_items").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success(item ? "Позиция обновлена" : "Позиция добавлена");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Редактировать позицию" : "Новая позиция"}</DialogTitle>
          <DialogDescription>Услуга или товар, доступные для продажи.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Тип</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ItemKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="service">Услуга</SelectItem>
                <SelectItem value="product">Товар</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Название</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "product" ? "Вода 0.5 л" : "Персональная тренировка"}
            />
          </div>

          <div className="space-y-2">
            <Label>Цена, ₾</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Активна</div>
              <div className="text-xs text-muted-foreground">
                Неактивные позиции не показываются при продаже.
              </div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Комбобокс с поиском (как в разделе «Продажи»)
// ---------------------------------------------------------------------------
