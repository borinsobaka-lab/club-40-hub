import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, X, Copy } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { ImageUploadField, StorageImage } from "@/components/image-upload-field";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxOption, FormField, InfoNote, SwitchRow } from "@/components/ui/form-field";
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

export const Route = createFileRoute("/_authenticated/memberships")({
  head: () => ({ meta: [{ title: "Номенклатуры — Base40 Admin" }] }),
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
  for_couple: boolean;
  freeze_days_allowed: number;
};

/** Поля, которыми можно предзаполнить новый абонемент (дублирование). */
type MembershipDraft = Omit<Membership, "id" | "studio_id">;

function formatDuration(days: number | null) {
  if (!days) return "—";
  if (days % 365 === 0) return `${days / 365} г.`;
  if (days % 30 === 0) return `${days / 30} мес.`;
  return `${days} дн.`;
}

function MembershipsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);
  const [draft, setDraft] = useState<MembershipDraft | null>(null);

  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: ["memberships", studioId],
    queryFn: () =>
      unwrap<Membership[]>(
        supabase
          .from("memberships")
          .select("*")
          .eq("studio_id", studioId!)
          .order("created_at", { ascending: false }),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить номенклатуры" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["memberships"] });

  const handleDelete = async (m: Membership) => {
    if (
      !(await confirm({
        title: "Удалить абонемент?",
        description: `«${m.name}» пропадёт из каталога. Уже проданные абонементы клиентов останутся.`,
      }))
    )
      return;
    const { error } = await supabase.from("memberships").delete().eq("id", m.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Номенклатура удалена");
    reload();
  };

  const handleToggleActive = async (m: Membership, next: boolean) => {
    const { error } = await supabase.from("memberships").update({ is_active: next }).eq("id", m.id);
    if (error) {
      toast.error("Не удалось изменить статус: " + error.message);
      return;
    }
    toast.success(next ? "Абонемент активен" : "Абонемент скрыт в приложении");
    reload();
  };

  const openCreate = (initial: MembershipDraft | null = null) => {
    setEditing(null);
    setDraft(initial);
    setOpen(true);
  };
  const openEdit = (m: Membership) => {
    setEditing(m);
    setDraft(null);
    setOpen(true);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (m) => m.name.toLowerCase().includes(q) || (m.description ?? "").toLowerCase().includes(q),
      )
    : items;

  const pg = usePagination(filtered);

  return (
    <AdminShell
      title="Номенклатуры"
      actions={
        <Button onClick={() => openCreate()} disabled={!studioId}>
          <Plus />
          Добавить абонемент
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={10} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {items.length === 0
                        ? "Пока нет абонементов. Нажмите «Добавить абонемент»."
                        : "Ничего не найдено."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((m) => (
                    <RowContextMenu
                      key={m.id}
                      actions={[
                        {
                          label: "Дублировать",
                          icon: Copy,
                          onSelect: () =>
                            openCreate({ ...m, name: `${m.name} (копия)`, is_active: true }),
                        },
                        { label: "Редактировать", icon: Pencil, onSelect: () => openEdit(m) },
                        {
                          label: "Удалить",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => handleDelete(m),
                        },
                      ]}
                    >
                      <TableRow className={m.is_active ? "" : "opacity-60"}>
                        <TableCell>
                          <CoverImage value={m.cover_url} alt={m.name} />
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{m.name}</span>
                            {m.for_couple && <Badge variant="outline">Для двоих</Badge>}
                          </div>
                        </TableCell>
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
                        <TableCell>
                          {m.visits_count == null ? "Безлимит" : m.visits_count}
                        </TableCell>
                        <TableCell>{formatDuration(m.duration_days)}</TableCell>
                        <TableCell>{m.auto_renew ? "Да" : "Нет"}</TableCell>
                        <TableCell>{m.installment_enabled ? "Да" : "Нет"}</TableCell>
                        <TableCell className="font-medium">
                          {formatMoney(Number(m.price))}
                        </TableCell>
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

      <MembershipDialog
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

/** Обложка целиком (часто это SVG-логотип), поэтому contain и рамка, а не cover. */
function CoverImage({
  value,
  alt,
  className,
}: {
  value: string | null;
  alt: string;
  className?: string;
}) {
  return (
    <StorageImage
      bucket="memberships"
      value={value}
      alt={alt}
      className={className}
      imgClassName="border bg-background object-contain"
    />
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  /** Редактируемая запись; null — создание новой. */
  item: Membership | null;
  /** Предзаполнение новой записи (дублирование). */
  draft: MembershipDraft | null;
  onSaved: () => void;
};

function MembershipDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <MembershipForm key={props.item?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function MembershipForm({ onOpenChange, studioId, item, draft, onSaved }: DialogProps) {
  const init = item ?? draft;
  const [name, setName] = useState(init?.name ?? "");
  const [description, setDescription] = useState(init?.description ?? "");
  const [benefits, setBenefits] = useState<string[]>(init?.benefits ?? []);
  const [unlimited, setUnlimited] = useState(init ? init.visits_count == null : false);
  const [visitsCount, setVisitsCount] = useState(
    init?.visits_count != null ? String(init.visits_count) : "",
  );
  const [durationDays, setDurationDays] = useState(
    init?.duration_days != null ? String(init.duration_days) : "",
  );
  const [autoRenew, setAutoRenew] = useState(init?.auto_renew ?? false);
  const [installmentEnabled, setInstallmentEnabled] = useState(init?.installment_enabled ?? false);
  const [price, setPrice] = useState(init?.price != null ? String(init.price) : "");
  const [freezeDays, setFreezeDays] = useState(
    init?.freeze_days_allowed ? String(init.freeze_days_allowed) : "",
  );
  const [isActive, setIsActive] = useState(init?.is_active ?? true);
  const [coverUrl, setCoverUrl] = useState(init?.cover_url ?? null);
  const [forCouple, setForCouple] = useState(init?.for_couple ?? false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!studioId) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    // null в visits_count — это безлимит. Пустое поле при снятой галочке
    // раньше молча превращало абонемент в безлимитный.
    let visits: number | null = null;
    if (!unlimited) {
      const n = Number(visitsCount.trim());
      if (visitsCount.trim() === "" || !Number.isInteger(n) || n <= 0) {
        toast.error("Укажите количество посещений (целое число больше 0) или отметьте «Безлимит»");
        return;
      }
      visits = n;
    }
    // Пустая цена раньше сохранялась как 0 — бесплатный абонемент по ошибке.
    const priceNum = Number(price.trim());
    if (price.trim() === "" || !Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Укажите цену");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        studio_id: studioId,
        name: name.trim(),
        description: description.trim() || null,
        benefits,
        visits_count: visits,
        duration_days: durationDays ? Number(durationDays) : null,
        auto_renew: autoRenew,
        installment_enabled: installmentEnabled,
        price: priceNum,
        freeze_days_allowed: freezeDays ? Number(freezeDays) : 0,
        is_active: isActive,
        cover_url: coverUrl,
        for_couple: forCouple,
      };
      const { error } = item
        ? await supabase.from("memberships").update(payload).eq("id", item.id)
        : await supabase.from("memberships").insert(payload);
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(item ? "Абонемент обновлён" : "Абонемент добавлен");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Редактировать абонемент" : "Новый абонемент"}</DialogTitle>
        <DialogDescription>Заполните параметры номенклатуры.</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Безлимит на месяц"
              />
            </FormField>

            <FormField
              label="Обложка"
              htmlFor={null}
              optional
              hint="Для мобильного приложения. Соотношение 3:2 (горизонтальное), оптимально 1200 × 800 px."
            >
              <ImageUploadField
                bucket="memberships"
                folder={`${studioId}/cover`}
                value={coverUrl}
                onChange={setCoverUrl}
                preview={<CoverImage value={coverUrl} alt="Обложка" className="h-16 w-24" />}
                accept="image/svg+xml,image/png,image/jpeg,image/webp"
                disabled={!studioId}
              />
            </FormField>

            <FormField
              label="Описание"
              tip="Видно клиентам в карточке абонемента в приложении."
              optional
            >
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>

            <FormField
              label="Преимущества"
              tip="Пункты списка в карточке в приложении. Заморозку не добавляйте — строка «Заморозка до N дней» появится сама."
              optional
            >
              <BenefitsEditor value={benefits} onChange={setBenefits} />
            </FormField>

            <FormField
              label="Количество посещений"
              tip="Сколько занятий в пакете. В приложении безлимиты и пакеты — на разных вкладках."
            >
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  min={0}
                  value={visitsCount}
                  onChange={(e) => setVisitsCount(e.target.value)}
                  disabled={unlimited}
                  placeholder="Например, 8"
                  className="flex-1"
                />
                <CheckboxOption checked={unlimited} onCheckedChange={setUnlimited}>
                  Безлимит
                </CheckboxOption>
              </div>
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Срок действия, дней"
                tip="Считается от даты продажи. Пусто — абонемент бессрочный."
                optional
              >
                <Input
                  type="number"
                  min={0}
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  placeholder="30"
                />
              </FormField>
              <FormField
                label="Цена, ₾"
                tip="Подставляется в продажу, там её можно снизить для скидки. На уже проданные абонементы не влияет."
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                />
              </FormField>
            </div>

            <FormField
              label="Дней заморозки"
              tip="Замораживает сотрудник — в карточке клиента. Срок действия продлевается на дни заморозки."
              optional
              hint="Сколько дней клиент может заморозить этот абонемент суммарно. 0 — заморозка недоступна."
            >
              <Input
                type="number"
                min={0}
                value={freezeDays}
                onChange={(e) => setFreezeDays(e.target.value)}
                placeholder="0"
              />
            </FormField>

            <SwitchRow
              title="Автопродление"
              tip="Клиент может отключить продление в приложении — отказы видны в «Отменах автопродления»."
              checked={autoRenew}
              onCheckedChange={setAutoRenew}
            />

            <SwitchRow
              title="Рассрочка доступна"
              tip="При продаже оплату можно разбить: первый взнос + 2–3 платежа раз в месяц."
              checked={installmentEnabled}
              onCheckedChange={setInstallmentEnabled}
            />

            <SwitchRow
              title="Абонемент для двоих"
              hint="Такие абонементы попадут в отдельную вкладку «Для двоих» в мобильном приложении."
              checked={forCouple}
              onCheckedChange={setForCouple}
            />

            <SwitchRow
              title="Показывать в мобильном приложении"
              hint="Выключите, чтобы новые клиенты не могли его купить. Уже купившие сохранят условия."
              checked={isActive}
              onCheckedChange={setIsActive}
            />

            {item && (
              <InfoNote variant="warning">
                Изменения цены и условий применятся ко всем будущим продажам этого абонемента. Если
                у вас уже есть купившие, лучше нажмите «Дублировать» в списке, измените копию, а
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

/** Список «преимуществ»: поле ввода + «+» (или Enter), у каждого пункта — удаление. */
function BenefitsEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...value, v]);
    setDraft("");
  };

  return (
    <>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Добавьте преимущество и нажмите +"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outline" size="icon" onClick={add} aria-label="Добавить преимущество">
          <Plus />
        </Button>
      </div>
      {value.length > 0 && (
        <ul className="space-y-1 pt-1">
          {value.map((b, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm"
            >
              <span className="truncate">{b}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
