import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow, SwitchField } from "@/components/ui/field";
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
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { ClientNameLink } from "@/components/client-name-link";
import { useCrmLinks } from "@/hooks/use-crm-links";
import { ClientCombobox } from "@/components/client-combobox";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { clientName, formatMoneyPrecise, formatDate, todayISO } from "@/lib/format";
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
  clients: { first_name: string | null; last_name: string | null; full_name: string } | null;
};

const KIND_LABEL: Record<ItemKind, string> = { service: "Услуга", product: "Товар" };

/** Каталог позиций нужен обеим вкладкам — запрос у них общий через кэш. */
const saleItemsKey = (studioId: string) => ["sale_items", studioId];

function useSaleItems(studioId: string) {
  return useQuery({
    queryKey: saleItemsKey(studioId),
    queryFn: () =>
      unwrap<SaleItem[]>(
        supabase
          .from("sale_items")
          .select("*")
          .eq("studio_id", studioId)
          .order("kind", { ascending: true })
          .order("name", { ascending: true }),
      ),
    meta: { errorMessage: "Не удалось загрузить позиции" },
  });
}

/**
 * Цена из поля ввода («12,5» тоже). Пустое поле — null, а не 0: раньше
 * незаполненная цена молча сохранялась нулём.
 */
function parsePrice(raw: string) {
  const s = raw.trim().replace(",", ".");
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------
function OtherSalesPage() {
  const studioId = useActiveStudioId();

  return (
    <AdminShell title="Прочие продажи">
      <RequireStudio studioId={studioId}>
        <Tabs defaultValue="sales" className="space-y-3">
          <TabsList>
            <TabsTrigger value="sales">Продажи</TabsTrigger>
            <TabsTrigger value="catalog">Позиции</TabsTrigger>
          </TabsList>

          <TabsContent value="sales" className="space-y-3">
            <SalesTab studioId={studioId!} />
          </TabsContent>

          <TabsContent value="catalog" className="space-y-3">
            <CatalogTab studioId={studioId!} />
          </TabsContent>
        </Tabs>
      </RequireStudio>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Вкладка «Продажи»
// ---------------------------------------------------------------------------
function SalesTab({ studioId }: { studioId: string }) {
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: items = [], isLoading: itemsLoading } = useSaleItems(studioId);

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["other_sales", studioId],
    queryFn: () =>
      unwrap<OtherSale[]>(
        supabase
          .from("other_sales")
          .select("*, clients(first_name, last_name, full_name)")
          .eq("studio_id", studioId)
          .order("sold_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
      ),
    meta: { errorMessage: "Не удалось загрузить продажи" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["other_sales"] });

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
    reload();
  };

  const pg = usePagination(rows);
  const crmLinkOf = useCrmLinks(
    studioId,
    "id",
    pg.paged.map((s) => s.client_id),
  );

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)} disabled={items.length === 0}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить продажу
        </Button>
      </div>

      {/* Пока каталог грузится, он пуст — подсказку показываем только по факту. */}
      {!itemsLoading && items.length === 0 && (
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
                    <TableCell className="font-medium">
                      {s.client_id && s.clients ? (
                        <ClientNameLink clientId={s.client_id} crmLink={crmLinkOf(s.client_id)}>
                          {clientName(s.clients)}
                        </ClientNameLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneyPrecise(Number(s.unit_price))}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoneyPrecise(Number(s.total_amount))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.payment_method ? PAYMENT_METHOD_LABEL[s.payment_method] : "—"}
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
        onSaved={reload}
      />
      {confirmDialog}
    </>
  );
}

type AddSaleDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string;
  items: SaleItem[];
  onSaved: () => void;
};

