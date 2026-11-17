import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { DealDialog } from "@/components/crm/deal-dialog";
import { DealForm } from "@/components/crm/deal-form";
import { Kanban } from "@/components/crm/kanban";
import { PersonSelect, StudioPick } from "@/components/crm/parts";
import { NONE } from "@/lib/crm/logic";
import { useCrmStudios } from "@/lib/crm/data";
import { CrmDealsPageSkeleton } from "@/components/page-skeletons";
import { TableToolbar, ToolbarReset, ToolbarSearch } from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckboxOption } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import {
  crmErrorText,
  crmPeopleQuery,
  crmSetupQuery,
  invalidateCrm,
  updateDeal,
  usePipelineDeals,
} from "@/lib/crm/data";
import { EMPTY_FILTER, filterDeals, groupByStage, nextTaskByDeal } from "@/lib/crm/logic";
import type { CrmDeal, CrmStage } from "@/lib/crm/types";

type Search = { pipeline?: string; deal?: string };

export const Route = createFileRoute("/_authenticated/crm/")({
  head: () => ({ meta: [{ title: "Сделки — CRM — Base40 Admin" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    pipeline: typeof s.pipeline === "string" ? s.pipeline : undefined,
    deal: typeof s.deal === "string" ? s.deal : undefined,
  }),
  pendingComponent: CrmDealsPageSkeleton,
  component: CrmDealsPage,
});

/**
 * «Сделки» — канбан воронки (CRM.md, этап 1). Воронка и открытая сделка — в
 * адресе (?pipeline=&deal=): ссылку на сделку можно отправить коллеге.
 */
function CrmDealsPage() {
  const qc = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const activeStudioId = useActiveStudioId();
  const { data: setup } = useQuery(crmSetupQuery);
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const { data: studios = [] } = useCrmStudios();
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [newStage, setNewStage] = useState<string | null>(null);
  const [losing, setLosing] = useState<{ deal: CrmDeal; stage: CrmStage } | null>(null);

  const pipelines = (setup?.pipelines ?? []).filter((p) => !p.is_archived);
  const pipelineId =
    (search.pipeline && pipelines.some((p) => p.id === search.pipeline) ? search.pipeline : null) ??
    pipelines[0]?.id ??
    null;
  const stages = useMemo(
    () => (setup?.stages ?? []).filter((s) => s.pipeline_id === pipelineId),
    [setup, pipelineId],
  );
  const { data, isLoading } = usePipelineDeals(pipelineId);

  const now = new Date();
  const nextTask = useMemo(() => nextTaskByDeal(data?.tasks ?? []), [data]);
  const visible = useMemo(
    () => filterDeals(data?.deals ?? [], filter, nextTask),
    [data, filter, nextTask],
  );
  const dealsByStage = useMemo(() => groupByStage(visible), [visible]);
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const studioNames = useMemo(() => new Map(studios.map((s) => [s.id, s.name])), [studios]);
  const filtered =
    filter.search !== "" || filter.responsible !== "" || filter.studio !== "" || filter.noTasks;

  const setSearch = (patch: Search) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const move = async (deal: CrmDeal, stage: CrmStage, lossReasonId?: string | null) => {
    try {
      await updateDeal(deal.id, {
        stage_id: stage.id,
        ...(stage.kind === "lost" ? { loss_reason_id: lossReasonId ?? null } : {}),
      });
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось перенести сделку"));
    }
  };

  return (
    <AdminShell
      title="Сделки"
      actions={
        pipelineId ? (
          <Button onClick={() => setNewStage(stages[0]?.id ?? "")}>
            <Plus />
            Новая сделка
          </Button>
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <TableToolbar>
          <ToolbarSearch
            value={filter.search}
            onChange={(v) => setFilter((f) => ({ ...f, search: v }))}
            placeholder="Сделка, имя, телефон, тег"
          />
          {pipelines.length > 1 && pipelineId && (
            <Select value={pipelineId} onValueChange={(v) => setSearch({ pipeline: v })}>
              <SelectTrigger aria-label="Воронка" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <PersonSelect
            className="w-52"
            allLabel="Все ответственные"
            noneLabel="Без ответственного"
            value={filter.responsible === NONE ? null : filter.responsible}
            onChange={(v) => setFilter((f) => ({ ...f, responsible: v === null ? NONE : v }))}
          />
          <StudioPick
            className="w-44"
            allLabel="Все клубы"
            studios={studios}
            value={filter.studio === NONE ? null : filter.studio}
            onChange={(v) => setFilter((f) => ({ ...f, studio: v === null ? NONE : v }))}
          />
          <CheckboxOption
            checked={filter.noTasks}
            onCheckedChange={(v) => setFilter((f) => ({ ...f, noTasks: v }))}
          >
            Без задач
          </CheckboxOption>
          <ToolbarReset active={filtered} onReset={() => setFilter(EMPTY_FILTER)} />
        </TableToolbar>

        {!setup || (isLoading && pipelineId) ? (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-96 w-72 shrink-0 rounded-lg" />
            ))}
          </div>
        ) : !pipelineId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Воронок нет. Заведите первую в{" "}
            <Link to="/crm/settings" className="text-link underline">
              настройках CRM
            </Link>
            .
          </div>
        ) : (
          <Kanban
            stages={stages}
            dealsByStage={dealsByStage}
            nextTask={nextTask}
            people={peopleMap}
            studioNames={studioNames}
            now={now}
            onOpen={(id) => setSearch({ deal: id })}
            onAdd={(stageId) => setNewStage(stageId)}
            onMove={(deal, stage) =>
              stage.kind === "lost" ? setLosing({ deal, stage }) : void move(deal, stage)
            }
          />
        )}
      </div>

      <Dialog open={newStage !== null} onOpenChange={(open) => !open && setNewStage(null)}>
        <DialogContent>
          {newStage !== null && pipelineId && (
            <DealForm
              key={`${pipelineId}-${newStage}`}
              pipelineId={pipelineId}
              stages={stages.filter((s) => s.kind === "open")}
              stageId={newStage || undefined}
              studios={studios}
              defaultStudioId={activeStudioId}
              onDone={(id) => {
                setNewStage(null);
                setSearch({ deal: id });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!losing} onOpenChange={(open) => !open && setLosing(null)}>
        <DialogContent className="sm:max-w-md">
          {losing && (
            <LossForm
              key={losing.deal.id}
              title={losing.deal.title}
              reasons={(setup?.lossReasons ?? []).filter((r) => r.is_active)}
              onPick={(reasonId) => {
                const { deal, stage } = losing;
                setLosing(null);
                void move(deal, stage, reasonId);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <DealDialog dealId={search.deal ?? null} onClose={() => setSearch({ deal: undefined })} />
    </AdminShell>
  );
}

/** Причина отказа при переносе сделки в «Не реализовано». */
function LossForm({
  title,
  reasons,
  onPick,
}: {
  title: string;
  reasons: { id: string; name: string }[];
  onPick: (reasonId: string | null) => void;
}) {
  const [reason, setReason] = useState<string>(NONE);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Сделка не реализована</DialogTitle>
        <DialogDescription>«{title}» — почему не купили?</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger aria-label="Причина отказа">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Причина не указана</SelectItem>
            {reasons.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DialogBody>
      <DialogFooter>
        <Button onClick={() => onPick(reason === NONE ? null : reason)}>Закрыть сделку</Button>
      </DialogFooter>
    </>
  );
}
