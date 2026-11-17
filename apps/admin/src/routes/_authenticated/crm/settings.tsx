import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, GripVertical, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { useConfirm } from "@/components/confirm-dialog";
import { StageDot, StageSelect } from "@/components/crm/parts";
import { StageAutomations } from "@/components/crm/automations";
import { ChannelsPanel, TemplatesPanel } from "@/components/crm/channels-settings";
import { NONE } from "@/lib/crm/logic";
import { DropIndicator } from "@/components/kb/drop-indicator";
import { CrmSettingsPageSkeleton } from "@/components/page-skeletons";
import { CardSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { ColorInput } from "@/components/ui/color-input";
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
import { FormField, InfoNote } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useDragRow, type RowDropOperation } from "@/hooks/use-drag-row";
import { supabase } from "@/integrations/supabase/client";
import {
  crmAutomationsQuery,
  crmErrorText,
  crmRpc,
  crmSetupQuery,
  invalidateCrm,
} from "@/lib/crm/data";
import { reorderIds } from "@/lib/crm/logic";
import type { CrmLossReason, CrmPipeline, CrmStage } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/crm/settings")({
  head: () => ({ meta: [{ title: "Настройки — CRM — Base40 Admin" }] }),
  pendingComponent: CrmSettingsPageSkeleton,
  component: CrmSettingsPage,
});

const STAGE_COLORS = [
  { hex: "#38bdf8", label: "Голубой" },
  { hex: "#818cf8", label: "Индиго" },
  { hex: "#a78bfa", label: "Фиолетовый" },
  { hex: "#f472b6", label: "Розовый" },
  { hex: "#f59e0b", label: "Янтарный" },
  { hex: "#facc15", label: "Жёлтый" },
  { hex: "#34d399", label: "Зелёный" },
  { hex: "#a3a3a3", label: "Серый" },
];

type Editing =
  | { kind: "pipeline"; item: CrmPipeline | null }
  | { kind: "stage"; item: CrmStage | null; pipelineId: string }
  | { kind: "reason"; item: CrmLossReason | null }
  | { kind: "stage-delete"; item: CrmStage }
  | { kind: "automations"; item: CrmStage };

