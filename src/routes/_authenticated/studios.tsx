import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, LogIn, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { ImageUploadField } from "@/components/image-upload-field";
import { RowContextMenu } from "@/components/row-context-menu";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { setActiveStudioId, useActiveStudioId } from "@/hooks/use-active-studio";
import { useStudios, type Studio } from "@/hooks/use-studios";
import { supabase } from "@/integrations/supabase/client";
import { useStorageUrl } from "@/lib/storage";
import {
  DEFAULT_BRAND_COLOR,
  STUDIO_FORMATS,
  STUDIO_FORMAT_APP_URL,
  STUDIO_FORMAT_LABEL,
  isBrandColor,
  type StudioFormat,
} from "@/lib/studio-formats";

export const Route = createFileRoute("/_authenticated/studios")({
  head: () => ({ meta: [{ title: "Студии — Base40 Admin" }] }),
  component: StudiosPage,
});

/**
 * Студии сети. Каждая студия — в переключателе в шапке; у студии формат
 * (STUDIO_FORMATS.md), логотип в меню и основной цвет админки.
 * Создаёт студию владелец любой студии (RPC create_studio — он же становится
 * владельцем новой), правит — владелец этой студии.
 */
function StudiosPage() {
  const { data: studios = [], isLoading } = useStudios();
  const activeId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Studio | null>(null);

  const isOwnerAnywhere = studios.some((s) => s.roles.includes("owner"));
  const reload = () => queryClient.invalidateQueries({ queryKey: ["studios"] });

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <AdminShell
      title="Студии"
      actions={
        isOwnerAnywhere ? (
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Добавить студию
          </Button>
        ) : null
      }
    >
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Логотип</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Цвет</TableHead>
              <TableHead>Приложение клиентов</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeletonRows columns={5} rows={2} />
            ) : studios.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Нет студий, где вы сотрудник.
                </TableCell>
              </TableRow>
            ) : (
              studios.map((s) => {
                const isOwner = s.roles.includes("owner");
                return (
                  <RowContextMenu
                    key={s.id}
                    actions={[
                      ...(s.id !== activeId
                        ? [
                            {
                              label: "Перейти в студию",
                              icon: LogIn,
                              onSelect: () => setActiveStudioId(s.id),
                            },
                          ]
                        : []),
                      ...(isOwner
                        ? [
                            {
                              label: "Редактировать",
                              icon: Pencil,
                              onSelect: () => {
                                setEditing(s);
                                setOpen(true);
                              },
                            },
                          ]
                        : []),
                    ]}
                  >
                    <TableRow>
                      <TableCell>
                        <LogoPreview value={s.logo_url} name={s.name} />
                      </TableCell>
                      <TableCell className="font-medium">
                        {s.name}
                        {s.id === activeId && (
                          <Badge variant="secondary" className="ml-2">
                            Открыта
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{STUDIO_FORMAT_LABEL[s.format]}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase">
                          <span
                            className="size-4 rounded-full border"
                            style={{ backgroundColor: s.brand_color }}
                          />
                          {s.brand_color}
                        </span>
                      </TableCell>
                      <TableCell>
                        <a
                          href={STUDIO_FORMAT_APP_URL[s.format]}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                        >
                          {STUDIO_FORMAT_APP_URL[s.format].replace(/^https?:\/\//, "")}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  </RowContextMenu>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
          <StudioForm
            key={editing?.id ?? "new"}
            item={editing}
            onDone={() => {
              setOpen(false);
              reload();
            }}
          />
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

/** Логотип на подложке цвета меню — так, как он будет выглядеть в админке. */
function LogoPreview({ value, name }: { value: string | null; name: string }) {
  const src = useStorageUrl("studios", value);
  return (
    <div className="flex h-12 w-40 items-center rounded-md bg-sidebar px-3 text-sidebar-foreground">
      {src ? (
        <img src={src} alt={name} className="h-auto max-h-9 w-full object-contain object-left" />
      ) : (
        <span className="truncate text-sm font-semibold">{name}</span>
      )}
    </div>
  );
}

function StudioForm({ item, onDone }: { item: Studio | null; onDone: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [format, setFormat] = useState<StudioFormat>(item?.format ?? "subscription");
  const [color, setColor] = useState(item?.brand_color ?? DEFAULT_BRAND_COLOR);
  const [logo, setLogo] = useState<string | null>(item?.logo_url ?? null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Укажите название студии");
      return;
    }
    if (!isBrandColor(color)) {
      toast.error("Цвет — в формате #RRGGBB, например #F763FC");
      return;
    }
    setSaving(true);
    try {
      const brandColor = color.toLowerCase();
      // Формат после создания не меняется: под ним у студии свои абонементы,
      // расписание и данные, переключение — это миграция, а не правка поля.
      const { error } = item
        ? await supabase
            .from("studios")
            .update({ name: name.trim(), brand_color: brandColor, logo_url: logo })
            .eq("id", item.id)
        : await supabase.rpc("create_studio", {
            _name: name.trim(),
            _format: format,
            _brand_color: brandColor,
            _logo_url: logo,
          });
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(
        item ? "Студия сохранена" : "Студия создана — переключиться на неё можно в шапке",
      );
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Редактировать студию" : "Новая студия"}</DialogTitle>
        <DialogDescription>
          Логотип показывается в шапке бокового меню, основной цвет — цвет иконок и акцентов
          админки, пока открыта эта студия.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="space-y-2">
          <Label>Название</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Base40 Ваке" />
        </div>

        <div className="space-y-2">
          <Label>Тип студии</Label>
          <Select
            value={format}
            onValueChange={(v) => setFormat(v as StudioFormat)}
            disabled={!!item}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STUDIO_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {STUDIO_FORMAT_LABEL[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {item
              ? "Тип задаётся при создании и не меняется: от него зависят абонементы, тренировки и расписание студии."
              : `Клиенты студии пользуются приложением ${STUDIO_FORMAT_APP_URL[format].replace(/^https?:\/\//, "")}. Тип после создания не меняется.`}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Основной цвет</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Выбрать цвет"
              value={isBrandColor(color) ? color : DEFAULT_BRAND_COLOR}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
            />
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value.trim())}
              className="w-32 font-mono uppercase"
              maxLength={7}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Логотип</Label>
          <ImageUploadField
            bucket="studios"
            folder={item?.id ?? "new"}
            value={logo}
            onChange={setLogo}
            preview={<LogoPreview value={logo} name={name || "Название"} />}
            accept="image/svg+xml,image/png,image/webp"
          />
          <p className="text-xs text-muted-foreground">
            Меню тёмное: нужен светлый логотип на прозрачном фоне — SVG или PNG. Без логотипа в меню
            будет название студии.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {item ? "Сохранить" : "Создать студию"}
        </Button>
      </DialogFooter>
    </>
  );
}
