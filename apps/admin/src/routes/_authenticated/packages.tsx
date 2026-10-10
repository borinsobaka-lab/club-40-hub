import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, Copy, Tag } from "lucide-react";

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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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

/**
 * Номенклатура «Зала с пакетами тренировок» (STUDIO_FORMATS.md): пакеты —
 * строки той же таблицы memberships, что и подписки, но без автопродления,
 * рассрочки, заморозки и безлимита. Один пакет продаётся по двум ценам:
 * новым клиентам и постоянным (повторная покупка, дешевле) — это две строки
 * с одним названием, у второй for_regular_clients и описание для клиента.
 * Подписочная номенклатура — memberships.tsx.
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
  is_active: boolean;
  for_regular_clients: boolean;
};

/** Поля, которыми можно предзаполнить новый пакет (дублирование, цена для постоянных). */
type PackageDraft = Omit<Package, "id" | "studio_id">;

type Audience = "new" | "regular";
const AUDIENCE_ALL = "__all__";

const AUDIENCE_LABEL: Record<Audience, string> = {
  new: "Новым клиентам",
  regular: "Постоянным клиентам",
};

/** Описание по умолчанию у цены для постоянных — его видит клиент. */
const REGULAR_DESCRIPTION = "Для постоянных клиентов: повторная покупка пакета по сниженной цене.";

const COLUMNS =
  "id, studio_id, name, description, visits_count, duration_days, price, is_active, for_regular_clients";

const audienceOf = (p: Pick<Package, "for_regular_clients">): Audience =>
  p.for_regular_clients ? "regular" : "new";

