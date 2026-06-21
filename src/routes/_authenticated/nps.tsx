import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Trash2, CheckCircle2, AlertTriangle, Plus, Loader2 } from "lucide-react";
import { format, parseISO, subMonths, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { ru } from "date-fns/locale";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/nps")({
  head: () => ({ meta: [{ title: "NPS-опросы — CLUB 40 Admin" }] }),
  component: NpsPage,
});

type SurveyType = "first_lessons" | "first_month" | "before_renewal" | "after_return" | "general";

type NpsResponse = {
  id: string;
  score: number;
  client_name: string | null;
  comment: string | null;
  language: string | null;
  survey_type: SurveyType;
  handled: boolean;
  created_at: string;
};

const SURVEY_TYPES: { type: SurveyType; label: string; hint: string }[] = [
  { type: "first_lessons", label: "Первые занятия", hint: "После 3–5 посещений" },
  { type: "first_month", label: "Первый месяц", hint: "Через 30 дней после старта" },
  { type: "before_renewal", label: "Перед продлением", hint: "За 7–14 дней до окончания" },
  { type: "after_return", label: "После возобновления", hint: "Вернувшимся после паузы" },
  { type: "general", label: "Общий", hint: "Любой контекст" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  SURVEY_TYPES.map((s) => [s.type, s.label]),
);

function category(score: number) {
  if (score >= 9) return { label: "Промоутер", cls: "bg-green-100 text-green-700", type: "promoter" };
  if (score >= 7) return { label: "Пассивный", cls: "bg-yellow-100 text-yellow-700", type: "passive" };
  return { label: "Критик", cls: "bg-red-100 text-red-700", type: "detractor" };
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.75rem",
  fontSize: "12px",
};

function NpsPage() {
  const [responses, setResponses] = useState<NpsResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"surveys" | "stats">("surveys");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    score: 9,
    client_name: "",
    comment: "",
    survey_type: "general" as SurveyType,
  });

  const fetchData = async () => {
    const { data, error } = await supabase
      .from("nps_responses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setResponses((data ?? []) as NpsResponse[]);
    setLoading(false);
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const submitNew = async () => {
    setSaving(true);
    const { error } = await supabase.from("nps_responses").insert({
      score: form.score,
      client_name: form.client_name.trim() || null,
      comment: form.comment.trim() || null,
      survey_type: form.survey_type,
      language: "ru",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Ответ добавлен");
    setAddOpen(false);
    setForm({ score: 9, client_name: "", comment: "", survey_type: "general" });
    void fetchData();
  };

  const toggleHandled = async (id: string, current: boolean) => {
    const { error } = await supabase.from("nps_responses").update({ handled: !current }).eq("id", id);
    if (error) return toast.error(error.message);
    setResponses((p) => p.map((r) => (r.id === id ? { ...r, handled: !current } : r)));
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("nps_responses").delete().eq("id", deleteId);
    if (error) return toast.error(error.message);
    setResponses((p) => p.filter((r) => r.id !== deleteId));
    setDeleteId(null);
    toast.success("Ответ удалён");
  };

  const statsFor = (type: string) => {
    const f = type === "all" ? responses : responses.filter((r) => r.survey_type === type);
    const total = f.length;
    const promoters = f.filter((r) => r.score >= 9).length;
    const passives = f.filter((r) => r.score >= 7 && r.score <= 8).length;
    const detractors = f.filter((r) => r.score <= 6).length;
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;
    return { total, promoters, passives, detractors, nps };
  };

  const monthly = useMemo(() => {
    const f = typeFilter === "all" ? responses : responses.filter((r) => r.survey_type === typeFilter);
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(new Date(), 5 - i);
      return { label: format(d, "LLL yy", { locale: ru }), start: startOfMonth(d), end: endOfMonth(d) };
    });
    return months.map((m) => {
      const inM = f.filter((r) => isWithinInterval(parseISO(r.created_at), { start: m.start, end: m.end }));
      const t = inM.length;
      const p = inM.filter((r) => r.score >= 9).length;
      const d = inM.filter((r) => r.score <= 6).length;
      return { month: m.label, NPS: t > 0 ? Math.round(((p - d) / t) * 100) : null };
    });
  }, [responses, typeFilter]);

  const distribution = useMemo(() => {
    const s = statsFor(typeFilter);
    return [
      { name: "Промоутеры", count: s.promoters, color: "hsl(142, 71%, 45%)" },
      { name: "Пассивные", count: s.passives, color: "hsl(45, 93%, 47%)" },
      { name: "Критики", count: s.detractors, color: "hsl(0, 84%, 60%)" },
    ];
  }, [responses, typeFilter]);

  const tableData = useMemo(() => {
    let d = responses;
    if (typeFilter !== "all") d = d.filter((r) => r.survey_type === typeFilter);
    if (clientFilter !== "all") d = d.filter((r) => category(r.score).type === clientFilter);
    return [...d].sort((a, b) => {
      const ac = a.score <= 6 ? 0 : a.score <= 8 ? 1 : 2;
      const bc = b.score <= 6 ? 0 : b.score <= 8 ? 1 : 2;
      if (ac !== bc) return ac - bc;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [responses, typeFilter, clientFilter]);

  const unhandled = useMemo(() => {
    let d = responses.filter((r) => r.score <= 6 && !r.handled);
    if (typeFilter !== "all") d = d.filter((r) => r.survey_type === typeFilter);
    return d.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [responses, typeFilter]);

  const global = statsFor(typeFilter);

  return (
    <AdminShell
      title="NPS-опросы"
      description="Аналитика Net Promoter Score"
      actions={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Добавить ответ</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Новый ответ NPS</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Тип опроса</Label>
                <Select value={form.survey_type} onValueChange={(v) => setForm({ ...form, survey_type: v as SurveyType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SURVEY_TYPES.map((s) => <SelectItem key={s.type} value={s.type}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Оценка (0–10)</Label>
                <Input type="number" min={0} max={10} value={form.score}
                  onChange={(e) => setForm({ ...form, score: Math.max(0, Math.min(10, Number(e.target.value))) })} />
              </div>
              <div>
                <Label>Имя клиента</Label>
                <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
              </div>
              <div>
                <Label>Комментарий</Label>
                <Textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={3} />
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
        <Tabs value={tab} onValueChange={(v) => setTab(v as "surveys" | "stats")}>
          <TabsList>
            <TabsTrigger value="surveys">Опросы</TabsTrigger>
            <TabsTrigger value="stats">Статистика</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <p className="text-muted-foreground">Загрузка…</p>
        ) : tab === "surveys" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {SURVEY_TYPES.map((s) => {
              const st = statsFor(s.type);
              return (
                <Card key={s.type}>
                  <CardContent className="p-5">
                    <h3 className="text-base font-bold">{s.label}</h3>
                    <p className="mb-4 text-xs text-muted-foreground">{s.hint}</p>
                    <div className="grid grid-cols-4 gap-3">
                      <Stat label="NPS" value={st.nps ?? "—"} />
                      <Stat label="Ответов" value={st.total} />
                      <Stat label="Промо" value={st.promoters} cls="text-green-600" />
                      <Stat label="Критики" value={st.detractors} cls="text-red-600" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Тип опроса</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все опросы</SelectItem>
                    {SURVEY_TYPES.map((s) => <SelectItem key={s.type} value={s.type}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Категория</Label>
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    <SelectItem value="promoter">Промоутеры</SelectItem>
                    <SelectItem value="passive">Пассивные</SelectItem>
                    <SelectItem value="detractor">Критики</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <KPI label="NPS" value={global.nps ?? "—"} />
              <KPI label="Ответов" value={global.total} />
              <KPI label="Промоутеры" value={global.promoters} cls="text-green-600" />
              <KPI label="Пассивные" value={global.passives} cls="text-yellow-600" />
              <KPI label="Критики" value={global.detractors} cls="text-red-600" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="p-5">
                  <h3 className="mb-4 text-sm font-semibold">Динамика NPS по месяцам</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis domain={[-100, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="NPS" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <h3 className="mb-4 text-sm font-semibold">Распределение</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={distribution} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                        {distribution.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {unhandled.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <h3 className="text-sm font-semibold">Требуют внимания ({unhandled.length})</h3>
                  </div>
                  <div className="space-y-2">
                    {unhandled.map((r) => (
                      <div key={r.id} className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="text-sm font-semibold">{r.client_name || "—"}</span>
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">{r.score}</span>
                            <span className="text-xs text-muted-foreground">{TYPE_LABEL[r.survey_type]}</span>
                          </div>
                          <p className="truncate text-sm text-muted-foreground">{r.comment || "—"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {format(parseISO(r.created_at), "d MMM yyyy, HH:mm", { locale: ru })}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => toggleHandled(r.id, r.handled)}>
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Обработан
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0">
                <div className="border-b px-5 py-3">
                  <h3 className="text-sm font-semibold">Лента ответов</h3>
                </div>
                {tableData.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Нет ответов</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {["Дата", "Клиент", "Оценка", "Категория", "Комментарий", "Опрос", ""].map((h) => (
                            <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.map((r) => {
                          const c = category(r.score);
                          return (
                            <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                {format(parseISO(r.created_at), "d MMM, HH:mm", { locale: ru })}
                              </td>
                              <td className="px-3 py-2 font-medium">{r.client_name || "—"}</td>
                              <td className="px-3 py-2 text-center font-bold">{r.score}</td>
                              <td className="px-3 py-2">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}>{c.label}</span>
                              </td>
                              <td className="max-w-xs truncate px-3 py-2 text-muted-foreground">{r.comment || "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{TYPE_LABEL[r.survey_type]}</td>
                              <td className="px-2 py-2">
                                <button onClick={() => setDeleteId(r.id)} className="text-muted-foreground/40 hover:text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить ответ?</AlertDialogTitle>
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

function Stat({ label, value, cls = "" }: { label: string; value: number | string; cls?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${cls}`}>{value}</p>
    </div>
  );
}

function KPI({ label, value, cls = "" }: { label: string; value: number | string; cls?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${cls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
