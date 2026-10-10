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
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField, InfoNote } from "@/components/ui/form-field";
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
import { cn } from "@/lib/utils";
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
            <Plus />
            Добавить студию
          </Button>
        ) : null
      }
    >
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead className="w-[180px]">Логотип</TableHead>
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
                      <TableCell className="font-medium">
                        {s.name}
                        {s.id === activeId && (
                          <Badge variant="secondary" className="ml-2">
                            Открыта
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <LogoPreview value={s.logo_url} name={s.name} compact />
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
        <DialogContent className="max-w-lg">
          {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
          <StudioForm
            key={editing?.id ?? "new"}
            item={editing}
            onClose={() => setOpen(false)}
            onSaved={reload}
          />
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

/** Логотип на подложке цвета меню — так, как он будет выглядеть в админке. */
function LogoPreview({
  value,
  name,
  compact,
}: {
  value: string | null;
  name: string;
  /** В строке таблицы — ниже, в форме — превью h-16 по стандарту. */
  compact?: boolean;
}) {
  const src = useStorageUrl("studios", value);
  return (
    <div
      className={cn(
        "flex w-40 shrink-0 items-center rounded-md bg-sidebar px-3 text-sidebar-foreground",
        compact ? "h-10" : "h-16",
      )}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className={cn(
            "h-auto w-full object-contain object-left",
            compact ? "max-h-7" : "max-h-12",
          )}
        />
      ) : (
        <span className="truncate text-sm font-semibold">{name}</span>
      )}
    </div>
  );
}

function StudioForm({
  item,
  onClose,
  onSaved,
}: {
  item: Studio | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
        item ? "Студия сохранена" : "Студия создана — переключиться на неё можно в выборе студии",
      );
      onClose();
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const appHost = (f: StudioFormat) => STUDIO_FORMAT_APP_URL[f].replace(/^https?:\/\//, "");

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Редактировать студию" : "Новая студия"}</DialogTitle>
        <DialogDescription>
          Логотип и основной цвет видны в админке, пока открыта эта студия.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Base40 Ваке"
              />
            </FormField>

            {item ? (
              <InfoNote>
                Тип:{" "}
                <span className="font-medium text-foreground">{STUDIO_FORMAT_LABEL[format]}</span>.
                Тип задаётся при создании и не меняется. Приложение клиентов — {appHost(format)}.
              </InfoNote>
            ) : (
              <FormField
                label="Тип студии"
                tip="От типа зависят абонементы, тренировки и расписание студии, а клиенты пользуются приложением этого типа."
                hint={`Приложение клиентов — ${appHost(format)}. После создания тип не меняется.`}
              >
                <Select value={format} onValueChange={(v) => setFormat(v as StudioFormat)}>
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
              </FormField>
            )}

            <FormField
              label="Основной цвет"
              htmlFor={null}
              tip="Цвет иконки активного пункта меню и акцентов админки, пока открыта эта студия."
              hint="В формате #RRGGBB."
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Выбрать цвет"
                  value={isBrandColor(color) ? color : DEFAULT_BRAND_COLOR}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-md border bg-background p-1 lg:h-9"
                />
                <Input
                  aria-label="Цвет в формате #RRGGBB"
                  value={color}
                  onChange={(e) => setColor(e.target.value.trim())}
                  className="w-32 font-mono uppercase"
                  maxLength={7}
                />
              </div>
            </FormField>

            <FormField
              label="Логотип"
              htmlFor={null}
              optional
              tip="Показывается в шапке бокового меню. Без логотипа там будет название студии."
              hint="Меню тёмное — нужен светлый логотип на прозрачном фоне, SVG или PNG."
            >
              <ImageUploadField
                bucket="studios"
                folder={item?.id ?? "new"}
                value={logo}
                onChange={setLogo}
                preview={<LogoPreview value={logo} name={name || "Название"} />}
                accept="image/svg+xml,image/png,image/webp"
              />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {item ? "Сохранить" : "Создать студию"}
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
