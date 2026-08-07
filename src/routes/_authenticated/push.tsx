import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Loader2, Pencil, Trash2, Send } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { useRefreshSignal } from "@/lib/refresh-bus";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { CLUB_STATUS_LABEL, type ClubStatus } from "@/lib/client-status";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/push")({
  head: () => ({ meta: [{ title: "Пуш-уведомления — Base40 Admin" }] }),
  component: PushPage,
});

type Segment = ClubStatus | "all";
type PushStatus = "draft" | "scheduled" | "sent";

type PushNotification = {
  id: string;
  studio_id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  segments: Segment[];
  scheduled_at: string | null;
  sent_at: string | null;
  status: PushStatus;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  created_at: string;
};

const STATUS_LABEL: Record<PushStatus, string> = {
  draft: "Черновик",
  scheduled: "Запланировано",
  sent: "Отправлено",
};

function fmtDateTime(d: string | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

function renderSegments(segments: Segment[]) {
  if (!segments || segments.length === 0 || segments.includes("all")) {
    return <Badge variant="secondary">Все</Badge>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {segments.map((s) => (
        <Badge key={s} variant="outline">
          {CLUB_STATUS_LABEL[s as ClubStatus]}
        </Badge>
      ))}
    </div>
  );
}

function PushPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const [items, setItems] = useState<PushNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PushNotification | null>(null);

  const fetchAll = async () => {
    if (!studioId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("push_notifications")
      .select("*")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить уведомления: " + error.message);
      return;
    }
    setItems((data as PushNotification[]) ?? []);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshSignal]);

  const handleDelete = async (p: PushNotification) => {
    if (
      !(await confirm({
        title: "Удалить уведомление?",
        description: `«${p.title}» будет удалено без возможности восстановления.`,
      }))
    )
      return;
    const { error } = await supabase.from("push_notifications").delete().eq("id", p.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Уведомление удалено");
    fetchAll();
  };

  const pg = usePagination(items);

  return (
    <AdminShell
      title="Пуш-уведомления"
      actions={
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          disabled={!studioId}
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить уведомление
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
                  <TableHead>Заголовок</TableHead>
                  <TableHead>Сегмент</TableHead>
                  <TableHead>Отправка</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Отправлено</TableHead>
                  <TableHead>Доставлено</TableHead>
                  <TableHead>Прочитано</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={7} />
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Пока нет уведомлений. Нажмите «Добавить уведомление».
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((p) => (
                    <RowContextMenu
                      key={p.id}
                      actions={[
                        {
                          label: "Редактировать",
                          icon: Pencil,
                          onSelect: () => {
                            setEditing(p);
                            setOpen(true);
                          },
                        },
                        {
                          label: "Удалить",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => handleDelete(p),
                        },
                      ]}
                    >
                      <TableRow>
                        <TableCell className="font-medium max-w-[280px]">
                          <div className="truncate">{p.title}</div>
                          {p.message ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {p.message}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>{renderSegments(p.segments)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {p.status === "sent"
                            ? fmtDateTime(p.sent_at)
                            : p.status === "scheduled"
                              ? fmtDateTime(p.scheduled_at)
                              : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              p.status === "sent"
                                ? "default"
                                : p.status === "scheduled"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {STATUS_LABEL[p.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">{p.sent_count}</TableCell>
                        <TableCell className="tabular-nums">{p.delivered_count}</TableCell>
                        <TableCell className="tabular-nums">{p.read_count}</TableCell>
                      </TableRow>
                    </RowContextMenu>
                  ))
                )}
              </TableBody>
            </Table>
            <DataPagination {...pg} />
          </div>
        )}
      </div>

      <PushDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        item={editing}
        onSaved={fetchAll}
      />
      {confirmDialog}
    </AdminShell>
  );
}

const ALL_SEGMENTS: ClubStatus[] = ["chk", "bchk", "pchk"];

function PushDialog({
  open,
  onOpenChange,
  studioId,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  item: PushNotification | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [allSelected, setAllSelected] = useState(true);
  const [segments, setSegments] = useState<ClubStatus[]>([]);
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? "");
    setMessage(item?.message ?? "");
    setActionUrl(item?.action_url ?? "");
    const segs = item?.segments ?? ["all"];
    if (segs.includes("all")) {
      setAllSelected(true);
      setSegments([]);
    } else {
      setAllSelected(false);
      setSegments(segs.filter((s): s is ClubStatus => s !== "all"));
    }
    if (item?.scheduled_at && item.status !== "sent") {
      setSendMode("schedule");
      // local datetime input value
      const d = new Date(item.scheduled_at);
      const tz = d.getTimezoneOffset() * 60000;
      setScheduledAt(new Date(d.getTime() - tz).toISOString().slice(0, 16));
    } else {
      setSendMode("now");
      setScheduledAt("");
    }
  }, [open, item]);

  const toggleSegment = (s: ClubStatus, checked: boolean) => {
    setSegments((prev) =>
      checked ? Array.from(new Set([...prev, s])) : prev.filter((x) => x !== s),
    );
  };

  const handleSave = async (sendNow = false) => {
    if (!studioId) return;
    if (!title.trim()) {
      toast.error("Укажите заголовок");
      return;
    }
    const finalSegments: Segment[] = allSelected ? ["all"] : segments;
    if (!allSelected && segments.length === 0) {
      toast.error("Выберите хотя бы один сегмент");
      return;
    }

    const effectiveMode = sendNow ? "now" : sendMode;
    let status: PushStatus = "draft";
    let sentAt: string | null = null;
    let scheduled: string | null = null;
    if (effectiveMode === "now") {
      status = "sent";
      sentAt = new Date().toISOString();
    } else {
      if (!scheduledAt) {
        toast.error("Укажите дату и время отправки");
        return;
      }
      status = "scheduled";
      scheduled = new Date(scheduledAt).toISOString();
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      studio_id: studioId,
      title: title.trim(),
      message: message.trim() || null,
      segments: finalSegments,
      action_url: actionUrl.trim() || null,
      scheduled_at: scheduled,
      sent_at: sentAt,
      status,
      updated_at: new Date().toISOString(),
    };
    const { error } = item
      ? await supabase.from("push_notifications").update(payload).eq("id", item.id)
      : await supabase.from("push_notifications").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success(
      status === "sent"
        ? "Уведомление отправлено"
        : status === "scheduled"
          ? "Уведомление запланировано"
          : "Уведомление сохранено",
    );
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Редактировать уведомление" : "Новое пуш-уведомление"}</DialogTitle>
          <DialogDescription>
            Уведомление будет отправлено выбранным клиентам в мобильное приложение.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Заголовок</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Скидка 20% на абонементы"
            />
          </div>

          <div className="space-y-2">
            <Label>Сообщение</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Текст пуш-уведомления"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Ссылка перехода (необязательно)</Label>
            <Input
              value={actionUrl}
              onChange={(e) => setActionUrl(e.target.value)}
              placeholder="https://… или внутренний раздел"
            />
            <p className="text-xs text-muted-foreground">
              Если указана, в мобильном приложении в уведомлении появится кнопка «Перейти».
            </p>
          </div>

          <div className="space-y-2">
            <Label>Статус клиентов</Label>
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => setAllSelected(Boolean(v))}
                />
                <span>Все клиенты</span>
              </label>
              <div className="flex flex-wrap gap-3 pl-1">
                {ALL_SEGMENTS.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!allSelected && segments.includes(s)}
                      disabled={allSelected}
                      onCheckedChange={(v) => toggleSegment(s, Boolean(v))}
                    />
                    <span>{CLUB_STATUS_LABEL[s]}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Время отправки</Label>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={sendMode === "now"}
                  onChange={() => setSendMode("now")}
                />
                <span>Отправить сейчас</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={sendMode === "schedule"}
                  onChange={() => setSendMode("schedule")}
                />
                <span>Запланировать</span>
              </label>
            </div>
            {sendMode === "schedule" && (
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => handleSave(false)} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            {sendMode === "now" ? "Отправить" : "Запланировать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
