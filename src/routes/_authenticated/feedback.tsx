import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, MessageSquare, X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/feedback")({
  head: () => ({ meta: [{ title: "Обратная связь — CLUB 40 Admin" }] }),
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

const MOOD: Record<string, string> = { negative: "😞", neutral: "😐", positive: "😊" };

function FeedbackPage() {
  const [items, setItems] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolutionComment, setResolutionComment] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [topicFilter, setTopicFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [moodFilter, setMoodFilter] = useState("all");

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    topic: "other",
    message: "",
    mood: "" as string,
    client_name: "",
    client_contact: "",
  });

  const fetchItems = async () => {
    const { data, error } = await supabase
      .from("feedback")
      .select("*")
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setItems((data ?? []) as Feedback[]);
    setLoading(false);
  };

  useEffect(() => {
    void fetchItems();
  }, []);

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

  const selected = items.find((i) => i.id === selectedId) || null;

  const now = new Date();
  const thisMonth = items.filter((i) => {
    const d = new Date(i.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const pendingCount = items.filter((i) => i.status === "pending").length;
  const resolvedThisMonth = thisMonth.filter((i) => i.status === "resolved").length;

  const submitNew = async () => {
    if (!form.message.trim()) return toast.error("Введите сообщение");
    setSaving(true);
    const { error } = await supabase.from("feedback").insert({
      topic: form.topic,
      message: form.message.trim(),
      mood: form.mood || null,
      client_name: form.client_name.trim() || null,
      client_contact: form.client_contact.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Обращение добавлено");
    setAddOpen(false);
    setForm({ topic: "other", message: "", mood: "", client_name: "", client_contact: "" });
    void fetchItems();
  };

  const handleResolve = async () => {
    if (!selected) return;
    const session = await supabase.auth.getSession();
    const user = session.data.session?.user;
    const { error } = await supabase
      .from("feedback")
      .update({
        status: "resolved",
        resolved_by: user?.id ?? null,
        resolved_by_name: user?.email ?? null,
        resolved_at: new Date().toISOString(),
        resolution_comment: resolutionComment.trim() || null,
      })
      .eq("id", selected.id);
    if (error) return toast.error(error.message);
    toast.success("Обращение отработано");
    setSelectedId(null);
    void fetchItems();
  };

  const handleReopen = async () => {
    if (!selected) return;
    const { error } = await supabase
      .from("feedback")
      .update({
        status: "pending",
        resolved_by: null,
        resolved_by_name: null,
        resolved_at: null,
        resolution_comment: null,
      })
      .eq("id", selected.id);
    if (error) return toast.error(error.message);
    toast.success("Возвращено в работу");
    setSelectedId(null);
    void fetchItems();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("feedback").delete().eq("id", deleteId);
    if (error) return toast.error(error.message);
    setItems((p) => p.filter((i) => i.id !== deleteId));
    setDeleteId(null);
    toast.success("Удалено");
  };

  const hasFilters = topicFilter !== "all" || statusFilter !== "all" || moodFilter !== "all";

  return (
    <AdminShell
      title="Обратная связь"
      description="Обращения клиентов и их обработка"
      actions={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Добавить</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Новое обращение</DialogTitle>
              <DialogDescription>Заполните данные обращения клиента.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="topic">Тема</Label>
                <Select value={form.topic} onValueChange={(v) => setForm({ ...form, topic: v })}>
                  <SelectTrigger id="topic"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TOPICS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message">Сообщение</Label>
                <Textarea id="message" rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mood">Оценка</Label>
                <Select value={form.mood || "none"} onValueChange={(v) => setForm({ ...form, mood: v === "none" ? "" : v })}>
                  <SelectTrigger id="mood"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без оценки</SelectItem>
                    <SelectItem value="negative">😞 Плохо</SelectItem>
                    <SelectItem value="neutral">😐 Нормально</SelectItem>
                    <SelectItem value="positive">😊 Хорошо</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cname">Имя</Label>
                  <Input id="cname" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ccontact">Контакт</Label>
                  <Input id="ccontact" value={form.client_contact} onChange={(e) => setForm({ ...form, client_contact: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAddOpen(false)}>Отмена</Button>
              <Button onClick={submitNew} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs text-muted-foreground">В этом месяце</p>
            <p className="mt-1 text-2xl font-bold">{thisMonth.length}</p>
          </div>
          <div className={`rounded-lg border bg-background p-4 ${pendingCount > 0 ? "border-destructive/30 bg-destructive/5" : ""}`}>
            <p className="text-xs text-muted-foreground">Не отработано</p>
            <p className={`mt-1 text-2xl font-bold ${pendingCount > 0 ? "text-destructive" : ""}`}>{pendingCount}</p>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs text-muted-foreground">Отработано в этом месяце</p>
            <p className="mt-1 text-2xl font-bold">{resolvedThisMonth}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2 sm:flex-row sm:items-center">
          <Select value={topicFilter} onValueChange={setTopicFilter}>
            <SelectTrigger className="h-8 sm:w-[180px]"><SelectValue placeholder="Все темы" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все темы</SelectItem>
              {Object.entries(TOPICS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 sm:w-[160px]"><SelectValue placeholder="Все статусы" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="pending">Не отработано</SelectItem>
              <SelectItem value="resolved">Отработано</SelectItem>
            </SelectContent>
          </Select>
          <Select value={moodFilter} onValueChange={setMoodFilter}>
            <SelectTrigger className="h-8 sm:w-[160px]"><SelectValue placeholder="Все оценки" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все оценки</SelectItem>
              <SelectItem value="negative">😞 Плохо</SelectItem>
              <SelectItem value="neutral">😐 Нормально</SelectItem>
              <SelectItem value="positive">😊 Хорошо</SelectItem>
              <SelectItem value="none">Без оценки</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => { setTopicFilter("all"); setStatusFilter("all"); setMoodFilter("all"); }}>
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
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                    Обращений нет.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((i) => (
                  <TableRow
                    key={i.id}
                    onClick={() => { setSelectedId(i.id); setResolutionComment(i.resolution_comment || ""); }}
                    className="cursor-pointer"
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(i.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{TOPICS[i.topic] || i.topic}</TableCell>
                    <TableCell className="max-w-[280px] truncate">{i.message}</TableCell>
                    <TableCell className="text-center text-lg">{i.mood ? MOOD[i.mood] : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{i.client_name || "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate whitespace-nowrap text-muted-foreground">{i.client_contact || "—"}</TableCell>
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
                          {i.resolved_at && <div>{format(new Date(i.resolved_at), "dd.MM.yy", { locale: ru })}</div>}
                        </>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); setDeleteId(i.id); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected ? TOPICS[selected.topic] || selected.topic : ""}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Дата</p>
                <p className="text-sm">{format(new Date(selected.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Сообщение</p>
                <p className="whitespace-pre-wrap text-sm">{selected.message}</p>
              </div>
              {selected.mood && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Оценка</p>
                  <p className="text-lg">{MOOD[selected.mood]}</p>
                </div>
              )}
              {(selected.client_name || selected.client_contact) && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Клиент</p>
                  <p className="text-sm">{selected.client_name || "—"}{selected.client_contact ? ` · ${selected.client_contact}` : ""}</p>
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
                  disabled={selected.status === "resolved"}
                />
              </div>
              {selected.status === "pending" ? (
                <Button className="w-full" onClick={handleResolve}>Отметить отработанным</Button>
              ) : (
                <>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Обработано</p>
                    <p className="text-sm">
                      {selected.resolved_by_name || "—"}
                      {selected.resolved_at && ` · ${format(new Date(selected.resolved_at), "d MMM yyyy", { locale: ru })}`}
                    </p>
                    {selected.resolution_comment && (
                      <p className="mt-2 whitespace-pre-wrap text-sm">{selected.resolution_comment}</p>
                    )}
                  </div>
                  <Button variant="outline" className="w-full" onClick={handleReopen}>Вернуть в работу</Button>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить обращение?</AlertDialogTitle>
            <AlertDialogDescription>Это действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}