async function run(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/**
 * «Настройки» CRM (право «CRM: настройка»): воронки и их этапы — создать,
 * переименовать, перекрасить, переставить перетаскиванием, удалить (этап со
 * сделками — с переносом их в другой этап), причины отказа. Воронки общие
 * на всю сеть.
 */
function CrmSettingsPage() {
  const qc = useQueryClient();
  const { data: setup, isLoading } = useQuery(crmSetupQuery);
  const { data: automations = [] } = useQuery(crmAutomationsQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const pipelines = setup?.pipelines ?? [];
  const pipeline = pipelines.find((p) => p.id === selected) ?? pipelines[0] ?? null;
  const stages = (setup?.stages ?? []).filter((s) => s.pipeline_id === pipeline?.id);
  const openStages = stages.filter((s) => s.kind === "open");

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await invalidateCrm(qc);
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(crmErrorText(e));
      return false;
    }
  };

  const dropPipeline = (targetId: string) => (sourceId: string, op: RowDropOperation) =>
    void act(() =>
      crmRpc("crm_pipelines_reorder", {
        p_ids: reorderIds(
          pipelines.map((p) => p.id),
          sourceId,
          targetId,
          op === "reorder-after",
        ),
      }),
    );
  const dropStage = (targetId: string) => (sourceId: string, op: RowDropOperation) =>
    void act(() =>
      crmRpc("crm_stages_reorder", {
        p_pipeline: pipeline!.id,
        p_ids: reorderIds(
          openStages.map((s) => s.id),
          sourceId,
          targetId,
          op === "reorder-after",
        ),
      }),
    );

  const removePipeline = async (p: CrmPipeline) => {
    if (
      !(await confirm({
        title: `Удалить воронку «${p.name}»?`,
        description:
          "Удалятся и её этапы. Воронку со сделками удалить нельзя — её можно скрыть в архив.",
      }))
    )
      return;
    await act(() => run(supabase.from("crm_pipelines").delete().eq("id", p.id)), "Воронка удалена");
  };

  const removeStage = async (s: CrmStage) => {
    const { count } = await supabase
      .from("crm_deals")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", s.id);
    if (count) {
      setEditing({ kind: "stage-delete", item: s });
      return;
    }
    if (!(await confirm({ title: `Удалить этап «${s.name}»?` }))) return;
    await act(() => crmRpc("crm_stage_delete", { p_stage: s.id }), "Этап удалён");
  };

  const removeReason = async (r: CrmLossReason) => {
    if (
      !(await confirm({
        title: `Удалить причину «${r.name}»?`,
        description: "У сделок с этой причиной она станет «не указана».",
      }))
    )
      return;
    await act(() => run(supabase.from("crm_loss_reasons").delete().eq("id", r.id)));
  };

  return (
    <AdminShell title="Настройки CRM">
      <div className="mx-auto max-w-5xl space-y-4">
        <InfoNote>
          Воронки и этапы общие для всех клубов. Строки переставляются перетаскиванием за ручку;
          «Успешно реализовано» и «Закрыто и не реализовано» есть у каждой воронки и всегда стоят
          последними.
        </InfoNote>
        {isLoading || !setup ? (
          <CardSkeleton rows={4} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[18rem_1fr]">
            <Panel
              title="Воронки"
              action={
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setEditing({ kind: "pipeline", item: null })}
                >
                  <Plus />
                  Воронка
                </Button>
              }
            >
              {pipelines.map((p) => (
                <Row
                  key={p.id}
                  id={p.id}
                  type="crm-pipeline"
                  onDropRow={dropPipeline(p.id)}
                  active={p.id === pipeline?.id}
                  onSelect={() => setSelected(p.id)}
                  label={p.name}
                  muted={p.is_archived ? "в архиве" : undefined}
                  actions={
                    <>
                      <IconButton
                        label="Переименовать"
                        onClick={() => setEditing({ kind: "pipeline", item: p })}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={p.is_archived ? "Вернуть из архива" : "В архив"}
                        onClick={() =>
                          void act(() =>
                            run(
                              supabase
                                .from("crm_pipelines")
                                .update({ is_archived: !p.is_archived })
                                .eq("id", p.id),
                            ),
                          )
                        }
                      >
                        {p.is_archived ? <ArchiveRestore /> : <Archive />}
                      </IconButton>
                      <IconButton label="Удалить воронку" onClick={() => void removePipeline(p)}>
                        <Trash2 />
                      </IconButton>
                    </>
                  }
                />
              ))}
              {pipelines.length === 0 && <Empty>Воронок нет — добавьте первую.</Empty>}
            </Panel>

            <Panel
              title={pipeline ? `Этапы воронки «${pipeline.name}»` : "Этапы"}
              action={
                pipeline && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setEditing({ kind: "stage", item: null, pipelineId: pipeline.id })
                    }
                  >
                    <Plus />
                    Этап
                  </Button>
                )
              }
            >
              {stages.map((s) => (
                <Row
                  key={s.id}
                  id={s.id}
                  type="crm-stage"
                  disabled={s.kind !== "open"}
                  onDropRow={dropStage(s.id)}
                  label={s.name}
                  dot={s.color}
                  muted={s.kind === "won" ? "успех" : s.kind === "lost" ? "отказ" : undefined}
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="xs"
                        title="Что происходит со сделкой в этом этапе само"
                        onClick={() => setEditing({ kind: "automations", item: s })}
                      >
                        Автоматизации
                        {automations.some((a) => a.stage_id === s.id)
                          ? ` · ${automations.filter((a) => a.stage_id === s.id).length}`
                          : ""}
                      </Button>
                      <IconButton
                        label="Изменить этап"
                        onClick={() =>
                          setEditing({ kind: "stage", item: s, pipelineId: s.pipeline_id })
                        }
                      >
                        <Pencil />
                      </IconButton>
                      {s.kind === "open" && (
                        <IconButton label="Удалить этап" onClick={() => void removeStage(s)}>
                          <Trash2 />
                        </IconButton>
                      )}
                    </>
                  }
                />
              ))}
              {!pipeline && <Empty>Выберите воронку.</Empty>}
            </Panel>
          </div>
        )}

        {setup && <ChannelsPanel />}
        {setup && <TemplatesPanel />}
        {setup && (
          <Panel
            title="Причины отказа"
            action={
              <Button
                variant="outline"
                size="xs"
                onClick={() => setEditing({ kind: "reason", item: null })}
              >
                <Plus />
                Причина
              </Button>
            }
          >
            {setup.lossReasons.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                <IconButton
                  label="Переименовать"
                  onClick={() => setEditing({ kind: "reason", item: r })}
                >
                  <Pencil />
                </IconButton>
                <IconButton label="Удалить причину" onClick={() => void removeReason(r)}>
                  <Trash2 />
                </IconButton>
              </div>
            ))}
            {setup.lossReasons.length === 0 && <Empty>Причин нет.</Empty>}
          </Panel>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className={editing?.kind === "automations" ? undefined : "sm:max-w-md"}>
          {editing?.kind === "automations" ? (
            <StageAutomations key={editing.item.id} stage={editing.item} stages={stages} />
          ) : editing?.kind === "stage-delete" ? (
            <StageDeleteForm
              key={editing.item.id}
              stage={editing.item}
              others={stages.filter((s) => s.id !== editing.item.id)}
              onDone={async (moveTo) => {
                if (
                  await act(
                    () =>
                      crmRpc("crm_stage_delete", { p_stage: editing.item.id, p_move_to: moveTo }),
                    "Этап удалён, сделки перенесены",
                  )
                )
                  setEditing(null);
              }}
            />
          ) : editing ? (
            <NameForm
              key={`${editing.kind}-${editing.item?.id ?? "new"}`}
              editing={editing}
              onSave={async (name, color) => {
                const ok = await act(() => {
                  if (editing.kind === "pipeline")
                    return editing.item
                      ? run(
                          supabase.from("crm_pipelines").update({ name }).eq("id", editing.item.id),
                        )
                      : run(supabase.from("crm_pipelines").insert({ name }));
                  if (editing.kind === "stage")
                    return editing.item
                      ? run(
                          supabase
                            .from("crm_stages")
                            .update({ name, color })
                            .eq("id", editing.item.id),
                        )
                      : run(
                          supabase
                            .from("crm_stages")
                            .insert({ name, color, pipeline_id: editing.pipelineId }),
                        );
                  return editing.item
                    ? run(
                        supabase
                          .from("crm_loss_reasons")
                          .update({ name })
                          .eq("id", editing.item.id),
                      )
                    : run(
                        supabase.from("crm_loss_reasons").insert({
                          name,
                          sort_order: (setup?.lossReasons.length ?? 0) + 1,
                        }),
                      );
                }, "Сохранено");
                if (ok) setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AdminShell>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="self-start rounded-lg border bg-background">
      <header className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <ul className="py-1">{children}</ul>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-3 py-4 text-center text-sm text-muted-foreground">{children}</li>;
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  );
}

function Row({
  id,
  type,
  disabled,
  onDropRow,
  active,
  onSelect,
  label,
  dot,
  muted,
  actions,
}: {
  id: string;
  type: string;
  disabled?: boolean;
  onDropRow: (sourceId: string, op: RowDropOperation) => void;
  active?: boolean;
  onSelect?: () => void;
  label: string;
  dot?: string;
  muted?: string;
  actions: React.ReactNode;
}) {
  const drag = useDragRow<HTMLLIElement, HTMLSpanElement>({
    id,
    type,
    disabled,
    onDrop: onDropRow,
  });
  const text = (
    <>
      {dot && <StageDot color={dot} />}
      <span className="truncate">{label}</span>
      {muted && <span className="shrink-0 text-xs text-muted-foreground">{muted}</span>}
    </>
  );
  return (
    <li
      ref={drag.ref}
      className={cn(
        "relative flex items-center gap-1 px-1.5",
        drag.dragging && "opacity-40",
        active && "bg-muted",
      )}
    >
      <DropIndicator instruction={drag.instruction} />
      <span
        ref={drag.handleRef}
        aria-hidden
        className={cn(
          "flex items-center px-1 text-muted-foreground",
          disabled ? "invisible" : "cursor-grab",
        )}
      >
        <GripVertical className="size-4" />
      </span>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1.5 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {text}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm">{text}</span>
      )}
      {actions}
    </li>
  );
}

