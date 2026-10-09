import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { ImageUploadField, StorageImage } from "@/components/image-upload-field";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/services")({
  head: () => ({ meta: [{ title: "Услуги — Base40 Admin" }] }),
  component: ServicesPage,
});

type ServiceItem = {
  id: string;
  studio_id: string;
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

function ServicesPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [reordering, setReordering] = useState(false);

  const queryKey = ["services", studioId];
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey,
    queryFn: () =>
      unwrap<ServiceItem[]>(
        supabase
          .from("services")
          .select("*")
          .eq("studio_id", studioId!)
          .order("position", { ascending: true })
          .order("created_at", { ascending: false }),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить услуги" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["services"] });

  const handleDelete = async (n: ServiceItem) => {
    if (
      !(await confirm({
        title: "Удалить услугу?",
        description: `«${n.title}» пропадёт из приложения клиентов.`,
      }))
    )
      return;
    const { error } = await supabase.from("services").delete().eq("id", n.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Услуга удалена");
    reload();
  };

  // Меняет местами позиции соседних строк. Через временную позицию — на случай
  // будущего уникального индекса по position.
  const swap = async (a: ServiceItem, b: ServiceItem) => {
    setReordering(true);
    try {
      const tmp = -1 - Math.floor(Math.random() * 1000);
      const r1 = await supabase.from("services").update({ position: tmp }).eq("id", a.id);
      if (r1.error) {
        toast.error("Ошибка: " + r1.error.message);
        return;
      }
      const r2 = await supabase.from("services").update({ position: a.position }).eq("id", b.id);
      const r3 = await supabase.from("services").update({ position: b.position }).eq("id", a.id);
      if (r2.error || r3.error) {
        toast.error("Ошибка изменения порядка");
        reload();
        return;
      }
      const swapped = new Map([
        [a.id, b.position],
        [b.id, a.position],
      ]);
      queryClient.setQueryData<ServiceItem[]>(queryKey, (prev) =>
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
  const openEdit = (n: ServiceItem) => {
    setEditing(n);
    setOpen(true);
  };

  const pg = usePagination(items);

  return (
    <AdminShell
      title="Услуги"
      actions={
        <Button onClick={openCreate} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить услугу
        </Button>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Порядок</TableHead>
                  <TableHead className="w-[100px]">Картинка</TableHead>
                  <TableHead className="w-[140px]">Баннер</TableHead>
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
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Пока нет услуг. Нажмите «Добавить услугу».
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
                                size="icon"
                                className="h-7 w-7"
                                disabled={idx === 0 || reordering}
                                onClick={() => move(idx, -1)}
                                aria-label="Выше"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={idx === items.length - 1 || reordering}
                                onClick={() => move(idx, 1)}
                                aria-label="Ниже"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <span className="ml-1 w-5 text-xs text-muted-foreground">
                                {idx + 1}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <StorageImage bucket="services" value={n.image_url} alt={n.title} />
                          </TableCell>
                          <TableCell>
                            <StorageImage
                              bucket="services"
                              value={n.banner_url}
                              alt={n.title}
                              className="h-10 w-28"
                            />
                          </TableCell>
                          <TableCell className="font-medium">{n.title}</TableCell>
                          <TableCell className="max-w-[320px] truncate text-muted-foreground">
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
        </RequireStudio>
      </div>

      <ServiceDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        item={editing}
        nextPosition={items.length > 0 ? Math.max(...items.map((i) => i.position)) + 1 : 0}
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
  item: ServiceItem | null;
  nextPosition: number;
  onSaved: () => void;
};

function ServiceDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <ServiceForm key={props.item?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ServiceForm({ onOpenChange, studioId, item, nextPosition, onSaved }: DialogProps) {
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
    if (!studioId) return;
    if (!title.trim()) {
      toast.error("Укажите заголовок");
      return;
    }
    const bt = buttonText.trim();
    const bu = buttonUrl.trim();
    if ((bt && !bu) || (!bt && bu)) {
      toast.error("Заполните оба поля кнопки или оставьте оба пустыми");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        studio_id: studioId,
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
        ? await supabase.from("services").update(payload).eq("id", item.id)
        : await supabase.from("services").insert({ ...payload, position: nextPosition });
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(item ? "Услуга обновлена" : "Услуга добавлена");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Редактировать услугу" : "Новая услуга"}</DialogTitle>
        <DialogDescription>Услуга отображается в мобильном приложении.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Картинка (превью)</Label>
              <ImageUploadField
                bucket="services"
                folder={`${studioId}/image`}
                value={imageUrl}
                onChange={setImageUrl}
                disabled={!studioId}
              />
            </div>

            <div className="space-y-2">
              <Label>Баннер</Label>
              <ImageUploadField
                bucket="services"
                folder={`${studioId}/banner`}
                value={bannerUrl}
                onChange={setBannerUrl}
                preview={
                  <StorageImage
                    bucket="services"
                    value={bannerUrl}
                    alt="Баннер"
                    className="h-10 w-28"
                  />
                }
                disabled={!studioId}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Заголовок</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Краткий заголовок для списка"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Описание</Label>
            <Textarea
              id="description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Короткое описание для превью"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="full_title">Полный заголовок</Label>
            <Input
              id="full_title"
              value={fullTitle}
              onChange={(e) => setFullTitle(e.target.value)}
              placeholder="Заголовок на странице услуги"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="full_text">Полный текст</Label>
            <Textarea
              id="full_text"
              rows={8}
              value={fullText}
              onChange={(e) => setFullText(e.target.value)}
              placeholder="Текст услуги"
            />
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <div className="text-sm font-medium">Кнопка перехода (необязательно)</div>
            <div className="text-xs text-muted-foreground">
              Если оба поля заполнены — в мобильном приложении под услугой появится кнопка-ссылка.
              Если пусто — кнопки не будет.
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="button_text">Текст на кнопке</Label>
                <Input
                  id="button_text"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                  placeholder="Например: Записаться"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="button_url">Ссылка</Label>
                <Input
                  id="button_url"
                  value={buttonUrl}
                  onChange={(e) => setButtonUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
      </DialogFooter>
    </>
  );
}
