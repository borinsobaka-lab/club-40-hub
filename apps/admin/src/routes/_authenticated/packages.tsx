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
import { MEMBERSHIP_KIND_LABEL, MEMBERSHIP_KINDS, type MembershipKind } from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, InfoNote, SwitchRow } from "@/components/ui/form-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { TableSkeletonRows } from "@/components/skeletons";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";
import { PackagesPageSkeleton } from "@/components/page-skeletons";

/** Подсказки «?»: один текст у поля формы и у колонки таблицы. */
const TIPS = {
  kind: "Пакет тренировок расходуется на групповых занятиях, пакет персональных — на персональных с тренером. Пробное посещение продаётся типом «Пробное» в «Продажах».",
  visits:
    "Сколько тренировок входит в пакет. С баланса списывается одна, когда администратор отмечает посещение группового занятия.",
  trainings:
    "Групповых тренировок в номенклатуре и через «+» — персональных (у пакета тренировок — в подарок). «перс.» — персональные с тренером, у них отдельный баланс.",
  giftPersonal:
    "Сколько персональных тренировок входит в пакет в подарок. Это отдельный баланс: списывается, когда отмечено посещение персонального занятия. 0 — нет.",
  personal:
    "Сколько персональных тренировок в пакете. С баланса списывается одна, когда администратор отмечает посещение персонального занятия.",
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
  pendingComponent: PackagesPageSkeleton,
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
  /** Пакет тренировок, пакет персональных или пробное посещение. */
  kind: MembershipKind;
  /** Персональных: у пакета тренировок — подарочные, у пакета персональных — количество. */
  personal_count: number;
  is_active: boolean;
};

/** Поля, которыми можно предзаполнить новый пакет (дублирование). */
type PackageDraft = Omit<Package, "id" | "studio_id">;

const COLUMNS =
  "id, studio_id, name, description, visits_count, duration_days, price, max_payments, kind, personal_count, is_active";

/** «Тренировок» в таблице: обычные и персональные по типу номенклатуры. */
function trainingsLabel(p: Package) {
  if (p.kind === "personal") return `${p.personal_count} перс.`;
  const visits = p.visits_count ?? "—";
  return p.personal_count > 0 ? `${visits} + ${p.personal_count} перс.` : String(visits);
}

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
        description: `«${p.name}» пропадёт из каталога. Если её уже продавали, удалить не получится — тогда скройте её переключателем в колонке «Статус».`,
      }))
    )
      return;
    const { error } = await supabase.from("memberships").delete().eq("id", p.id);
    if (error) {
      // 23503 — на номенклатуру ссылаются продажи и абонементы клиентов
      // (внешний ключ on delete restrict): удалять проданное нельзя.
      toast.error(
        error.code === "23503"
          ? "Эту номенклатуру уже продавали — удалить нельзя, пропала бы история продаж. Скройте её переключателем в колонке «Статус»."
          : "Ошибка удаления: " + error.message,
      );
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
                  <TableHead tip={TIPS.kind}>Тип</TableHead>
                  <TableHead tip={TIPS.trainings}>Тренировок</TableHead>
                  <TableHead tip={TIPS.duration}>Срок действия</TableHead>
                  <TableHead tip={TIPS.price}>Стоимость</TableHead>
                  <TableHead tip={TIPS.payments}>Платежей</TableHead>
                  <TableHead tip={TIPS.description}>Описание</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={8} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
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
                        <TableCell>
                          {p.kind !== "package" ? (
                            <Badge variant="outline">{MEMBERSHIP_KIND_LABEL[p.kind]}</Badge>
                          ) : (
                            <span className="text-muted-foreground">
                              {MEMBERSHIP_KIND_LABEL.package}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {trainingsLabel(p)}
                        </TableCell>
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
            <DataPagination {...pg} loading={loading} />
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
    init?.visits_count != null && init.kind !== "personal" ? String(init.visits_count) : "",
  );
  // У пакета тренировок — подарочные персональные, у пакета персональных —
  // их количество (одно поле в БД: personal_count).
  const [giftPersonal, setGiftPersonal] = useState(
    init?.kind === "package" && init.personal_count ? String(init.personal_count) : "",
  );
  const [personalCount, setPersonalCount] = useState(
    init?.kind === "personal" ? String(init.personal_count) : "",
  );
  const [durationDays, setDurationDays] = useState(
    init?.duration_days != null ? String(init.duration_days) : "",
  );
  const [price, setPrice] = useState(init?.price != null ? String(init.price) : "");
  const [kind, setKind] = useState<MembershipKind>(init?.kind ?? "package");
  const [maxPayments, setMaxPayments] = useState(String(init?.max_payments ?? 1));
  const [isActive, setIsActive] = useState(init?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!studioId) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    const isPersonal = kind === "personal";
    // У пакета персональных обычных тренировок нет (0): по нему нельзя
    // записаться на групповое.
    const visits = isPersonal ? 0 : positiveInt(visitsCount);
    if (visits == null) {
      toast.error("Укажите количество тренировок (целое число больше 0)");
      return;
    }
    const personal = isPersonal
      ? positiveInt(personalCount)
      : kind === "package"
        ? giftPersonal.trim() === ""
          ? 0
          : positiveInt(giftPersonal)
        : 0;
    if (personal == null) {
      toast.error(
        isPersonal
          ? "Укажите количество персональных тренировок (целое число больше 0)"
          : "Персональных в подарок — целое число (0 — нет)",
      );
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
    // У пробного посещения рассрочки нет — всегда один платёж.
    const payments = kind === "trial" ? 1 : positiveInt(maxPayments);
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
        personal_count: personal,
        duration_days: days,
        price: priceNum,
        max_payments: payments,
        kind,
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
        <DialogTitle>{item ? "Редактировать номенклатуру" : "Новая номенклатура"}</DialogTitle>
        <DialogDescription>
          Пакет — несколько тренировок за фиксированную цену на ограниченный срок: групповых (пакет
          тренировок) или персональных с тренером (пакет персональных). Пробное посещение продаётся
          типом «Пробное» в «Продажах».
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Тип" tip={TIPS.kind} htmlFor={null} required>
              <RadioGroup
                value={kind}
                onValueChange={(v) => setKind(v as MembershipKind)}
                className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3"
              >
                {MEMBERSHIP_KINDS.map((k) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem value={k} />
                    <span>{MEMBERSHIP_KIND_LABEL[k]}</span>
                  </label>
                ))}
              </RadioGroup>
            </FormField>

            <FormField label="Название" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  kind === "trial"
                    ? "Например: Пробное занятие"
                    : kind === "personal"
                      ? "Например: 5 персональных"
                      : "Например: 8 тренировок"
                }
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {kind === "personal" ? (
                <FormField label="Персональных" tip={TIPS.personal} required>
                  <Input
                    type="number"
                    min={1}
                    value={personalCount}
                    onChange={(e) => setPersonalCount(e.target.value)}
                    placeholder="5"
                  />
                </FormField>
              ) : (
                <FormField label="Тренировок" tip={TIPS.visits} required>
                  <Input
                    type="number"
                    min={1}
                    value={visitsCount}
                    onChange={(e) => setVisitsCount(e.target.value)}
                    placeholder="8"
                  />
                </FormField>
              )}
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

            {kind === "package" && (
              <FormField label="Персональных в подарок" tip={TIPS.giftPersonal} optional>
                <Input
                  type="number"
                  min={0}
                  value={giftPersonal}
                  onChange={(e) => setGiftPersonal(e.target.value)}
                  placeholder="0"
                  className="sm:w-32"
                />
              </FormField>
            )}

            {kind !== "trial" && (
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
            )}

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