function NameForm({
  editing,
  onSave,
}: {
  editing: Exclude<Editing, { kind: "stage-delete" | "automations" }>;
  onSave: (name: string, color: string) => Promise<void>;
}) {
  const [name, setName] = useState(editing.item?.name ?? "");
  const [color, setColor] = useState(
    editing.kind === "stage" ? (editing.item?.color ?? STAGE_COLORS[0].hex) : "",
  );
  const [saving, setSaving] = useState(false);
  const what =
    editing.kind === "pipeline" ? "воронка" : editing.kind === "stage" ? "этап" : "причина отказа";

  const save = async () => {
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    setSaving(true);
    try {
      await onSave(name.trim(), color);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing.item ? `Изменить: ${what}` : `Новая запись: ${what}`}</DialogTitle>
        <DialogDescription>
          {editing.kind === "pipeline" && !editing.item
            ? "Этапы «Успешно реализовано» и «Закрыто и не реализовано» появятся сами."
            : "Изменение сразу видно всем сотрудникам."}
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={80}
              />
            </FormField>
            {editing.kind === "stage" && (
              <FormField label="Цвет">
                <ColorInput
                  value={color}
                  onChange={setColor}
                  fallback={STAGE_COLORS[0].hex}
                  swatches={STAGE_COLORS}
                />
              </FormField>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

function StageDeleteForm({
  stage,
  others,
  onDone,
}: {
  stage: CrmStage;
  others: CrmStage[];
  onDone: (moveTo: string) => Promise<void>;
}) {
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? NONE);
  const [saving, setSaving] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Удалить этап «{stage.name}»?</DialogTitle>
        <DialogDescription>
          В этапе есть сделки. Выберите этап, куда их перенести.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <FormField label="Перенести сделки в этап" required>
          <StageSelect stages={others} value={moveTo} onChange={setMoveTo} />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="destructive"
          disabled={saving || moveTo === NONE}
          onClick={async () => {
            setSaving(true);
            try {
              await onDone(moveTo);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving && <Loader2 className="animate-spin" />}
          Перенести и удалить
        </Button>
      </DialogFooter>
    </>
  );
}