/** Пакет «тот же», если совпадают название, тренировки и срок. */
const packageKey = (p: Pick<Package, "name" | "visits_count" | "duration_days">) =>
  `${p.name.trim().toLowerCase()}|${p.visits_count ?? ""}|${p.duration_days ?? ""}`;

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
  const [audience, setAudience] = useState<string>(AUDIENCE_ALL);
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
          // Цена для постоянных — сразу под ценой для новых того же пакета.
          .order("name")
          .order("visits_count")
          .order("for_regular_clients"),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить номенклатуры" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["memberships"] });

  // Полная цена пакета — подсказка у цены для постоянных (видно, какая скидка).
  const newClientPrice = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of items) if (!p.for_regular_clients) map.set(packageKey(p), Number(p.price));
    return map;
  }, [items]);

  const handleDelete = async (p: Package) => {
    if (
      !(await confirm({
        title: "Удалить пакет?",
        description: `«${p.name}» (${AUDIENCE_LABEL[audienceOf(p)].toLowerCase()}) пропадёт из каталога. Уже проданные пакеты клиентов останутся.`,
      }))
    )
      return;
    const { error } = await supabase.from("memberships").delete().eq("id", p.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Пакет удалён");
    reload();
  };

  const handleToggleActive = async (p: Package, next: boolean) => {
    const { error } = await supabase.from("memberships").update({ is_active: next }).eq("id", p.id);
    if (error) {
      toast.error("Не удалось изменить статус: " + error.message);
      return;
    }
    toast.success(next ? "Пакет активен" : "Пакет скрыт в приложении");
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
  // Тот же пакет для постоянных: название, тренировки и срок те же, цену
  // вводят заново, описание — заготовка, которую можно поправить.
  const openRegularPrice = (p: Package) =>
    openCreate({
      ...p,
      description: REGULAR_DESCRIPTION,
      price: Number.NaN,
      for_regular_clients: true,
      is_active: true,
    });

  const q = search.trim().toLowerCase();
  const filtered = items.filter(
    (p) =>
      (audience === AUDIENCE_ALL || audienceOf(p) === audience) &&
      (!q || p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q)),
  );

  const pg = usePagination(filtered);

  return (
    <AdminShell
      title="Номенклатуры"
      actions={
        <Button onClick={() => openCreate()} disabled={!studioId}>
          <Plus />
          Добавить пакет
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
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUDIENCE_ALL}>Все цены</SelectItem>
                <SelectItem value="new">{AUDIENCE_LABEL.new}</SelectItem>
                <SelectItem value="regular">{AUDIENCE_LABEL.regular}</SelectItem>
              </SelectContent>
            </Select>
          </TableToolbar>

          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Кому</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead>Тренировок</TableHead>
                  <TableHead>Срок действия</TableHead>
                  <TableHead>Стоимость</TableHead>
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
                        ? "Пока нет пакетов. Нажмите «Добавить пакет»."
                        : "Ничего не найдено."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((p) => {
                    const fullPrice = p.for_regular_clients
                      ? newClientPrice.get(packageKey(p))
                      : undefined;
                    return (
                      <RowContextMenu
                        key={p.id}
                        actions={[
                          ...(p.for_regular_clients
                            ? []
                            : [
                                {
                                  label: "Цена для постоянных",
                                  icon: Tag,
                                  onSelect: () => openRegularPrice(p),
                                },
                              ]),
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
                          <TableCell>
                            {p.for_regular_clients ? (
                              <Badge variant="secondary">Постоянным</Badge>
                            ) : (
                              <Badge variant="outline">Новым</Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[300px] truncate text-muted-foreground">
                            {p.description ?? "—"}
                          </TableCell>
                          <TableCell>{p.visits_count ?? "—"}</TableCell>
                          <TableCell>{formatDuration(p.duration_days)}</TableCell>
                          <TableCell>
                            <div className="font-medium">{formatMoney(Number(p.price))}</div>
                            {fullPrice != null && fullPrice !== Number(p.price) && (
                              <div className="text-xs text-muted-foreground">
                                новым — {formatMoney(fullPrice)}
                              </div>
                            )}
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
                    );
                  })
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
  /** Предзаполнение новой записи (дублирование, цена для постоянных). */
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
  const [audience, setAudience] = useState<Audience>(init ? audienceOf(init) : "new");
  const [name, setName] = useState(init?.name ?? "");
  const [description, setDescription] = useState(init?.description ?? "");
  const [visitsCount, setVisitsCount] = useState(
    init?.visits_count != null ? String(init.visits_count) : "",
  );
  const [durationDays, setDurationDays] = useState(
    init?.duration_days != null ? String(init.duration_days) : "",
  );
  const [price, setPrice] = useState(
    init?.price != null && Number.isFinite(init.price) ? String(init.price) : "",
  );
  const [isActive, setIsActive] = useState(init?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const pickAudience = (next: Audience) => {
    setAudience(next);
    // Цене для постоянных описание обязательно — подставляем заготовку.
    if (next === "regular" && !description.trim()) setDescription(REGULAR_DESCRIPTION);
  };

  const handleSave = async () => {
    if (!studioId) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    if (audience === "regular" && !description.trim()) {
      toast.error("Добавьте описание: клиент должен понимать, что это цена для постоянных");
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
        is_active: isActive,
        for_regular_clients: audience === "regular",
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
      toast.success(item ? "Пакет обновлён" : "Пакет добавлен");
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
            <FormField
              label="Кому продаётся"
              tip="Постоянным клиентам тот же пакет продаётся дешевле — это отдельная номенклатура с тем же названием."
              htmlFor={null}
            >
              <RadioGroup
                value={audience}
                onValueChange={(v) => pickAudience(v as Audience)}
                className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3"
              >
                {(["new", "regular"] as const).map((a) => (
                  <label key={a} className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem value={a} />
                    <span>{AUDIENCE_LABEL[a]}</span>
                  </label>
                ))}
              </RadioGroup>
            </FormField>

            <FormField
              label="Название"
              hint={
                audience === "regular" ? "Такое же, как у пакета для новых клиентов." : undefined
              }
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: 8 тренировок"
              />
            </FormField>

            <FormField
              label="Описание"
              tip="Видно клиентам в карточке пакета в приложении."
              optional={audience === "new"}
              hint={
                audience === "regular"
                  ? "Объясните клиенту, что это цена для повторной покупки."
                  : undefined
              }
            >
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Тренировок" tip="Сколько тренировок входит в пакет.">
                <Input
                  type="number"
                  min={1}
                  value={visitsCount}
                  onChange={(e) => setVisitsCount(e.target.value)}
                  placeholder="8"
                />
              </FormField>
              <FormField label="Срок, дней" tip="Считается от даты продажи.">
                <Input
                  type="number"
                  min={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  placeholder="30"
                />
              </FormField>
              <FormField
                label="Стоимость, ₾"
                tip="Подставляется в продажу, там её можно снизить для скидки. На уже проданные пакеты не влияет."
              >
                <Input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                />
              </FormField>
            </div>

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
