import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell, FloatingActions } from "@/components/admin-shell";
import { AaCard } from "@/components/audio/parts";
import { useConfirm } from "@/components/confirm-dialog";
import { AudioMetricCardsSkeleton, AudioMetricsPageSkeleton } from "@/components/page-skeletons";
import { TableToolbar } from "@/components/table-toolbar";
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
import { FormField, InfoNote, SwitchRow } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusChip } from "@/components/ui/status-chip";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { plural } from "@/lib/academy/logic";
import {
  aaFeedbackAllQuery,
  aaMetricsQuery,
  aaPromptsQuery,
  aaRpc,
  aaWrite,
  invalidateAudio,
  type AaFeedbackRow,
} from "@/lib/audio/data";
import { AUDIO_TITLES, PROMPT_LABEL } from "@/lib/audio/labels";
import { formatOffset } from "@/lib/audio/logic";
import type { AaMetric, AaPrompt, AaPromptKey } from "@/lib/audio/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "metrics" | "prompts";

export const Route = createFileRoute("/_authenticated/audio/metrics")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: search.tab === "prompts" ? "prompts" : undefined,
  }),
  head: () => ({ meta: [{ title: "Метрики и промпты — Аудиоаналитика — Base40 Admin" }] }),
  pendingComponent: AudioMetricsPageSkeleton,
  component: MetricsPage,
});

const EXAMPLE_PROMPT = `Оцени, насколько качественно менеджер провёл продажу.

Метрика применима, только если в диалоге была попытка продажи.

Эталон успешной продажи (вставьте свой скрипт):
1. Приветствие и знакомство.
2. Выявление потребности клиента.
3. Презентация услуги под потребность.
4. Работа с возражениями (цена, время, сомнения).
5. Закрытие: запись на занятие с конкретной датой.

Оценка 10 — все этапы пройдены и получено согласие; снижай за каждый
пропущенный этап; 1–3 — менеджер фактически не пытался продавать.`;

const TIPS = {
  name: "Видно в отчётах смен, на дашборде и в чипах списка смен.",
  prompt:
    "Инструкции модели: когда метрика применима, эталонный скрипт, как ставить оценку, как писать «сработало / упущено». Модель сама добавляет оценку по шкале.",
  scale: "Верх шкалы оценки. Старые оценки не пересчитываются — только при «Пересчитать».",
  active: "Отключённая метрика не оценивается в новых разборах; прошлые оценки и отзывы остаются.",
  model:
    "Модель только для этого этапа (например, claude-sonnet-5). Пусто — модель сервиса по умолчанию.",
};

/**
 * Метрики (промпты, по которым модель оценивает каждый разговор смены) и
 * служебные промпты разбора. Рядом с метрикой — несогласия с её оценками:
 * если с ней спорят на разных сменах разные люди, неточна формулировка.
 * Правки применяются к следующим разборам; старые смены — «Пересчитать».
 */
