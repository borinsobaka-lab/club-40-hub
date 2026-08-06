import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";

export const Route = createFileRoute("/_authenticated/promocodes")({
  head: () => ({ meta: [{ title: "Промокоды — CLUB 40 Admin" }] }),
  component: PromoCodesPage,
});

type DiscountType = "amount" | "percent";

type PromoCode = {
  id: string;
  studio_id: string;
  name: string;
  code: string;
  expires_at: string | null;
  discount_type: DiscountType;
  discount_value: number;
  usage_limit: number | null;
  usage_count: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

function formatDiscount(type: DiscountType, value: number) {
  if (type === "percent") return `${value}%`;
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  const date = new Date(d);
  return new Intl.DateTimeFormat("ru-RU").format(date);
}

function PromoCodesPage() {
  const studioId = useActiveStudioId();
  const [items, setItems] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PromoCode | null>(null);

  const fetchAll = async () => {
    if (!studioId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("promo_codes")
      .select("*")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить промокоды: " + error.message);
      return;
    }
    setItems((data as PromoCode[]) ?? []);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshSignal]);

  const handleDelete = async (p: PromoCode) => {
    if (!confirm(`Удалить промокод «${p.name}»?`)) return;
    const { error } = await supabase.from("promo_codes").delete().eq("id", p.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Промокод удалён");
    fetchAll();
  };

  const toggleActive = async (p: PromoCode, next: boolean) => {
    const { error } = await supabase
      .from("promo_codes")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) {
      toast.error("Ошибка: " + error.message);
      return;
    }
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: next } : x)));
  };

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (p: PromoCode) => {
    setEditing(p);
    setOpen(true);
  };

  const pg = usePagination(items);

  return (
    <AdminShell
      title="Промокоды"
      actions={
        <Button size="default" onClick={openCreate} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить промокод
        </Button>
      }
    >
      <div className="space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Промокод</TableHead>
                  <TableHead>Скидка</TableHead>
                  <TableHead>Действует до</TableHead>
                  <TableHead>Применений</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead className="w-[100px]">Активен</TableHead>
                  <TableHead className="w-[110px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Пока нет промокодов. Нажмите «Добавить промокод».
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono uppercase">
                          {p.code}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDiscount(p.discount_type, p.discount_value)}</TableCell>
                      <TableCell>{formatDate(p.expires_at)}</TableCell>
                      <TableCell>
                        <span className="tabular-nums">
                          {p.usage_count}
                          {p.usage_limit != null ? ` / ${p.usage_limit}` : " / ∞"}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">
                        {p.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Switch checked={p.is_active} onCheckedChange={(v) => toggleActive(p, v)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(p)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <DataPagination {...pg} />
          </div>
        )}
      </div>

      <PromoCodeDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        item={editing}
        onSaved={fetchAll}
      />
    </AdminShell>
  );
}

function PromoCodeDialog({
  open,
  onOpenChange,
  studioId,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  item: PromoCode | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("amount");
  const [discountValue, setDiscountValue] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(item?.name ?? "");
      setCode(item?.code ?? "");
      setExpiresAt(item?.expires_at ?? "");
      setDiscountType(item?.discount_type ?? "amount");
      setDiscountValue(item ? String(item.discount_value) : "");
      setUsageLimit(item?.usage_limit != null ? String(item.usage_limit) : "");
      setDescription(item?.description ?? "");
      setIsActive(item?.is_active ?? true);
    }
  }, [open, item]);

  const handleSave = async () => {
    if (!studioId) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(cleanCode)) {
      toast.error("Промокод: только латинские буквы и цифры");
      return;
    }
    const dv = Number(discountValue.replace(",", "."));
    if (!Number.isFinite(dv) || dv <= 0) {
      toast.error("Укажите размер скидки");
      return;
    }
    if (discountType === "percent" && dv > 100) {
      toast.error("Процент скидки не может быть больше 100");
      return;
    }
    let limit: number | null = null;
    if (usageLimit.trim() !== "") {
      const n = Number(usageLimit);
      if (!Number.isInteger(n) || n <= 0) {
        toast.error("Количество применений — целое число > 0");
        return;
      }
      limit = n;
    }

    setSaving(true);
    const payload = {
      studio_id: studioId,
      name: name.trim(),
      code: cleanCode,
      expires_at: expiresAt || null,
      discount_type: discountType,
      discount_value: dv,
      usage_limit: limit,
      description: description.trim() || null,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    };
    const { error } = item
      ? await supabase.from("promo_codes").update(payload).eq("id", item.id)
      : await supabase.from("promo_codes").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success(item ? "Промокод обновлён" : "Промокод добавлен");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Редактировать промокод" : "Новый промокод"}</DialogTitle>
          <DialogDescription>Промокод можно применить при покупке для скидки.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Летняя акция"
            />
          </div>

          <div className="space-y-2">
            <Label>Промокод (латиница и цифры)</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="SUMMER25"
              className="font-mono uppercase"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Тип скидки</Label>
              <Select
                value={discountType}
                onValueChange={(v) => setDiscountType(v as DiscountType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">В рублях (₽)</SelectItem>
                  <SelectItem value="percent">В процентах (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Размер скидки</Label>
              <Input
                inputMode="decimal"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "percent" ? "10" : "500"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Срок действия</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Количество применений</Label>
              <Input
                inputMode="numeric"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Без ограничений"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Описание (внутреннее)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Для чего создан промокод"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Активен</div>
              <div className="text-xs text-muted-foreground">
                Неактивные промокоды нельзя применить.
              </div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {item && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Применений: <span className="font-medium text-foreground">{item.usage_count}</span>
              {item.usage_limit != null ? ` из ${item.usage_limit}` : " (без ограничений)"}
            </div>
          )}
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
