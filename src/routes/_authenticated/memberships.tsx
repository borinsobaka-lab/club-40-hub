import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useEffect, useRef, useState } from "react";
import { Plus, Loader2, Pencil, Trash2, X, Search, Copy, Image as ImageIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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

export const Route = createFileRoute("/_authenticated/memberships")({
  head: () => ({ meta: [{ title: "Номенклатуры — CLUB 40 Admin" }] }),
  component: MembershipsPage,
});

type Membership = {
  id: string;
  studio_id: string;
  name: string;
  description: string | null;
  benefits: string[];
  visits_count: number | null;
  duration_days: number | null;
  auto_renew: boolean;
  installment_enabled: boolean;
  price: number;
  is_active: boolean;
  cover_url: string | null;
};

const COVER_BUCKET = "memberships-media";

function isHttpUrl(v: string | null | undefined) {
  return !!v && /^https?:\/\//i.test(v);
}

async function resolveCoverSrc(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (isHttpUrl(value)) return value;
  const { data } = supabase.storage.from(COVER_BUCKET).getPublicUrl(value);
  return data?.publicUrl ?? null;
}

function CoverThumb({ value, alt }: { value: string | null; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveCoverSrc(value).then((s) => {
      if (!cancelled) setSrc(s);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!src) {
    return (
      <div className="flex h-12 w-16 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="h-12 w-16 rounded-md border bg-background object-contain"
    />
  );
}

function formatPrice(v: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "GEL", maximumFractionDigits: 0 }).format(v);
}

function formatDuration(days: number | null) {
  if (!days) return "—";
  if (days % 365 === 0) return `${days / 365} г.`;
  if (days % 30 === 0) return `${days / 30} мес.`;
  return `${days} дн.`;
}

function MembershipsPage() {
  const studioId = useActiveStudioId();
  const [items, setItems] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);

  const fetchItems = async () => {
    if (!studioId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("memberships")
      .select("*")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить номенклатуры: " + error.message);
      return;
    }
    setItems((data as Membership[]) ?? []);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshSignal]);


  const handleDelete = async (m: Membership) => {
    if (!confirm(`Удалить «${m.name}»?`)) return;
    const { error } = await supabase.from("memberships").delete().eq("id", m.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Номенклатура удалена");
    fetchItems();
  };

  const handleToggleActive = async (m: Membership, next: boolean) => {
    const { error } = await supabase
      .from("memberships")
      .update({ is_active: next })
      .eq("id", m.id);
    if (error) {
      toast.error("Не удалось изменить статус: " + error.message);
      return;
    }
    toast.success(next ? "Абонемент активен" : "Абонемент скрыт в приложении");
    fetchItems();
  };

  const handleClone = (m: Membership) => {
    setEditing({
      ...m,
      id: "",
      name: `${m.name} (копия)`,
      is_active: true,
    });
    setOpen(true);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.description ?? "").toLowerCase().includes(q),
      )
    : items;

  const pg = usePagination(filtered);

  return (
    <AdminShell
      title="Номенклатуры"
      actions={
        <Button
          size="default"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          disabled={!studioId}
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить абонемент
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
                  placeholder="Поиск по названию или описанию"
                  className="h-8 pl-9"
                />
              </div>
            </div>

            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                  <TableHead className="w-[80px]">Обложка</TableHead>
                  <TableHead>Название</TableHead>
                    <TableHead>Описание</TableHead>
                    <TableHead>Преимущества</TableHead>
                    <TableHead>Посещения</TableHead>
                    <TableHead>Срок</TableHead>
                    <TableHead>Автопродление</TableHead>
                    <TableHead>Рассрочка</TableHead>
                    <TableHead>Цена</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="w-[140px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                        {items.length === 0
                          ? "Пока нет абонементов. Нажмите «Добавить абонемент»."
                          : "Ничего не найдено."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.paged.map((m) => (
                      <TableRow key={m.id} className={m.is_active ? "" : "opacity-60"}>
                        <TableCell><CoverThumb value={m.cover_url} alt={m.name} /></TableCell>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-muted-foreground">
                          {m.description ?? "—"}
                        </TableCell>
                        <TableCell>
                          {m.benefits?.length ? (
                            <ul className="list-disc space-y-0.5 pl-4 text-xs">
                              {m.benefits.map((b, i) => (
                                <li key={i}>{b}</li>
                              ))}
                            </ul>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{m.visits_count == null ? "Безлимит" : m.visits_count}</TableCell>
                        <TableCell>{formatDuration(m.duration_days)}</TableCell>
                        <TableCell>{m.auto_renew ? "Да" : "Нет"}</TableCell>
                        <TableCell>{m.installment_enabled ? "Да" : "Нет"}</TableCell>
                        <TableCell className="font-medium">{formatPrice(Number(m.price))}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={m.is_active}
                              onCheckedChange={(v) => handleToggleActive(m, v)}
                            />
                            {m.is_active ? (
                              <Badge variant="secondary">Активен</Badge>
                            ) : (
                              <Badge variant="outline">Скрыт</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Дублировать (создать обновлённую копию)"
                              onClick={() => handleClone(m)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Редактировать"
                              onClick={() => {
                                setEditing(m);
                                setOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Удалить" onClick={() => handleDelete(m)}>
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
          </>
        )}
      </div>

      <MembershipDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        membership={editing}
        onSaved={fetchItems}
      />
    </AdminShell>
  );
}

function MembershipDialog({
  open,
  onOpenChange,
  studioId,
  membership,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  membership: Membership | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [benefits, setBenefits] = useState<string[]>([]);
  const [benefitDraft, setBenefitDraft] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const [visitsCount, setVisitsCount] = useState<string>("");
  const [durationDays, setDurationDays] = useState<string>("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [installmentEnabled, setInstallmentEnabled] = useState(false);
  const [price, setPrice] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const isEditing = !!membership?.id;

  useEffect(() => {
    if (!open) return;
    setName(membership?.name ?? "");
    setDescription(membership?.description ?? "");
    setBenefits(membership?.benefits ?? []);
    setBenefitDraft("");
    setUnlimited(membership ? membership.visits_count == null : false);
    setVisitsCount(membership?.visits_count != null ? String(membership.visits_count) : "");
    setDurationDays(membership?.duration_days != null ? String(membership.duration_days) : "");
    setAutoRenew(membership?.auto_renew ?? false);
    setInstallmentEnabled(membership?.installment_enabled ?? false);
    setPrice(membership?.price != null ? String(membership.price) : "");
    setIsActive(membership?.is_active ?? true);
  }, [open, membership]);

  const addBenefit = () => {
    const v = benefitDraft.trim();
    if (!v) return;
    setBenefits([...benefits, v]);
    setBenefitDraft("");
  };

  const removeBenefit = (i: number) => {
    setBenefits(benefits.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    if (!studioId) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    setSaving(true);
    const payload = {
      studio_id: studioId,
      name: name.trim(),
      description: description.trim() || null,
      benefits,
      visits_count: unlimited ? null : visitsCount ? Number(visitsCount) : null,
      duration_days: durationDays ? Number(durationDays) : null,
      auto_renew: autoRenew,
      installment_enabled: installmentEnabled,
      price: price ? Number(price) : 0,
      is_active: isActive,
    };
    const { error } = isEditing
      ? await supabase.from("memberships").update(payload).eq("id", membership!.id)
      : await supabase.from("memberships").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success(isEditing ? "Абонемент обновлён" : "Абонемент добавлен");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Редактировать абонемент" : "Новый абонемент"}</DialogTitle>
          <DialogDescription>Заполните параметры номенклатуры.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="m-name">Название</Label>
            <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Безлимит на месяц" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-desc">Описание</Label>
            <Textarea id="m-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Преимущества</Label>
            <div className="flex gap-2">
              <Input
                value={benefitDraft}
                onChange={(e) => setBenefitDraft(e.target.value)}
                placeholder="Добавьте преимущество и нажмите +"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBenefit();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addBenefit}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {benefits.length > 0 && (
              <ul className="space-y-1 pt-1">
                {benefits.map((b, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm">
                    <span className="truncate">{b}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeBenefit(i)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Количество посещений</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                value={visitsCount}
                onChange={(e) => setVisitsCount(e.target.value)}
                disabled={unlimited}
                placeholder="Например, 8"
                className="flex-1"
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={unlimited} onCheckedChange={(v) => setUnlimited(!!v)} />
                Безлимит
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-dur">Срок действия (дней)</Label>
              <Input
                id="m-dur"
                type="number"
                min={0}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                placeholder="30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-price">Цена, ₾</Label>
              <Input
                id="m-price"
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={autoRenew} onCheckedChange={(v) => setAutoRenew(!!v)} />
            Автопродление
          </label>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={installmentEnabled} onCheckedChange={(v) => setInstallmentEnabled(!!v)} />
            Рассрочка доступна
          </label>

          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Показывать в мобильном приложении</div>
              <div className="text-xs text-muted-foreground">
                Выключите, чтобы новые клиенты не могли его купить. Уже купившие сохранят условия.
              </div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {isEditing && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              Изменения цены и условий применятся ко всем будущим продажам этого абонемента.
              Если у вас уже есть купившие, лучше нажмите «Дублировать» в списке, измените копию,
              а старую запись скройте переключателем выше.
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