function MetricsPage() {
  const { tab = "metrics" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [edit, setEdit] = useState<AaMetric | "new" | null>(null);

  return (
    <AdminShell title={AUDIO_TITLES.metrics}>
      <div className="space-y-3">
        <TableToolbar>
          <Tabs
            value={tab}
            onValueChange={(v) =>
              void navigate({ search: { tab: v === "prompts" ? "prompts" : undefined } })
            }
            className="toolbar-full"
          >
            <TabsList>
              <TabsTrigger value="metrics">Метрики</TabsTrigger>
              <TabsTrigger value="prompts">Промпты</TabsTrigger>
            </TabsList>
          </Tabs>
        </TableToolbar>
        <InfoNote variant="muted">
          Правки применяются к следующему разбору. Чтобы разобрать прошлую смену по новым метрикам и
          промптам, нажмите у неё «Пересчитать» в «Сменах».
        </InfoNote>
        {tab === "metrics" ? <MetricsTab onEdit={setEdit} /> : <PromptsTab />}
      </div>
      {tab === "metrics" && (
        <FloatingActions>
          <Button onClick={() => setEdit("new")}>
            <Plus />
            Добавить метрику
          </Button>
        </FloatingActions>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-3xl">
          {edit && (
            <MetricForm
              key={edit === "new" ? "new" : edit.id}
              metric={edit === "new" ? null : edit}
              onClose={() => setEdit(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

function MetricsTab({ onEdit }: { onEdit: (m: AaMetric) => void }) {
  const qc = useQueryClient();
  const { data: metrics, isLoading } = useQuery(aaMetricsQuery);
  const { data: feedback = [] } = useQuery(aaFeedbackAllQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const byMetric = useMemo(() => {
    const m = new Map<string, AaFeedbackRow[]>();
    for (const f of feedback) m.set(f.metric_id, [...(m.get(f.metric_id) ?? []), f]);
    return m;
  }, [feedback]);

  if (isLoading || !metrics) return <AudioMetricCardsSkeleton />;

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  };

  // Порядок — перенумеровать все и поменять соседей местами.
  const move = (index: number, dir: -1 | 1) => {
    const next = [...metrics];
    const [m] = next.splice(index, 1);
    next.splice(index + dir, 0, m);
    void act(m.id, () =>
      Promise.all(
        next
          .map((x, i) => ({ x, pos: i + 1 }))
          .filter(({ x, pos }) => x.position !== pos)
          .map(({ x, pos }) =>
            aaWrite(supabase.from("aa_metrics").update({ position: pos }).eq("id", x.id)),
          ),
      ),
    );
  };

  const remove = async (m: AaMetric) => {
    const ok = await confirm({
      title: `Удалить метрику «${m.name}»?`,
      description:
        "Вместе с метрикой удалятся все её оценки в прошлых сменах и отзывы о них. Чтобы метрика просто перестала оцениваться, а история осталась, — отключите её.",
      confirmLabel: "Удалить навсегда",
    });
    if (ok) void act(m.id, () => aaWrite(supabase.from("aa_metrics").delete().eq("id", m.id)));
  };

  const active = metrics.filter((m) => m.active).length;
  const disagreements = feedback.filter((f) => !f.agree).length;

  return (
    <div className="space-y-3">
      {metrics.length > 0 && active === 0 && (
        <InfoNote variant="warning">
          Все метрики отключены — в новых разборах не будет оценок. Включите хотя бы одну.
        </InfoNote>
      )}
      {metrics.length === 0 ? (
        <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
          Метрик пока нет. Добавьте первую — например, «Качество продажи абонемента».
        </div>
      ) : (
        metrics.map((m, i) => (
          <MetricCard
            key={m.id}
            metric={m}
            votes={byMetric.get(m.id) ?? []}
            busy={busy === m.id}
            first={i === 0}
            last={i === metrics.length - 1}
            onUp={() => move(i, -1)}
            onDown={() => move(i, 1)}
            onEdit={() => onEdit(m)}
            onToggle={(on) =>
              void act(m.id, () =>
                aaWrite(supabase.from("aa_metrics").update({ active: on }).eq("id", m.id)),
              )
            }
            onDelete={() => void remove(m)}
          />
        ))
      )}
      {disagreements > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Всего несогласий: {disagreements}. Это не жалобы, а материал: метрика, с оценками которой
          спорят на разных сменах разные люди, почти наверняка сформулирована неточно — правьте
          промпт и пересчитывайте смены.
        </p>
      )}
      {confirmDialog}
    </div>
  );
}

function MetricCard({
  metric: m,
  votes,
  busy,
  first,
  last,
  onUp,
  onDown,
  onEdit,
  onToggle,
  onDelete,
}: {
  metric: AaMetric;
  votes: AaFeedbackRow[];
  busy: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onToggle: (on: boolean) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showVotes, setShowVotes] = useState(false);
  const lines = m.prompt.split("\n").length;
  const disagree = votes.filter((v) => !v.agree);
  const agree = votes.length - disagree.length;

  return (
    <section
      className={cn("rounded-lg border bg-background p-3 sm:p-4", !m.active && "opacity-75")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Выше"
            disabled={first || busy}
            onClick={onUp}
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Ниже"
            disabled={last || busy}
            onClick={onDown}
          >
            <ArrowDown />
          </Button>
        </div>
        <h3 className="min-w-0 truncate font-semibold">{m.name}</h3>
        <StatusChip tone={m.active ? "positive" : "neutral"}>
          {m.active ? "Активна" : "Отключена"}
        </StatusChip>
        <span className="text-xs text-muted-foreground">
          {m.scale_max}-балльная · промпт: {lines} {plural(lines, ["строка", "строки", "строк"])} ·
          изменена {formatDateTime(m.updated_at)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={m.active} disabled={busy} onCheckedChange={onToggle} />
            {m.active ? "Включена" : "Выключена"}
          </label>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil />
            Изменить
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Удалить метрику"
            title="Удалить метрику"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <pre
        className={cn(
          "mt-3 overflow-hidden rounded-md bg-muted/40 p-3 font-sans text-xs whitespace-pre-wrap text-muted-foreground",
          !expanded && "max-h-32",
        )}
      >
        {m.prompt}
      </pre>
      {lines > 8 && (
        <Button size="sm" variant="link" className="px-0" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Свернуть промпт" : "Показать промпт целиком"}
        </Button>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
        {votes.length === 0 ? (
          <span className="text-xs text-muted-foreground">Отзывов об оценках пока нет</span>
        ) : (
          <>
            {disagree.length > 0 ? (
              <StatusChip tone="negative">
                {disagree.length}{" "}
                {plural(disagree.length, ["несогласие", "несогласия", "несогласий"])}
              </StatusChip>
            ) : (
              <StatusChip tone="positive">возражений нет</StatusChip>
            )}
            {agree > 0 && <span className="text-xs text-muted-foreground">согласий: {agree}</span>}
            {disagree.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowVotes(!showVotes)}>
                {showVotes ? "Свернуть" : "Показать где"}
                <ChevronDown className={cn("transition-transform", showVotes && "rotate-180")} />
              </Button>
            )}
          </>
        )}
      </div>
      {showVotes && (
        <ul className="mt-2 divide-y rounded-md border">
          {disagree.map((d) => (
            <li key={d.id} className="space-y-0.5 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <Link
                  to="/audio/$recordingId"
                  params={{ recordingId: d.recording_id }}
                  search={{ dialog: d.dialog_id }}
                  className="font-medium text-link hover:text-link-hover hover:underline"
                >
                  смена {formatDate(d.recording?.date)}
                  {d.dialog && ` · ${formatOffset(d.dialog.start_s)}`}
                </Link>
                <span>{d.subject_name || "менеджер не указан"}</span>
                <span>· возразил {d.author_name || "сотрудник"}</span>
                <span>· {formatDateTime(d.created_at)}</span>
              </div>
              {d.comment && <p>{d.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MetricForm({ metric, onClose }: { metric: AaMetric | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(metric?.name ?? "");
  const [prompt, setPrompt] = useState(metric?.prompt ?? EXAMPLE_PROMPT);
  const [scale, setScale] = useState<"5" | "10">(metric?.scale_max === 5 ? "5" : "10");
  const [active, setActive] = useState(metric?.active ?? true);
  const [errors, setErrors] = useState<{ name?: string; prompt?: string }>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = {
      name: name.trim().length < 2 ? "Название — от 2 символов" : undefined,
      prompt: prompt.trim().length < 10 ? "Промпт слишком короткий" : undefined,
    };
    setErrors(next);
    if (next.name || next.prompt) return;
    setSaving(true);
    try {
      const row = { name: name.trim(), prompt, scale_max: Number(scale), active };
      if (metric) await aaWrite(supabase.from("aa_metrics").update(row).eq("id", metric.id));
      else await aaWrite(supabase.from("aa_metrics").insert(row));
      toast.success(metric ? "Метрика сохранена" : "Метрика добавлена");
      await invalidateAudio(qc);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{metric ? "Метрика" : "Новая метрика"}</DialogTitle>
        <DialogDescription>
          Промпт, по которому модель разбирает каждый разговор смены: применима ли метрика, оценка
          по шкале, что сработало и что упущено.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={save}>
        <DialogBody>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <FormField label="Название" tip={TIPS.name} required error={errors.name}>
                <Input
                  value={name}
                  maxLength={200}
                  onChange={(e) => {
                    setName(e.target.value);
                    setErrors((x) => ({ ...x, name: undefined }));
                  }}
                  placeholder="Например: Качество продажи абонемента"
                />
              </FormField>
              <FormField label="Шкала" tip={TIPS.scale} required htmlFor={null}>
                <SegmentedControl
                  aria-label="Шкала оценки"
                  value={scale}
                  onChange={setScale}
                  options={[
                    { value: "5", label: "5 баллов" },
                    { value: "10", label: "10 баллов" },
                  ]}
                  fullWidth
                />
              </FormField>
            </div>
            <FormField
              label="Промпт — что и как оценивать"
              tip={TIPS.prompt}
              required
              error={errors.prompt}
            >
              <Textarea
                value={prompt}
                rows={18}
                maxLength={60000}
                spellCheck={false}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setErrors((x) => ({ ...x, prompt: undefined }));
                }}
                className="font-mono text-xs"
              />
            </FormField>
            <SwitchRow
              title="Метрика включена"
              hint="Отключённая не оценивается в новых разборах, история остаётся."
              tip={TIPS.active}
              checked={active}
              onCheckedChange={setActive}
            />
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

// --- Служебные промпты ----------------------------------------------------------

function PromptsTab() {
  const { data: prompts, isLoading } = useQuery(aaPromptsQuery);
  if (isLoading || !prompts) return <AudioMetricCardsSkeleton />;
  const keys = Object.keys(PROMPT_LABEL) as AaPromptKey[];
  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const versions = prompts.filter((p) => p.key === key);
        const current = versions.find((p) => p.active) ?? versions[0];
        if (!current)
          return (
            <InfoNote key={key} variant="warning">
              Промпт «{PROMPT_LABEL[key].title}» не найден в базе — проверьте миграцию.
            </InfoNote>
          );
        return (
          <PromptEditor
            key={`${key}-${current.id}`}
            current={current}
            versions={versions}
            promptKey={key}
          />
        );
      })}
    </div>
  );
}

function PromptEditor({
  current,
  versions,
  promptKey,
}: {
  current: AaPrompt;
  versions: AaPrompt[];
  promptKey: AaPromptKey;
}) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [content, setContent] = useState(current.content);
  const [model, setModel] = useState(current.model ?? "");
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openVersion, setOpenVersion] = useState<string | null>(null);
  const changed = content !== current.content || model.trim() !== (current.model ?? "");

  const save = async (text: string, mdl: string, message: string) => {
    if (!text.trim()) {
      toast.error("Промпт пустой");
      return;
    }
    setSaving(true);
    try {
      await aaRpc("aa_prompt_save", {
        p_key: promptKey,
        p_content: text,
        p_model: mdl.trim() || null,
      });
      toast.success(message);
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить промпт");
    } finally {
      setSaving(false);
    }
  };

  const restore = async (v: AaPrompt) => {
    const ok = await confirm({
      title: `Вернуть версию ${v.version}?`,
      description: "Её текст и модель станут новой версией промпта — история не теряется.",
      confirmLabel: "Вернуть",
      destructive: false,
    });
    if (ok) void save(v.content, v.model ?? "", `Версия ${v.version} возвращена`);
  };

  return (
    <AaCard
      title={PROMPT_LABEL[promptKey].title}
      hint={`версия ${current.version} · ${current.updated_by_name || "—"}, ${formatDateTime(current.created_at)}`}
    >
      <div className="space-y-3">
        {current.description && (
          <p className="text-sm text-muted-foreground">{current.description}</p>
        )}
        <InfoNote variant="info">
          Подстановки: {PROMPT_LABEL[promptKey].placeholders} Не удаляйте их — без них модель не
          увидит данных смены.
        </InfoNote>
        <Textarea
          value={content}
          rows={16}
          maxLength={100000}
          spellCheck={false}
          onChange={(e) => setContent(e.target.value)}
          aria-label={`Текст промпта «${PROMPT_LABEL[promptKey].title}»`}
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Модель" tip={TIPS.model} optional className="w-72 max-w-full">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="по умолчанию сервиса"
            />
          </FormField>
          <Button
            disabled={!changed || saving}
            onClick={() => void save(content, model, "Промпт сохранён новой версией")}
          >
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
          {changed && (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                setContent(current.content);
                setModel(current.model ?? "");
              }}
            >
              Отменить правки
            </Button>
          )}
        </div>
        {versions.length > 1 && (
          <div className="border-t pt-2">
            <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(!historyOpen)}>
              История версий · {versions.length}
              <ChevronDown className={cn("transition-transform", historyOpen && "rotate-180")} />
            </Button>
            {historyOpen && (
              <ul className="mt-2 divide-y rounded-md border">
                {versions.map((v) => (
                  <li key={v.id} className="space-y-2 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">Версия {v.version}</span>
                      {v.id === current.id && <StatusChip tone="positive">действует</StatusChip>}
                      <span className="text-xs text-muted-foreground">
                        {v.updated_by_name || "—"}, {formatDateTime(v.created_at)}
                        {v.model && ` · модель ${v.model}`}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setOpenVersion(openVersion === v.id ? null : v.id)}
                        >
                          {openVersion === v.id ? "Скрыть текст" : "Текст"}
                        </Button>
                        {v.id !== current.id && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={saving}
                            onClick={() => void restore(v)}
                          >
                            Вернуть эту версию
                          </Button>
                        )}
                      </div>
                    </div>
                    {openVersion === v.id && (
                      <pre className="max-h-80 overflow-auto rounded-md bg-muted/40 p-3 font-sans text-xs whitespace-pre-wrap">
                        {v.content}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {confirmDialog}
    </AaCard>
  );
}
