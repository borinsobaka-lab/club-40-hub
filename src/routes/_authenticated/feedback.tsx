import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, MessageSquare, X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { RowContextMenu } from "@/components/row-context-menu";
import { useConfirm } from "@/components/confirm-dialog";

export const Route = createFileRoute("/_authenticated/feedback")({
  head: () => ({ meta: [{ title: "Обратная связь — Base40 Admin" }] }),
  component: FeedbackPage,
});

type Feedback = {
  id: string;
  topic: string;
  message: string;
  mood: string | null;
  client_name: string | null;
  client_contact: string | null;
  status: "pending" | "resolved";
  resolved_by: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_comment: string | null;
  created_at: string;
};

const TOPICS: Record<string, string> = {
  training: "🏋️ Тренировка",
  staff: "👩‍💼 Сотрудник",
  cleanliness: "🧹 Чистота",
  app: "📱 Приложение",
  idea: "💡 Идея",
  thanks: "😊 Спасибо",
  other: "❓ Другое",
};

const MOOD_OPTIONS = [
  { value: "negative", emoji: "😞", label: "Плохо" },
  { value: "neutral", emoji: "😐", label: "Нормально" },
  { value: "positive", emoji: "😊", label: "Хорошо" },
];

const MOOD: Record<string, string> = Object.fromEntries(
  MOOD_OPTIONS.map((m) => [m.value, m.emoji]),
);

function moodSelectItems() {
  return MOOD_OPTIONS.map((m) => (
    <SelectItem key={m.value} value={m.value}>
      {m.emoji} {m.label}
    </SelectItem>
  ));
}

