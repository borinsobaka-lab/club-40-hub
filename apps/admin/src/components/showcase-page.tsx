import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { ImageUploadField, StorageImage } from "@/components/image-upload-field";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
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
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

/** Подсказки «?»: один текст у поля формы и у колонки таблицы. */
const TIPS = {
  image: "В списке на главном экране приложения. Если нет баннера — и вверху открытой страницы.",
  banner: "Широкая картинка вверху открытой страницы. Не задан — там будет превью.",
};

/**
 * Раздел витрины мобильного приложения — карточки с картинкой, баннером,
 * текстом и кнопкой-ссылкой, в заданном порядке. «Новости» и «Услуги» —
 * одна и та же сущность в разных таблицах; страницы отличаются только
 * текстами (ShowcaseConfig), поэтому вся логика здесь, а news.tsx и
 * services.tsx лишь описывают свой раздел.
 */
export type ShowcaseConfig = {
  table: "news" | "services";
  bucket: "news" | "services";
  title: string;
  /** Тексты с названием карточки в нужном падеже. */
  texts: {
    loadError: string;
    deleteTitle: string;
    deleted: string;
    add: string;
    empty: string;
    added: string;
    updated: string;
    createTitle: string;
    editTitle: string;
    dialogDescription: string;
    fullTitlePlaceholder: string;
    fullTextPlaceholder: string;
    /** «…под новостью появится кнопка-ссылка» */
    buttonHint: string;
    buttonPlaceholder: string;
  };
  /** Ширина колонки «Описание» в таблице. */
  descriptionWidth: string;
  /** Требовать заполнить текст и ссылку кнопки вместе (или оставить оба пустыми). */
  requireButtonPair: boolean;
};

type ShowcaseItem = {
  id: string;
  /** Прежняя привязка к студии; приложение общее, поле не используется. */
  studio_id: string | null;
  position: number;
  image_url: string | null;
  banner_url: string | null;
  title: string;
  description: string | null;
  full_title: string | null;
  full_text: string | null;
  button_text: string | null;
  button_url: string | null;
  created_at: string;
};

