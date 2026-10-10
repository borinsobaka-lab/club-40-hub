import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
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
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogForm,
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
import { Skeleton } from "@/components/ui/skeleton";
import { TableToolbar, ToolbarReset } from "@/components/table-toolbar";
import { cn } from "@/lib/utils";
import { RowContextMenu } from "@/components/row-context-menu";
import { useConfirm } from "@/components/confirm-dialog";

export const Route = createFileRoute("/_authenticated/nps")({
  head: () => ({ meta: [{ title: "NPS-опросы — Base40 Admin" }] }),
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

type NpsBucket = "promoter" | "passive" | "detractor";

/** Категория NPS по оценке 0–10: 9–10 промоутер, 7–8 пассивный, 0–6 критик. */
function npsBucket(score: number): NpsBucket {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

const BUCKET: Record<NpsBucket, { label: string; cls: string; order: number }> = {
  // order — порядок в таблице: сначала критики, им нужно ответить первыми.
  detractor: { label: "Критик", cls: "bg-destructive/10 text-destructive", order: 0 },
  passive: { label: "Пассивный", cls: "bg-amber-500/10 text-amber-700", order: 1 },
  promoter: { label: "Промоутер", cls: "bg-emerald-500/10 text-emerald-700", order: 2 },
};

/** NPS = % промоутеров − % критиков; без ответов — null. */
function npsStats(rows: NpsResponse[]) {
  const counts: Record<NpsBucket, number> = { promoter: 0, passive: 0, detractor: 0 };
  for (const r of rows) counts[npsBucket(r.score)]++;
  const total = rows.length;
  const nps = total > 0 ? Math.round(((counts.promoter - counts.detractor) / total) * 100) : null;
  return {
    total,
    promoters: counts.promoter,
    passives: counts.passive,
    detractors: counts.detractor,
    nps,
  };
}

const byNewest = (a: NpsResponse, b: NpsResponse) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

// Токены темы (src/styles.css) заданы в oklch, поэтому в графиках var(--…)
// подставляется как есть: обёртка hsl(var(--…)) давала невалидный цвет —
// линия NPS и сетка пропадали, у подсказки не было фона.
const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  fontSize: "12px",
};

function NpsPage() {
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<"surveys" | "stats">("surveys");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);

  const queryKey = ["nps_responses", studioId];
  const { data: responses = [], isLoading: loading } = useQuery({
    queryKey,
    queryFn: () => {
      let q = supabase.from("nps_responses").select("*");
      // Ответы своей студии + строки без привязки (см. db/feedback_nps_studio.sql).
      if (studioId) q = q.or(`studio_id.eq.${studioId},studio_id.is.null`);
      return unwrap<NpsResponse[]>(q.order("created_at", { ascending: false }));
    },
    meta: { errorMessage: "Не удалось загрузить ответы NPS" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["nps_responses"] });

  const toggleHandled = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from("nps_responses")
      .update({ handled: !current })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.setQueryData<NpsResponse[]>(queryKey, (prev) =>
      prev?.map((r) => (r.id === id ? { ...r, handled: !current } : r)),
    );
  };

  const handleDelete = async (id: string) => {
    if (
      !(await confirm({
        title: "Удалить ответ?",
        description: "Это действие нельзя отменить.",
      }))
    )
      return;
    const { error } = await supabase.from("nps_responses").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.setQueryData<NpsResponse[]>(queryKey, (prev) => prev?.filter((r) => r.id !== id));
    toast.success("Ответ удалён");
  };

  const byType = useMemo(
    () =>
      typeFilter === "all" ? responses : responses.filter((r) => r.survey_type === typeFilter),
    [responses, typeFilter],
  );

  const monthly = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(new Date(), 5 - i);
      return {
        label: format(d, "LLL yy", { locale: ru }),
        start: startOfMonth(d),
        end: endOfMonth(d),
      };
    });
    return months.map((m) => {
      const inMonth = byType.filter((r) =>
        isWithinInterval(parseISO(r.created_at), { start: m.start, end: m.end }),
      );
      return { month: m.label, NPS: npsStats(inMonth).nps };
    });
  }, [byType]);

  const global = useMemo(() => npsStats(byType), [byType]);

  const distribution = [
    { name: "Промоутеры", count: global.promoters, color: "hsl(142, 71%, 45%)" },
    { name: "Пассивные", count: global.passives, color: "hsl(45, 93%, 47%)" },
    { name: "Критики", count: global.detractors, color: "hsl(0, 84%, 60%)" },
  ];

  const tableData = useMemo(() => {
    const d =
      clientFilter === "all" ? byType : byType.filter((r) => npsBucket(r.score) === clientFilter);
    return [...d].sort((a, b) => {
      const ac = BUCKET[npsBucket(a.score)].order;
      const bc = BUCKET[npsBucket(b.score)].order;
      if (ac !== bc) return ac - bc;
      return byNewest(a, b);
    });
  }, [byType, clientFilter]);

  const unhandled = useMemo(
    () => byType.filter((r) => npsBucket(r.score) === "detractor" && !r.handled).sort(byNewest),
    [byType],
  );

  const pg = usePagination(tableData);

  return (
    <AdminShell
      title="NPS-опросы"
      actions={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> Добавить ответ
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
            <NewResponseForm
              studioId={studioId}
              onClose={() => setAddOpen(false)}
              onSaved={reload}
            />
          </DialogContent>
        </Dialog>
      }
    >
      <div className="space-y-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "surveys" | "stats")}>
          <TabsList>
            <TabsTrigger value="surveys">Опросы</TabsTrigger>
            <TabsTrigger value="stats">Статистика</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-background p-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-2 h-3 w-2/3" />
                <Skeleton className="mt-4 h-8 w-24" />
              </div>
            ))}
          </div>
        ) : tab === "surveys" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {SURVEY_TYPES.map((s) => {
              const st = npsStats(responses.filter((r) => r.survey_type === s.type));
              return (
                <div key={s.type} className="rounded-lg border bg-background p-5">
                  <h3 className="text-base font-semibold">{s.label}</h3>
                  <p className="mb-4 text-xs text-muted-foreground">{s.hint}</p>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
            <TableToolbar>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-48">
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
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Все категории" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все категории</SelectItem>
                  <SelectItem value="promoter">Промоутеры</SelectItem>
                  <SelectItem value="passive">Пассивные</SelectItem>
                  <SelectItem value="detractor">Критики</SelectItem>
                </SelectContent>
              </Select>
              <ToolbarReset
                active={typeFilter !== "all" || clientFilter !== "all"}
                onReset={() => {
                  setTypeFilter("all");
                  setClientFilter("all");
                }}
              />
            </TableToolbar>

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
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis domain={[-100, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line
                      type="monotone"
                      dataKey="NPS"
                      stroke="var(--primary)"
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
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
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
                          <span className="text-sm font-medium">{r.client_name || "—"}</span>
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
                        <CheckCircle2 /> Обработан
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pg.total === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Нет ответов.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.paged.map((r) => {
                      const c = BUCKET[npsBucket(r.score)];
                      return (
                        <RowContextMenu
                          key={r.id}
                          actions={[
                            {
                              label: "Удалить",
                              icon: Trash2,
                              destructive: true,
                              onSelect: () => handleDelete(r.id),
                            },
                          ]}
                        >
                          <TableRow>
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
                          </TableRow>
                        </RowContextMenu>
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

      {confirmDialog}
    </AdminShell>
  );
}

function NewResponseForm({
  studioId,
  onClose,
  onSaved,
}: {
  studioId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [surveyType, setSurveyType] = useState<SurveyType>("general");
  // Строкой: поле можно очистить и набрать заново, проверка — при сохранении.
  const [score, setScore] = useState("9");
  const [clientName, setClientName] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = Number(score.trim());
    if (!score.trim() || !Number.isInteger(value) || value < 0 || value > 10) {
      toast.error("Укажите оценку — целое число от 0 до 10");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("nps_responses").insert({
        studio_id: studioId ?? null,
        score: value,
        client_name: clientName.trim() || null,
        comment: comment.trim() || null,
        survey_type: surveyType,
        language: "ru",
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Ответ добавлен");
      onClose();
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Новый ответ NPS</DialogTitle>
        <DialogDescription>Заполните данные ответа клиента.</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={submit}>
        <DialogBody>
          <div className="space-y-4">
            <FormField
              label="Тип опроса"
              tip="Момент, когда задан вопрос: NPS считается по каждому типу отдельно."
            >
              <Select value={surveyType} onValueChange={(v) => setSurveyType(v as SurveyType)}>
                <SelectTrigger>
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
            </FormField>
            <FormField
              label="Оценка"
              tip="9–10 — промоутер, 7–8 — нейтрал, 0–6 — критик. NPS = % промоутеров − % критиков."
              hint="От 0 до 10."
            >
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={10}
                step={1}
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
            </FormField>
            <FormField label="Имя клиента" optional>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </FormField>
            <FormField label="Комментарий" optional>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

function Stat({ label, value, cls = "" }: { label: string; value: number | string; cls?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", cls)}>{value}</p>
    </div>
  );
}

function KPI({ label, value, cls = "" }: { label: string; value: number | string; cls?: string }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", cls)}>{value}</p>
    </div>
  );
}
