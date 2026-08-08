import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useEffect, useRef, useState } from "react";
import { Plus, Loader2, Pencil, Trash2, ImageIcon, ArrowUp, ArrowDown } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
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

const BUCKET = "services-media";

function isHttpUrl(v: string | null | undefined) {
  return !!v && /^https?:\/\//i.test(v);
}

async function resolveMediaSrc(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (isHttpUrl(value)) return value;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(value);
  return data?.publicUrl ?? null;
}

function MediaThumb({
  value,
  alt,
  aspect = "h-12 w-16",
}: {
  value: string | null;
  alt: string;
  aspect?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveMediaSrc(value).then((s) => {
      if (!cancelled) setSrc(s);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center rounded-md bg-muted text-muted-foreground ${aspect}`}
      >
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return <img src={src} alt={alt} className={`rounded-md object-cover ${aspect}`} />;
}

function ServicesPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAll = async () => {
    if (!studioId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("studio_id", studioId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить услуги: " + error.message);
      return;
    }
    setItems((data as ServiceItem[]) ?? []);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshSignal]);

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
    fetchAll();
  };

  const swap = async (a: ServiceItem, b: ServiceItem) => {
    setBusyId(a.id);
    const tmp = -1 - Math.floor(Math.random() * 1000);
    const r1 = await supabase.from("services").update({ position: tmp }).eq("id", a.id);
    if (r1.error) {
      setBusyId(null);
      toast.error("Ошибка: " + r1.error.message);
      return;
    }
    const r2 = await supabase.from("services").update({ position: a.position }).eq("id", b.id);
    const r3 = await supabase.from("services").update({ position: b.position }).eq("id", a.id);
    setBusyId(null);
    if (r2.error || r3.error) {
      toast.error("Ошибка изменения порядка");
      fetchAll();
      return;
    }
    setItems((prev) => {
      const next = [...prev];
      const ia = next.findIndex((x) => x.id === a.id);
      const ib = next.findIndex((x) => x.id === b.id);
      if (ia >= 0 && ib >= 0) {
        next[ia] = { ...a, position: b.position };
        next[ib] = { ...b, position: a.position };
        next.sort((x, y) => x.position - y.position);
      }
      return next;
    });
  };

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    swap(items[idx], items[idx - 1]);
  };
  const moveDown = (idx: number) => {
    if (idx >= items.length - 1) return;
    swap(items[idx], items[idx + 1]);
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
        <Button size="default" onClick={openCreate} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить услугу
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
                                disabled={idx === 0 || busyId !== null}
                                onClick={() => moveUp(idx)}
                                aria-label="Выше"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={idx === items.length - 1 || busyId !== null}
                                onClick={() => moveDown(idx)}
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
                            <MediaThumb value={n.image_url} alt={n.title} />
                          </TableCell>
                          <TableCell>
                            <MediaThumb value={n.banner_url} alt={n.title} aspect="h-10 w-28" />
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
        )}
      </div>

      <ServiceDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        item={editing}
        nextPosition={items.length > 0 ? Math.max(...items.map((i) => i.position)) + 1 : 0}
        onSaved={fetchAll}
      />
      {confirmDialog}
    </AdminShell>
  );
}

function ServiceDialog({
  open,
  onOpenChange,
  studioId,
  item,
  nextPosition,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  item: ServiceItem | null;
  nextPosition: number;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fullTitle, setFullTitle] = useState("");
  const [fullText, setFullText] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const imageRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(item?.title ?? "");
      setDescription(item?.description ?? "");
      setFullTitle(item?.full_title ?? "");
      setFullText(item?.full_text ?? "");
      setButtonText(item?.button_text ?? "");
      setButtonUrl(item?.button_url ?? "");
      setImageUrl(item?.image_url ?? null);
      setBannerUrl(item?.banner_url ?? null);
    }
  }, [open, item]);

  const upload = async (file: File, kind: "image" | "banner") => {
    if (!studioId) return;
    const setU = kind === "image" ? setUploadingImage : setUploadingBanner;
    setU(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${studioId}/${kind}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type });
    setU(false);
    if (error) {
      toast.error("Ошибка загрузки: " + error.message);
      return;
    }
    if (kind === "image") setImageUrl(path);
    else setBannerUrl(path);
  };

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
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success(item ? "Услуга обновлена" : "Услуга добавлена");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? "Редактировать услугу" : "Новая услуга"}</DialogTitle>
          <DialogDescription>Услуга отображается в мобильном приложении.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Картинка (превью)</Label>
                <div className="flex items-center gap-3">
                  <MediaThumb value={imageUrl} alt="image" />
                  <div className="flex flex-col gap-1">
                    <input
                      ref={imageRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload(f, "image");
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingImage}
                      onClick={() => imageRef.current?.click()}
                    >
                      {uploadingImage ? (
                        <>
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Загрузка…
                        </>
                      ) : imageUrl ? (
                        "Заменить"
                      ) : (
                        "Загрузить"
                      )}
                    </Button>
                    {imageUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setImageUrl(null)}
                      >
                        Удалить
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Баннер</Label>
                <div className="flex items-center gap-3">
                  <MediaThumb value={bannerUrl} alt="banner" aspect="h-10 w-28" />
                  <div className="flex flex-col gap-1">
                    <input
                      ref={bannerRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload(f, "banner");
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingBanner}
                      onClick={() => bannerRef.current?.click()}
                    >
                      {uploadingBanner ? (
                        <>
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Загрузка…
                        </>
                      ) : bannerUrl ? (
                        "Заменить"
                      ) : (
                        "Загрузить"
                      )}
                    </Button>
                    {bannerUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setBannerUrl(null)}
                      >
                        Удалить
                      </Button>
                    )}
                  </div>
                </div>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