export function ShowcasePage({ config }: { config: ShowcaseConfig }) {
  const { table, bucket, texts } = config;
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ShowcaseItem | null>(null);
  const [reordering, setReordering] = useState(false);

  // Мобильное приложение общее для всех студий — записи без фильтра по студии.
  const queryKey = [table, "all"];
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey,
    queryFn: () =>
      unwrap<ShowcaseItem[]>(
        supabase
          .from(table)
          .select("*")
          .order("position", { ascending: true })
          .order("created_at", { ascending: false }),
      ),
    meta: { errorMessage: texts.loadError },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: [table] });

  const handleDelete = async (n: ShowcaseItem) => {
    if (
      !(await confirm({
        title: texts.deleteTitle,
        description: `«${n.title}» пропадёт из приложения клиентов.`,
      }))
    )
      return;
    const { error } = await supabase.from(table).delete().eq("id", n.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success(texts.deleted);
    reload();
  };

  // Меняет местами позиции соседних строк. Через временную позицию — на случай
  // будущего уникального индекса по position.
  const swap = async (a: ShowcaseItem, b: ShowcaseItem) => {
    setReordering(true);
    try {
      const tmp = -1 - Math.floor(Math.random() * 1000);
      const r1 = await supabase.from(table).update({ position: tmp }).eq("id", a.id);
      if (r1.error) {
        toast.error("Ошибка: " + r1.error.message);
        return;
      }
      const r2 = await supabase.from(table).update({ position: a.position }).eq("id", b.id);
      const r3 = await supabase.from(table).update({ position: b.position }).eq("id", a.id);
      if (r2.error || r3.error) {
        toast.error("Ошибка изменения порядка");
        reload();
        return;
      }
      const swapped = new Map([
        [a.id, b.position],
        [b.id, a.position],
      ]);
      queryClient.setQueryData<ShowcaseItem[]>(queryKey, (prev) =>
        prev
          ?.map((x) => ({ ...x, position: swapped.get(x.id) ?? x.position }))
          .sort((x, y) => x.position - y.position),
      );
    } finally {
      setReordering(false);
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const other = items[idx + dir];
    if (other) swap(items[idx], other);
  };

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (n: ShowcaseItem) => {
    setEditing(n);
    setOpen(true);
  };

  const pg = usePagination(items);

  return (
    <AdminShell
      title={config.title}
      actions={
        <Button onClick={openCreate}>
          <Plus />
          {texts.add}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Порядок</TableHead>
                <TableHead className="w-[100px]" tip={TIPS.image}>
                  Картинка
                </TableHead>
                <TableHead className="w-[140px]" tip={TIPS.banner}>
                  Баннер
                </TableHead>
                <TableHead>Заголовок</TableHead>
                <TableHead>Описание</TableHead>
                <TableHead className="w-[140px]">Кнопка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeletonRows columns={6} />
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    {texts.empty}
                  </TableCell>
                </TableRow>
              ) : (
                pg.paged.map((n) => {
                  const idx = items.indexOf(n);
                  return (
                    <RowContextMenu
                      key={n.id}
                      actions={[
                        { label: "Редактировать", icon: Pencil, onSelect: () => openEdit(n) },
                        {
                          label: "Удалить",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => handleDelete(n),
                        },
                      ]}
                    >
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={idx === 0 || reordering}
                              onClick={() => move(idx, -1)}
                              aria-label="Выше"
                            >
                              <ArrowUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={idx === items.length - 1 || reordering}
                              onClick={() => move(idx, 1)}
                              aria-label="Ниже"
                            >
                              <ArrowDown />
                            </Button>
                            <span className="ml-1 w-5 text-xs text-muted-foreground">
                              {idx + 1}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StorageImage bucket={bucket} value={n.image_url} alt={n.title} />
                        </TableCell>
                        <TableCell>
                          <StorageImage
                            bucket={bucket}
                            value={n.banner_url}
                            alt={n.title}
                            className="h-10 w-28"
                          />
                        </TableCell>
                        <TableCell className="font-medium">{n.title}</TableCell>
                        <TableCell
                          className="truncate text-muted-foreground"
                          style={{ maxWidth: config.descriptionWidth }}
                        >
                          {n.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {n.button_text && n.button_url ? n.button_text : "—"}
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
      </div>

      <ShowcaseDialog
        config={config}
        open={open}
        onOpenChange={setOpen}
        item={editing}
        nextPosition={items.length > 0 ? Math.max(...items.map((i) => i.position)) + 1 : 0}
        onSaved={reload}
      />
      {confirmDialog}
    </AdminShell>
  );
}

type DialogProps = {
  config: ShowcaseConfig;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: ShowcaseItem | null;
  nextPosition: number;
  onSaved: () => void;
};

function ShowcaseDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <ShowcaseForm key={props.item?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ShowcaseForm({ config, onOpenChange, item, nextPosition, onSaved }: DialogProps) {
  const { table, bucket, texts } = config;
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [fullTitle, setFullTitle] = useState(item?.full_title ?? "");
  const [fullText, setFullText] = useState(item?.full_text ?? "");
  const [buttonText, setButtonText] = useState(item?.button_text ?? "");
  const [buttonUrl, setButtonUrl] = useState(item?.button_url ?? "");
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? null);
  const [bannerUrl, setBannerUrl] = useState(item?.banner_url ?? null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Укажите заголовок");
      return;
    }
    const bt = buttonText.trim();
    const bu = buttonUrl.trim();
    if (config.requireButtonPair && !bt !== !bu) {
      toast.error("Заполните оба поля кнопки или оставьте оба пустыми");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        full_title: fullTitle.trim() || null,
        full_text: fullText.trim() || null,
        button_text: bt || null,
        button_url: bu || null,
        image_url: imageUrl,
        banner_url: bannerUrl,
        updated_at: new Date().toISOString(),
      };
      const { error } = item
        ? await supabase.from(table).update(payload).eq("id", item.id)
        : await supabase.from(table).insert({ ...payload, position: nextPosition });
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(item ? texts.updated : texts.added);
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? texts.editTitle : texts.createTitle}</DialogTitle>
        <DialogDescription>{texts.dialogDescription}</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Картинка (превью)" tip={TIPS.image} htmlFor={null} optional>
                <ImageUploadField
                  bucket={bucket}
                  folder="app/image"
                  value={imageUrl}
                  onChange={setImageUrl}
                />
              </FormField>

              <FormField label="Баннер" tip={TIPS.banner} htmlFor={null} optional>
                <ImageUploadField
                  bucket={bucket}
                  folder="app/banner"
                  value={bannerUrl}
                  onChange={setBannerUrl}
                  preview={
                    <StorageImage
                      bucket={bucket}
                      value={bannerUrl}
                      alt="Баннер"
                      className="h-16 w-40"
                    />
                  }
                />
              </FormField>
            </div>

            <FormField label="Заголовок">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Краткий заголовок для списка"
              />
            </FormField>

            <FormField label="Описание" optional>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Короткое описание для превью"
              />
            </FormField>

            <FormField
              label="Полный заголовок"
              tip="Вверху открытой страницы. Пусто — возьмётся обычный заголовок."
              optional
            >
              <Input
                value={fullTitle}
                onChange={(e) => setFullTitle(e.target.value)}
                placeholder={texts.fullTitlePlaceholder}
              />
            </FormField>

            <FormField label="Полный текст" optional>
              <Textarea
                rows={8}
                value={fullText}
                onChange={(e) => setFullText(e.target.value)}
                placeholder={texts.fullTextPlaceholder}
              />
            </FormField>

            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Кнопка перехода
                </div>
                <p className="text-xs text-muted-foreground">
                  {texts.buttonHint} Если пусто — кнопки не будет.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Текст на кнопке">
                  <Input
                    value={buttonText}
                    onChange={(e) => setButtonText(e.target.value)}
                    placeholder={texts.buttonPlaceholder}
                  />
                </FormField>
                <FormField label="Ссылка">
                  <Input
                    value={buttonUrl}
                    onChange={(e) => setButtonUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </FormField>
              </div>
            </div>
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
