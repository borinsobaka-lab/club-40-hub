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
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

  return (
    <AdminShell
      title="Обратная связь"
      description="Обращения клиентов и их обработка"
      actions={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Добавить</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Новое обращение</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Тема</Label>
                <Select value={form.topic} onValueChange={(v) => setForm({ ...form, topic: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TOPICS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Сообщение</Label>
                <Textarea rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              </div>
              <div>
                <Label>Оценка</Label>
                <Select value={form.mood || "none"} onValueChange={(v) => setForm({ ...form, mood: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без оценки</SelectItem>
                    <SelectItem value="negative">😞 Плохо</SelectItem>
                    <SelectItem value="neutral">😐 Нормально</SelectItem>
                    <SelectItem value="positive">😊 Хорошо</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Имя</Label>
                  <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
                </div>
                <div>
                  <Label>Контакт</Label>
                  <Input value={form.client_contact} onChange={(e) => setForm({ ...form, client_contact: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAddOpen(false)}>Отмена</Button>
              <Button onClick={submitNew} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card><CardContent className="p-5">
            <p className="text-xs text-muted-foreground">В этом месяце</p>
            <p className="mt-1 text-2xl font-bold">{thisMonth.length}</p>
          </CardContent></Card>
          <Card className={pendingCount > 0 ? "border-destructive/30 bg-destructive/5" : ""}>
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">Не отработано</p>
              <p className={`mt-1 text-2xl font-bold ${pendingCount > 0 ? "text-destructive" : ""}`}>{pendingCount}</p>
            </CardContent>
          </Card>
          <Card><CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Отработано в этом месяце</p>
            <p className="mt-1 text-2xl font-bold">{resolvedThisMonth}</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Тема</Label>
              <Select value={topicFilter} onValueChange={setTopicFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {Object.entries(TOPICS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Статус</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="pending">Не отработано</SelectItem>
                  <SelectItem value="resolved">Отработано</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Оценка</Label>
              <Select value={moodFilter} onValueChange={setMoodFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="negative">😞 Плохо</SelectItem>
                  <SelectItem value="neutral">😐 Нормально</SelectItem>
                  <SelectItem value="positive">😊 Хорошо</SelectItem>
                  <SelectItem value="none">Без оценки</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(topicFilter !== "all" || statusFilter !== "all" || moodFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setTopicFilter("all"); setStatusFilter("all"); setMoodFilter("all"); }}>
                <X className="mr-1 h-3.5 w-3.5" /> Сбросить
              </Button>
            )}
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-muted-foreground">Загрузка…</p>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Обращений нет</p>
          </CardContent></Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Дата", "Тема", "Сообщение", "Оценка", "Имя", "Контакт", "Статус", "Отработал", ""].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id} onClick={() => { setSelectedId(i.id); setResolutionComment(i.resolution_comment || ""); }}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {format(new Date(i.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{TOPICS[i.topic] || i.topic}</td>
                      <td className="max-w-[280px] truncate px-3 py-2 text-foreground/80">{i.message}</td>
                      <td className="px-3 py-2 text-center text-lg">{i.mood ? MOOD[i.mood] : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground/80">{i.client_name || "—"}</td>
                      <td className="max-w-[140px] truncate whitespace-nowrap px-3 py-2 text-foreground/80">{i.client_contact || "—"}</td>
                      <td className="px-3 py-2">
                        {i.status === "pending" ? (
                          <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">Не отработано</span>
                        ) : (
                          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Отработано</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {i.resolved_by_name ? (
                          <>
                            {i.resolved_by_name}
                            {i.resolved_at && <div>{format(new Date(i.resolved_at), "dd.MM.yy", { locale: ru })}</div>}
                          </>
                        ) : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={(e) => { e.stopPropagation(); setDeleteId(i.id); }}
                          className="text-muted-foreground/40 hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected ? TOPICS[selected.topic] || selected.topic : ""}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Дата</p>
                <p className="text-sm">{format(new Date(selected.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Сообщение</p>
                <p className="whitespace-pre-wrap text-sm">{selected.message}</p>
              </div>
              {selected.mood && (
                <div>
                  <p className="text-xs text-muted-foreground">Оценка</p>
                  <p className="text-lg">{MOOD[selected.mood]}</p>
                </div>
              )}
              {(selected.client_name || selected.client_contact) && (
                <div>
                  <p className="text-xs text-muted-foreground">Клиент</p>
                  <p className="text-sm">{selected.client_name || "—"}{selected.client_contact ? ` · ${selected.client_contact}` : ""}</p>
                </div>
              )}
              <div>
                <Label className="text-xs">Комментарий обработки</Label>
                <Textarea
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
                    <p className="text-sm">{selected.resolved_by_name || "—"}{selected.resolved_at && ` · ${format(new Date(selected.resolved_at), "d MMM yyyy", { locale: ru })}`}</p>
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