function FeedbackPage() {
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const [topicFilter, setTopicFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [moodFilter, setMoodFilter] = useState("all");

  const queryKey = ["feedback", studioId];
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey,
    queryFn: () => {
      let q = supabase.from("feedback").select("*");
      // Отзывы своей студии + строки без привязки (созданные до миграции
      // db/feedback_nps_studio.sql при нескольких студиях) — чтобы ни один
      // отзыв не пропал из виду.
      if (studioId) q = q.or(`studio_id.eq.${studioId},studio_id.is.null`);
      return unwrap<Feedback[]>(
        q.order("status", { ascending: true }).order("created_at", { ascending: false }),
      );
    },
    meta: { errorMessage: "Не удалось загрузить обращения" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["feedback"] });

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (topicFilter !== "all" && i.topic !== topicFilter) return false;
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (moodFilter !== "all") {
        if (moodFilter === "none" && i.mood) return false;
        if (moodFilter !== "none" && i.mood !== moodFilter) return false;
      }
      return true;
    });
  }, [items, topicFilter, statusFilter, moodFilter]);

  const pg = usePagination(filtered);

  const selected = items.find((i) => i.id === selectedId) || null;

  const now = new Date();
  const thisMonth = items.filter((i) => {
    const d = new Date(i.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const pendingCount = items.filter((i) => i.status === "pending").length;
  const resolvedThisMonth = thisMonth.filter((i) => i.status === "resolved").length;

  const handleDelete = async (item: Feedback) => {
    if (
      !(await confirm({
        title: "Удалить обращение?",
        description: "Это действие нельзя отменить.",
      }))
    )
      return;
    const { error } = await supabase.from("feedback").delete().eq("id", item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.setQueryData<Feedback[]>(queryKey, (prev) => prev?.filter((i) => i.id !== item.id));
    toast.success("Удалено");
  };

  const hasFilters = topicFilter !== "all" || statusFilter !== "all" || moodFilter !== "all";

  return (
    <AdminShell
      title="Обратная связь"
      actions={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-1 h-4 w-4" /> Добавить
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
            <NewFeedbackForm
              studioId={studioId}
              onClose={() => setAddOpen(false)}
              onSaved={reload}
            />
          </DialogContent>
        </Dialog>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs text-muted-foreground">В этом месяце</p>
            <p className="mt-1 text-2xl font-bold">{thisMonth.length}</p>
          </div>
          <div
            className={`rounded-lg border bg-background p-4 ${pendingCount > 0 ? "border-destructive/30 bg-destructive/5" : ""}`}
          >
            <p className="text-xs text-muted-foreground">Не отработано</p>
            <p className={`mt-1 text-2xl font-bold ${pendingCount > 0 ? "text-destructive" : ""}`}>
              {pendingCount}
            </p>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs text-muted-foreground">Отработано в этом месяце</p>
            <p className="mt-1 text-2xl font-bold">{resolvedThisMonth}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2 sm:flex-row sm:items-center">
          <Select value={topicFilter} onValueChange={setTopicFilter}>
            <SelectTrigger className="sm:w-[180px]">
              <SelectValue placeholder="Все темы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все темы</SelectItem>
              {Object.entries(TOPICS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-[160px]">
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="pending">Не отработано</SelectItem>
              <SelectItem value="resolved">Отработано</SelectItem>
            </SelectContent>
          </Select>
          <Select value={moodFilter} onValueChange={setMoodFilter}>
            <SelectTrigger className="sm:w-[160px]">
              <SelectValue placeholder="Все оценки" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все оценки</SelectItem>
              {moodSelectItems()}
              <SelectItem value="none">Без оценки</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="ghost"
              onClick={() => {
                setTopicFilter("all");
                setStatusFilter("all");
                setMoodFilter("all");
              }}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Сбросить
            </Button>
          )}
        </div>

        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Тема</TableHead>
                <TableHead>Сообщение</TableHead>
                <TableHead className="w-[80px] text-center">Оценка</TableHead>
                <TableHead>Имя</TableHead>
                <TableHead>Контакт</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Отработал</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeletonRows columns={8} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                    Обращений нет.
                  </TableCell>
                </TableRow>
              ) : (
                pg.paged.map((i) => (
                  <RowContextMenu
                    key={i.id}
                    actions={[
                      {
                        label: "Открыть обращение",
                        icon: MessageSquare,
                        onSelect: () => setSelectedId(i.id),
                      },
                      {
                        label: "Удалить",
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => handleDelete(i),
                      },
                    ]}
                  >
                    <TableRow onClick={() => setSelectedId(i.id)} className="cursor-pointer">
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {format(new Date(i.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {TOPICS[i.topic] || i.topic}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate">{i.message}</TableCell>
                      <TableCell className="text-center text-lg">
                        {i.mood ? MOOD[i.mood] : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {i.client_name || "—"}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate whitespace-nowrap text-muted-foreground">
                        {i.client_contact || "—"}
                      </TableCell>
                      <TableCell>
                        {i.status === "pending" ? (
                          <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                            Не отработано
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            Отработано
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {i.resolved_by_name ? (
                          <>
                            {i.resolved_by_name}
                            {i.resolved_at && (
                              <div>
                                {format(new Date(i.resolved_at), "dd.MM.yy", { locale: ru })}
                              </div>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  </RowContextMenu>
                ))
              )}
            </TableBody>
          </Table>
          <DataPagination {...pg} />
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected ? TOPICS[selected.topic] || selected.topic : ""}</SheetTitle>
          </SheetHeader>
          {selected && (
            <FeedbackDetails
              key={selected.id}
              item={selected}
              onDone={() => {
                setSelectedId(null);
                reload();
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {confirmDialog}
    </AdminShell>
  );
}

function NewFeedbackForm({
  studioId,
  onClose,
  onSaved,
}: {
  studioId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [topic, setTopic] = useState("other");
  const [message, setMessage] = useState("");
  const [mood, setMood] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!message.trim()) {
      toast.error("Введите сообщение");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("feedback").insert({
        studio_id: studioId ?? null,
        topic,
        message: message.trim(),
        mood: mood || null,
        client_name: clientName.trim() || null,
        client_contact: clientContact.trim() || null,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Обращение добавлено");
      onClose();
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Новое обращение</DialogTitle>
        <DialogDescription>Заполните данные обращения клиента.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="topic">Тема</Label>
            <Select value={topic} onValueChange={setTopic}>
              <SelectTrigger id="topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TOPICS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="message">Сообщение</Label>
            <Textarea
              id="message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mood">Оценка</Label>
            <Select value={mood || "none"} onValueChange={(v) => setMood(v === "none" ? "" : v)}>
              <SelectTrigger id="mood">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без оценки</SelectItem>
                {moodSelectItems()}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cname">Имя</Label>
              <Input
                id="cname"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ccontact">Контакт</Label>
              <Input
                id="ccontact"
                value={clientContact}
                onChange={(e) => setClientContact(e.target.value)}
              />
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Сохранить
        </Button>
      </DialogFooter>
    </>
  );
}

/** Карточка обращения в боковой панели: отметить отработанным / вернуть в работу. */
function FeedbackDetails({ item, onDone }: { item: Feedback; onDone: () => void }) {
  const { ensure: ensureMe } = useStaffProfile();
  const [resolutionComment, setResolutionComment] = useState(item.resolution_comment || "");
  const [busy, setBusy] = useState(false);

  const update = async (patch: Partial<Feedback>, successMessage: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("feedback").update(patch).eq("id", item.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(successMessage);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const handleResolve = async () => {
    const me = await ensureMe();
    return update(
      {
        status: "resolved",
        resolved_by: me?.id ?? null,
        resolved_by_name: me?.email ?? null,
        resolved_at: new Date().toISOString(),
        resolution_comment: resolutionComment.trim() || null,
      },
      "Обращение отработано",
    );
  };

  const handleReopen = () =>
    update(
      {
        status: "pending",
        resolved_by: null,
        resolved_by_name: null,
        resolved_at: null,
        resolution_comment: null,
      },
      "Возвращено в работу",
    );

  return (
    <div className="mt-6 space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Дата</p>
        <p className="text-sm">
          {format(new Date(item.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Сообщение</p>
        <p className="whitespace-pre-wrap text-sm">{item.message}</p>
      </div>
      {item.mood && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Оценка</p>
          <p className="text-lg">{MOOD[item.mood]}</p>
        </div>
      )}
      {(item.client_name || item.client_contact) && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Клиент</p>
          <p className="text-sm">
            {item.client_name || "—"}
            {item.client_contact ? ` · ${item.client_contact}` : ""}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="resolution">Комментарий обработки</Label>
        <Textarea
          id="resolution"
          value={resolutionComment}
          onChange={(e) => setResolutionComment(e.target.value)}
          placeholder="Что сделано?"
          rows={4}
          disabled={item.status === "resolved"}
        />
      </div>
      {item.status === "pending" ? (
        <Button className="w-full" onClick={handleResolve} disabled={busy}>
          Отметить отработанным
        </Button>
      ) : (
        <>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Обработано</p>
            <p className="text-sm">
              {item.resolved_by_name || "—"}
              {item.resolved_at &&
                ` · ${format(new Date(item.resolved_at), "d MMM yyyy", { locale: ru })}`}
            </p>
            {item.resolution_comment && (
              <p className="mt-2 whitespace-pre-wrap text-sm">{item.resolution_comment}</p>
            )}
          </div>
          <Button variant="outline" className="w-full" onClick={handleReopen} disabled={busy}>
            Вернуть в работу
          </Button>
        </>
      )}
    </div>
  );
}