function AddSaleDialog(props: AddSaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <AddSaleForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function AddSaleForm({ onOpenChange, studioId, items, onSaved }: AddSaleDialogProps) {
  const { ensure: ensureStaff } = useStaffProfile();
  const [form, setForm] = useState(() => ({
    itemId: "",
    clientId: "",
    quantity: "1",
    unitPrice: "",
    payment: "cash" as PaymentMethod,
    soldAt: todayISO(),
    comment: "",
  }));
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const [saving, setSaving] = useState(false);

  const selectedItem = items.find((i) => i.id === form.itemId) ?? null;

  // Цену позиции подставляем при выборе, а не эффектом по itemId.
  const pickItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    setForm((f) => ({ ...f, itemId: id, unitPrice: item ? String(item.price) : f.unitPrice }));
  };

  // Без прижатия к 1: иначе «0» или «-3» молча продавались как одна штука,
  // а проверка количества ниже никогда не срабатывала.
  const qty = Math.floor(Number(form.quantity) || 0);
  const price = parsePrice(form.unitPrice);
  const total = Math.round(Math.max(0, qty) * (price ?? 0) * 100) / 100;

  const handleSave = async () => {
    if (saving) return;
    if (!selectedItem) {
      toast.error("Выберите позицию");
      return;
    }
    if (qty <= 0) {
      toast.error("Количество должно быть больше нуля");
      return;
    }
    if (price === null) {
      toast.error("Укажите цену");
      return;
    }
    if (price < 0) {
      toast.error("Цена не может быть отрицательной");
      return;
    }
    if (!form.soldAt) {
      toast.error("Укажите дату продажи");
      return;
    }
    setSaving(true);
    try {
      const staff = await ensureStaff();
      const { error } = await supabase.from("other_sales").insert({
        studio_id: studioId,
        item_id: selectedItem.id,
        item_kind: selectedItem.kind,
        item_name: selectedItem.name,
        client_id: form.clientId || null,
        admin_id: staff?.id ?? null,
        admin_name: staff?.displayName || null,
        quantity: qty,
        unit_price: price,
        total_amount: total,
        payment_method: form.payment,
        sold_at: form.soldAt,
        comment: form.comment.trim() || null,
      });
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success("Продажа добавлена");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogForm onSubmit={handleSave}>
      <DialogHeader>
        <DialogTitle>Новая продажа</DialogTitle>
        <DialogDescription>
          Выберите позицию, количество и цену. Клиент — по желанию.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <Field label="Позиция" required>
            <SearchableCombobox
              placeholder="Выбрать услугу или товар"
              searchPlaceholder="Поиск по названию"
              emptyText="Ничего не найдено"
              value={form.itemId}
              onChange={pickItem}
              options={items
                .filter((i) => i.is_active)
                .map((i) => ({
                  value: i.id,
                  label: i.name,
                  hint: `${KIND_LABEL[i.kind]} · ${formatMoneyPrecise(Number(i.price))}`,
                  searchText: `${i.name} ${KIND_LABEL[i.kind]}`,
                }))}
            />
          </Field>

          <FieldRow>
            <Field label="Количество" required>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step="1"
                value={form.quantity}
                onChange={(e) => set("quantity", e.target.value)}
              />
            </Field>
            <Field label="Цена за штуку, ₾" required>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={form.unitPrice}
                onChange={(e) => set("unitPrice", e.target.value)}
              />
            </Field>
          </FieldRow>

          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Итого</span>
            <span className="font-semibold tabular-nums">{formatMoneyPrecise(total)}</span>
          </div>

          <Field label="Клиент">
            <ClientCombobox
              studioId={studioId}
              value={form.clientId}
              onChange={(id) => set("clientId", id)}
              placeholder="Без клиента"
              clearable
            />
          </Field>

          <FieldRow>
            <Field label="Оплата">
              <Select
                value={form.payment}
                onValueChange={(v) => set("payment", v as PaymentMethod)}
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
            </Field>
            <Field label="Дата" required>
              <Input
                type="date"
                value={form.soldAt}
                onChange={(e) => set("soldAt", e.target.value)}
              />
            </Field>
          </FieldRow>

          <Field label="Комментарий">
            <Textarea
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="Заметка к продаже"
              rows={2}
            />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Отмена
        </Button>
        <Button type="submit" loading={saving}>
          Продать
        </Button>
      </DialogFooter>
    </DialogForm>
  );
}

// ---------------------------------------------------------------------------
// Вкладка «Позиции» (каталог услуг/товаров)
// ---------------------------------------------------------------------------
function CatalogTab({ studioId }: { studioId: string }) {
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SaleItem | null>(null);
  const { data: items = [], isLoading: loading } = useSaleItems(studioId);
  const reload = () => queryClient.invalidateQueries({ queryKey: ["sale_items"] });

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
    reload();
  };

  const toggleActive = async (i: SaleItem, next: boolean) => {
    const { error } = await supabase.from("sale_items").update({ is_active: next }).eq("id", i.id);
    if (error) {
      toast.error("Ошибка: " + error.message);
      return;
    }
    queryClient.setQueryData<SaleItem[]>(saleItemsKey(studioId), (prev) =>
      prev?.map((x) => (x.id === i.id ? { ...x, is_active: next } : x)),
    );
  };

  const openDialog = (i: SaleItem | null) => {
    setEditing(i);
    setOpen(true);
  };

  const pg = usePagination(items);

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => openDialog(null)}>
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
            {loading ? (
              <TableSkeletonRows columns={4} />
            ) : items.length === 0 ? (
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
                    { label: "Редактировать", icon: Pencil, onSelect: () => openDialog(i) },
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
                      {formatMoneyPrecise(Number(i.price))}
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
        onSaved={reload}
      />
      {confirmDialog}
    </>
  );
}

type CatalogDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string;
  item: SaleItem | null;
  onSaved: () => void;
};

function CatalogDialog(props: CatalogDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <CatalogForm key={props.item?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function CatalogForm({ onOpenChange, studioId, item, onSaved }: CatalogDialogProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "service");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    const p = parsePrice(price);
    if (p === null || p < 0) {
      toast.error("Укажите цену");
      return;
    }
    setSaving(true);
    try {
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
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(item ? "Позиция обновлена" : "Позиция добавлена");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogForm onSubmit={handleSave}>
      <DialogHeader>
        <DialogTitle>{item ? "Редактировать позицию" : "Новая позиция"}</DialogTitle>
        <DialogDescription>Услуга или товар, доступные для продажи.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <Field label="Тип">
            <Select value={kind} onValueChange={(v) => setKind(v as ItemKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="service">Услуга</SelectItem>
                <SelectItem value="product">Товар</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Название" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "product" ? "Вода 0.5 л" : "Персональная тренировка"}
            />
          </Field>

          <Field label="Цена, ₾" required>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
            />
          </Field>

          <SwitchField
            label="Активна"
            description="Неактивные позиции не показываются при продаже."
            checked={isActive}
            onCheckedChange={setIsActive}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Отмена
        </Button>
        <Button type="submit" loading={saving}>
          Сохранить
        </Button>
      </DialogFooter>
    </DialogForm>
  );
}
