import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { DealDialog } from "@/components/crm/deal-dialog";
import { TaskDue } from "@/components/crm/parts";
import { CrmTasksPageSkeleton } from "@/components/page-skeletons";
import { CardSkeleton } from "@/components/skeletons";
import { TableToolbar } from "@/components/table-toolbar";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { crmErrorText, invalidateCrm, setTaskDone, useOpenTasks } from "@/lib/crm/data";
import { taskState, type TaskState } from "@/lib/crm/logic";
import type { CrmTaskWithDeal } from "@/lib/crm/types";

export const Route = createFileRoute("/_authenticated/crm/tasks")({
  head: () => ({ meta: [{ title: "Задачи — CRM — Base40 Admin" }] }),
  pendingComponent: CrmTasksPageSkeleton,
  component: CrmTasksPage,
});

const GROUPS: { state: TaskState; title: string }[] = [
  { state: "overdue", title: "Просрочено" },
  { state: "today", title: "Сегодня" },
  { state: "future", title: "Позже" },
];

/** «Задачи» — невыполненные задачи по сделкам: свои или всех сотрудников. */
function CrmTasksPage() {
  const qc = useQueryClient();
  const { data: me } = useStaffProfile();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const { data: tasks, isLoading } = useOpenTasks(scope === "mine" ? (me?.id ?? null) : null);
  const [dealId, setDealId] = useState<string | null>(null);
  const now = new Date();

  const done = async (id: string) => {
    try {
      await setTaskDone(id, true);
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e));
    }
  };

  const byState = (state: TaskState) =>
    (tasks ?? []).filter((t) => taskState(t.due_at, now) === state);

  return (
    <AdminShell title="Задачи">
      <div className="mx-auto max-w-3xl space-y-3">
        <TableToolbar>
          <SegmentedControl
            aria-label="Чьи задачи"
            value={scope}
            onChange={setScope}
            options={[
              { value: "mine", label: "Мои" },
              { value: "all", label: "Все" },
            ]}
          />
        </TableToolbar>
        {isLoading || (scope === "mine" && !me) ? (
          <CardSkeleton rows={5} />
        ) : (tasks ?? []).length === 0 ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Задач нет. Задачи ставятся в карточке сделки.
          </div>
        ) : (
          GROUPS.map(({ state, title }) => {
            const list = byState(state);
            if (list.length === 0) return null;
            return (
              <section key={state} className="rounded-lg border bg-background">
                <h2 className="border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
                  {title} · {list.length}
                </h2>
                <ul className="divide-y">
                  {list.map((t) => (
                    <TaskRow key={t.id} task={t} now={now} onDone={done} onOpen={setDealId} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
      <DealDialog dealId={dealId} onClose={() => setDealId(null)} />
    </AdminShell>
  );
}

function TaskRow({
  task,
  now,
  onDone,
  onOpen,
}: {
  task: CrmTaskWithDeal;
  now: Date;
  onDone: (id: string) => void;
  onOpen: (dealId: string) => void;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <Checkbox
        className="mt-0.5"
        aria-label={`Выполнить: ${task.title}`}
        onCheckedChange={() => onDone(task.id)}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm">{task.title}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <TaskDue dueAt={task.due_at} now={now} />
          {task.deal && (
            <button
              type="button"
              className="cursor-pointer truncate text-xs text-link hover:underline"
              onClick={() => onOpen(task.deal!.id)}
            >
              {task.deal.title}
              {task.deal.contact && task.deal.contact.name !== task.deal.title
                ? ` · ${task.deal.contact.name}`
                : ""}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
