import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";
import { useActiveStudioId } from "@/components/studio-switcher";

import { useEffect, useMemo, useState } from "react";
import { Trash2, CheckCircle2, AlertTriangle, Plus, Loader2 } from "lucide-react";
import { format, parseISO, subMonths, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { ru } from "date-fns/locale";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataPagination, usePagination } from "@/components/data-pagination";

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
  if (score >= 9)
    return {
      label: "Промоутер",
      dot: "bg-emerald-500",
      cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      type: "promoter",
    };
  if (score >= 7)
    return {
      label: "Пассивный",
      dot: "bg-amber-500",
      cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
      type: "passive",
    };
  return {
    label: "Критик",
    dot: "bg-destructive",
    cls: "bg-destructive/10 text-destructive",
    type: "detractor",
  };
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.5rem",
  fontSize: "12px",
};

function NpsPage() {
  const studioId = useActiveStudioId();
  const [responses, setResponses] = useState<NpsResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"surveys" | "stats">("surveys");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    score: 9,
    client_name: "",
    comment: "",
    survey_type: "general" as SurveyType,
  });

  const fetchData = async () => {
    let q = supabase.from("nps_responses").select("*");
    // Ответы своей студии + строки без привязки (см. db/feedback_nps_studio.sql).
    if (studioId) q = q.or(`studio_id.eq.${studioId},studio_id.is.null`);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setResponses((data ?? []) as NpsResponse[]);
    setLoading(false);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal, studioId]);

  const submitNew = async () => {
    setSaving(true);
    const { error } = await supabase.from("nps_responses").insert({
      studio_id: studioId ?? null,
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
    const { error } = await supabase
      .from("nps_responses")
      .update({ handled: !current })
      .eq("id", id);
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
    const f =
      typeFilter === "all" ? responses : responses.filter((r) => r.survey_type === typeFilter);
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(new Date(), 5 - i);
      return {
        label: format(d, "LLL yy", { locale: ru }),
        start: startOfMonth(d),
        end: endOfMonth(d),
      };
    });
    return months.map((m) => {
      const inM = f.filter((r) =>
        isWithinInterval(parseISO(r.created_at), { start: m.start, end: m.end }),
      );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const pg = usePagination(tableData);

  return (
    <AdminShell
      title="NPS-опросы"
      description="Аналитика Net Promoter Score"
      actions={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="default">
              <Plus className="mr-1 h-4 w-4" /> Добавить ответ
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Новый ответ NPS</DialogTitle>
              <DialogDescription>Заполните данные ответа клиента.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="survey-type">Тип опроса</Label>
                <Select
                  value={form.survey_type}
                  onValueChange={(v) => setForm({ ...form, survey_type: v as SurveyType })}
                >
                  <SelectTrigger id="survey-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SURVEY_TYPES.map((s) => (
                      <SelectItem key={s.type} value={s.type}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="score">Оценка (0–10)</Label>
                <Input
                  id="score"
                  type="number"
                  min={0}
                  max={10}
                  value={form.score}
                  onChange={(e) =>
                    setForm({ ...form, score: Math.max(0, Math.min(10, Number(e.target.value))) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-name">Имя клиента</Label>
                <Input
                  id="client-name"
                  value={form.client_name}
                  onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="comment">Комментарий</Label>
                <Textarea
                  id="comment"
                  value={form.comment}
                  onChange={(e) => setForm({ ...form, comment: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAddOpen(false)}>
                Отмена
              </Button>
              <Button onClick={submitNew} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="mx-auto max-w-6xl space-y-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "surveys" | "stats")}>
          <TabsList>
            <TabsTrigger value="surveys">Опросы</TabsTrigger>
            <TabsTrigger value="stats">Статистика</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : tab === "surveys" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {SURVEY_TYPES.map((s) => {
              const st = statsFor(s.type);
              return (
                <div key={s.type} className="rounded-lg border bg-background p-5">
                  <h3 className="text-base font-semibold">{s.label}</h3>
                  <p className="mb-4 text-xs text-muted-foreground">{s.hint}</p>
                  <div className="grid grid-cols-4 gap-3">
                    <Stat label="NPS" value={st.nps ?? "—"} />
                    <Stat label="Ответов" value={st.total} />
                    <Stat label="Промо" value={st.promoters} cls="text-emerald-600" />
                    <Stat label="Критики" value={st.detractors} cls="text-destructive" />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2 sm:flex-row sm:items-center">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 sm:w-[200px]">
                  <SelectValue placeholder="Все опросы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все опросы</SelectItem>
                  {SURVEY_TYPES.map((s) => (
                    <SelectItem key={s.type} value={s.type}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger className="h-8 sm:w-[180px]">
                  <SelectValue placeholder="Все категории" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все категории</SelectItem>
                  <SelectItem value="promoter">Промоутеры</SelectItem>
                  <SelectItem value="passive">Пассивные</SelectItem>
                  <SelectItem value="detractor">Критики</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <KPI label="NPS" value={global.nps ?? "—"} />
              <KPI label="Ответов" value={global.total} />
              <KPI label="Промоутеры" value={global.promoters} cls="text-emerald-600" />
              <KPI label="Пассивные" value={global.passives} cls="text-amber-600" />
              <KPI label="Критики" value={global.detractors} cls="text-destructive" />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border bg-background p-5">
                <h3 className="mb-4 text-sm font-semibold">Динамика NPS по месяцам</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis domain={[-100, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line
                      type="monotone"
                      dataKey="NPS"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-lg border bg-background p-5">
                <h3 className="mb-4 text-sm font-semibold">Распределение</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={distribution} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {distribution.map((e, i) => (
                        <Cell key={i} fill={e.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {unhandled.length > 0 && (
              <div className="rounded-lg border bg-background p-5">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <h3 className="text-sm font-semibold">Требуют внимания ({unhandled.length})</h3>
                </div>
                <div className="space-y-2">
                  {unhandled.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start gap-3 rounded-md border bg-muted/30 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{r.client_name || "—"}</span>
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                            {r.score}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {TYPE_LABEL[r.survey_type]}
                          </span>
                        </div>
                        <p className="truncate text-sm text-muted-foreground">{r.comment || "—"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {format(parseISO(r.created_at), "d MMM yyyy, HH:mm", { locale: ru })}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleHandled(r.id, r.handled)}
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Обработан
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead className="w-[80px]">Оценка</TableHead>
                    <TableHead>Категория</TableHead>
                    <TableHead>Комментарий</TableHead>
                    <TableHead>Опрос</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pg.total === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Нет ответов.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.paged.map((r) => {
                      const c = category(r.score);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {format(parseISO(r.created_at), "d MMM, HH:mm", { locale: ru })}
                          </TableCell>
                          <TableCell className="font-medium">{r.client_name || "—"}</TableCell>
                          <TableCell className="text-center font-bold">{r.score}</TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}
                            >
                              {c.label}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[320px] truncate text-muted-foreground">
                            {r.comment || "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {TYPE_LABEL[r.survey_type]}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <Button variant="ghost" size="icon" onClick={() => setDeleteId(r.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <DataPagination {...pg} />
            </div>
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
    <div className="rounded-lg border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
    </div>
  );
}
