import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, Copy } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { RequireFormat } from "@/components/require-format";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, InfoNote, SwitchRow } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  DialogForm,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarSearch } from "@/components/table-toolbar";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

/** Подсказки «?»: один текст у поля формы и у колонки таблицы. */
const TIPS = {
  visits: "Сколько тренировок входит в пакет.",
  duration: "Считается от даты продажи.",
  price:
    "Полная цена. Подставляется в продажу, скидку (например, постоянному клиенту) дают там, снижая стоимость. На уже проданные пакеты не влияет.",
  description: "Видно клиентам в карточке пакета в приложении.",
  payments:
    "Сколькими ежемесячными платежами можно оплатить пакет (внутренняя рассрочка). 1 — только сразу. При продаже можно выбрать меньше.",
};

/** Предел платежей — как ограничение memberships.max_payments в БД. */
const MAX_PAYMENTS_LIMIT = 12;

/**
 * Номенклатура «Зала с пакетами тренировок» (STUDIO_FORMATS.md): пакеты —
 * строки той же таблицы memberships, что и подписки, но без автопродления,
 * заморозки и безлимита. Рассрочка своя — «сколькими платежами можно
 * оплатить» (max_payments), подписочная installment_enabled не используется. В номенклатуре — только полная цена:
 * скидку (например, постоянному клиенту) дают при продаже, снижая стоимость
 * (решение владельца 2026-10-11). Подписочная номенклатура — memberships.tsx.
 */
export const Route = createFileRoute("/_authenticated/packages")({
  head: () => ({ meta: [{ title: "Номенклатуры — Base40 Admin" }] }),
  component: PackagesRoute,
});

type Package = {
  id: string;
  studio_id: string;
  name: string;
  description: string | null;
  visits_count: number | null;
  duration_days: number | null;
  price: number;
  /** Сколькими платежами можно оплатить (1 — только сразу). */
  max_payments: number;
  is_active: boolean;
};

/** Поля, которыми можно предзаполнить новый пакет (дублирование). */
type PackageDraft = Omit<Package, "id" | "studio_id">;

const COLUMNS =
  "id, studio_id, name, description, visits_count, duration_days, price, max_payments, is_active";

function formatDuration(days: number | null) {
  if (!days) return "—";
  if (days % 365 === 0) return `${days / 365} г.`;
  if (days % 30 === 0) return `${days / 30} мес.`;
  return `${days} дн.`;
}

function PackagesRoute() {
  return (
    <RequireFormat format="packages" title="Номенклатуры" other={{ subscription: "/memberships" }}>
      <PackagesPage />
    </RequireFormat>
  );
}

function PackagesPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Package | null>(null);
  const [draft, setDraft] = useState<PackageDraft | null>(null);

  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: ["memberships", studioId, "packages"],
    queryFn: () =>
      unwrap<Package[]>(
        supabase
          .from("memberships")
          .select(COLUMNS)
          .eq("studio_id", studioId!)
          .order("name")
          .order("visits_count"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить номенклатуры" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["memberships"] });

  const handleDelete = async (p: Package) => {
    if (
      !(await confirm({
        title: "Удалить номенклатуру?",
        description: `«${p.name}» пропадёт из каталога. Уже проданные пакеты клиентов останутся.`,
      }))
    )
      return;
    const { error } = await supabase.from("memberships").delete().eq("id", p.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Номенклатура удалена");
    reload();
  };

  const handleToggleActive = async (p: Package, next: boolean) => {
    const { error } = await supabase.from("memberships").update({ is_active: next }).eq("id", p.id);
    if (error) {
      toast.error("Не удалось изменить статус: " + error.message);
      return;
    }
    toast.success(next ? "Показывается в приложении" : "Скрыто в приложении");
    reload();
  };

  const openCreate = (initial: PackageDraft | null = null) => {
    setEditing(null);
    setDraft(initial);
    setOpen(true);
  };
  const openEdit = (p: Package) => {
    setEditing(p);
    setDraft(null);
    setOpen(true);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q),
      )
    : items;

  const pg = usePagination(filtered);

  return (
    <AdminShell
      title="Номенклатуры"
      actions={
        <Button onClick={() => openCreate()} disabled={!studioId}>
          <Plus />
          Добавить
        </Button>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Поиск по названию или описанию"
            />
          </TableToolbar>

          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead tip={TIPS.visits}>Тренировок</TableHead>
                  <TableHead tip={TIPS.duration}>Срок действия</TableHead>
                  <TableHead tip={TIPS.price}>Стоимость</TableHead>
                  <TableHead tip={TIPS.payments}>Платежей</TableHead>
                  <TableHead tip={TIPS.description}>Описание</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={7} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {items.length === 0
                        ? "Пока нет номенклатур. Нажмите «Добавить»."
                        : "Ничего не найдено."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((p) => (
                    <RowContextMenu
                      key={p.id}
                      actions={[
                        {
                          label: "Дублировать",
                          icon: Copy,
                          onSelect: () =>
                            openCreate({ ...p, name: `${p.name} (копия)`, is_active: true }),
                        },
                        { label: "Редактировать", icon: Pencil, onSelect: () => openEdit(p) },
                        {
                          label: "Удалить",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => handleDelete(p),
                        },
                      ]}
                    >
                      <TableRow className={p.is_active ? "" : "opacity-60"}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.visits_count ?? "—"}</TableCell>
                        <TableCell>{formatDuration(p.duration_days)}</TableCell>
                        <TableCell className="font-medium">
                          {formatMoney(Number(p.price))}
                        </TableCell>
                        <TableCell>{p.max_payments > 1 ? `до ${p.max_payments}` : "1"}</TableCell>
                        <TableCell className="max-w-[300px] truncate text-muted-foreground">
                          {p.description ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={p.is_active}
                              onCheckedChange={(v) => handleToggleActive(p, v)}
                            />
                            {p.is_active ? (
                              <Badge variant="secondary">Активен</Badge>
                            ) : (
                              <Badge variant="outline">Скрыт</Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    </RowContextMenu>
                  ))
                )}
              </TableBody>
            </Table>
            <DataPagination {...pg} />
          </div>
        </RequireStudio>
      </div>

      <PackageDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        item={editing}
        draft={draft}
        onSaved={reload}
      />
      {confirmDialog}
    </AdminShell>
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  /** Редактируемая запись; null — создание новой. */
  item: Package | null;
  /** Предзаполнение новой записи (дублирование). */
  draft: PackageDraft | null;
  onSaved: () => void;
};

function PackageDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <PackageForm key={props.item?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** Целое число больше 0 из поля ввода; иначе null. */
function positiveInt(v: string): number | null {
  const n = Number(v.trim());
  return v.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

function PackageForm({ onOpenChange, studioId, item, draft, onSaved }: DialogProps) {
  const init = item ?? draft;
  const [name, setName] = useState(init?.name ?? "");
  const [description, setDescription] = useState(init?.description ?? "");
  const [visitsCount, setVisitsCount] = useState(
    init?.visits_count != null ? String(init.visits_count) : "",
  );
  const [durationDays, setDurationDays] = useState(
    init?.duration_days != null ? String(init.duration_days) : "",
  );
  const [price, setPrice] = useState(init?.price != null ? String(init.price) : "");
  const [maxPayments, setMaxPayments] = useState(String(init?.max_payments ?? 1));
  const [isActive, setIsActive] = useState(init?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!studioId) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    const visits = positiveInt(visitsCount);
    if (visits == null) {
      toast.error("Укажите количество тренировок (целое число больше 0)");
      return;
    }
    const days = positiveInt(durationDays);
    if (days == null) {
      toast.error("Укажите срок действия в днях (целое число больше 0)");
      return;
    }
    const priceNum = Number(price.trim().replace(",", "."));
    if (price.trim() === "" || !Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Укажите стоимость");
      return;
    }
    const payments = positiveInt(maxPayments);
    if (payments == null || payments > MAX_PAYMENTS_LIMIT) {
      toast.error(`Укажите число платежей — целое от 1 до ${MAX_PAYMENTS_LIMIT}`);
      return;
    }

    setSaving(true);
    try {
      // Всё, чего у пакетов нет, — явно выключено: строка в общей таблице
      // memberships не должна унаследовать подписочные условия (автопродление
      // в пакетной студии выключает ещё и триггер в БД).
      const payload = {
        studio_id: studioId,
        name: name.trim(),
        description: description.trim() || null,
        visits_count: visits,
        duration_days: days,
        price: priceNum,
        max_payments: payments,
        is_active: isActive,
        auto_renew: false,
        installment_enabled: false,
        for_couple: false,
        freeze_days_allowed: 0,
        benefits: [],
      };
      const { error } = item
        ? await supabase.from("memberships").update(payload).eq("id", item.id)
        : await supabase.from("memberships").insert(payload);
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(item ? "Номенклатура обновлена" : "Номенклатура добавлена");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Редактировать пакет" : "Новый пакет тренировок"}</DialogTitle>
        <DialogDescription>
          Пакет — несколько тренировок за фиксированную цену на ограниченный срок.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: 8 тренировок"
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Тренировок" tip={TIPS.visits} required>
                <Input
                  type="number"
                  min={1}
                  value={visitsCount}
                  onChange={(e) => setVisitsCount(e.target.value)}
                  placeholder="8"
                />
              </FormField>
              <FormField label="Срок, дней" tip={TIPS.duration} required>
                <Input
                  type="number"
                  min={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  placeholder="30"
                />
              </FormField>
              <FormField label="Стоимость, ₾" tip={TIPS.price} required>
                <Input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                />
              </FormField>
            </div>

            <FormField
              label="Сколькими платежами можно оплатить"
              tip={TIPS.payments}
              hint="Платежи ежемесячные: первый — в день продажи, остаток делится на следующие."
              required
            >
              <Input
                type="number"
                min={1}
                max={MAX_PAYMENTS_LIMIT}
                value={maxPayments}
                onChange={(e) => setMaxPayments(e.target.value)}
                className="sm:w-32"
              />
            </FormField>

            <FormField label="Описание" tip={TIPS.description} optional>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>

            <SwitchRow
              title="Показывать в мобильном приложении"
              hint="Выключите, чтобы пакет нельзя было купить. Уже купившие сохранят условия."
              checked={isActive}
              onCheckedChange={setIsActive}
            />

            {item && (
              <InfoNote variant="warning">
                Изменения цены и условий применятся ко всем будущим продажам этого пакета. Если у
                вас уже есть купившие, лучше нажмите «Дублировать» в списке, измените копию, а
                старую запись скройте переключателем выше.
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
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
