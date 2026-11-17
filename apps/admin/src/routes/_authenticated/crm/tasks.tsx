import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AdminShell } from "@/components/admin-shell";
import { DealDialog } from "@/components/crm/deal-dialog";
import { StageDot } from "@/components/crm/parts";
import { TaskForm, TaskItem } from "@/components/crm/tasks";
import { StaffAvatar } from "@/components/employee-photo";
import { CrmTasksPageSkeleton } from "@/components/page-skeletons";
import { CardSkeleton } from "@/components/skeletons";
import { TableToolbar, ToolbarReset } from "@/components/table-toolbar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { crmPeopleQuery, crmTaskTypesQuery, useCrmStudios, useTasksList } from "@/lib/crm/data";
import { TASK_GROUP_LABEL, taskGroup, type TaskGroup } from "@/lib/crm/logic";
import type { CrmTaskRow } from "@/lib/crm/types";

export const Route = createFileRoute("/_authenticated/crm/tasks")({
  head: () => ({ meta: [{ title: "Задачи — CRM — Base40 Admin" }] }),
  pendingComponent: CrmTasksPageSkeleton,
  component: CrmTasksPage,
});

const GROUPS: TaskGroup[] = ["overdue", "today", "tomorrow", "later"];
const ALL = "all";
const ME = "me";

/**
 * «Задачи» — задачи по сделкам. По умолчанию свои невыполненные: просроченные
 * и ближайшие сверху, у каждой — сделка, контакт и этап (нажатие открывает
 * сделку). Фильтры: чьи (я, все, конкретный сотрудник), тип, «В работе /
 * Выполненные» (за 30 дней). Ставятся задачи в карточке сделки и правилами
 * этапов; здесь их выполняют, переносят и передают.
 */
function CrmTasksPage() {
  const { data: me } = useStaffProfile();
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const { data: types = [] } = useQuery(crmTaskTypesQuery);
  const { data: studios = [] } = useCrmStudios();
  const [who, setWho] = useState<string>(ME);
  const [typeId, setTypeId] = useState<string>(ALL);
  const [view, setView] = useState<"open" | "done">("open");
  const [dealId, setDealId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CrmTaskRow | null>(null);

  const assigneeId = who === ALL ? null : who === ME ? (me?.id ?? null) : who;
  const { data: tasks, isLoading } = useTasksList({
    assigneeId,
    typeId: typeId === ALL ? null : typeId,
    done: view === "done",
  });
  const waitingForMe = who === ME && !me;
  const now = new Date();
  const list = tasks ?? [];
  const filtered = who !== ME || typeId !== ALL;

  const row = (t: CrmTaskRow) => (
    <TaskItem key={t.id} task={t} now={now} showAssignee={who === ALL} onEdit={() => setEditing(t)}>
      <button
        type="button"
        onClick={() => setDealId(t.deal_id)}
        className="mt-1 flex max-w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 text-left text-xs text-link hover:underline"
      >
        <span className="truncate font-medium">{t.deal_title}</span>
        {t.contact_name && t.contact_name !== t.deal_title && (
          <span className="truncate text-muted-foreground">{t.contact_name}</span>
        )}
        <span className="flex items-center gap-1 text-muted-foreground">
          <StageDot color={t.stage_color} className="size-2" />
          {t.stage_name}
        </span>
        {t.studio_id && (
          <span className="text-muted-foreground">
            {studios.find((s) => s.id === t.studio_id)?.name}
          </span>
        )}
      </button>
    </TaskItem>
  );

  return (
    <AdminShell title="Задачи">
      <div className="mx-auto max-w-3xl space-y-3">
        <TableToolbar>
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger aria-label="Чьи задачи" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ME}>Мои задачи</SelectItem>
              <SelectItem value={ALL}>Все сотрудники</SelectItem>
              {people
                .filter((p) => p.id !== me?.id)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id} textValue={p.full_name ?? "Без имени"}>
                    <span className="flex items-center gap-2">
                      <StaffAvatar
                        value={p.avatar_url}
                        name={p.full_name ?? ""}
                        className="size-5 text-[10px]"
                      />
                      {p.full_name ?? "Без имени"}
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {types.length > 0 && (
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger aria-label="Тип задачи" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все типы</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <SegmentedControl
            aria-label="В работе или выполненные"
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: "В работе" },
              { value: "done", label: "Выполненные" },
            ]}
          />
          <ToolbarReset
            active={filtered}
            onReset={() => {
              setWho(ME);
              setTypeId(ALL);
            }}
          />
        </TableToolbar>

        {isLoading || waitingForMe ? (
          <CardSkeleton rows={5} />
        ) : list.length === 0 ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            {view === "done"
              ? "За последние 30 дней выполненных задач нет."
              : "Задач нет. Задачи ставятся в карточке сделки и правилами этапов воронки."}
          </div>
        ) : view === "done" ? (
          <section className="divide-y rounded-lg border bg-background">{list.map(row)}</section>
        ) : (
          GROUPS.map((g) => {
            const items = list.filter((t) => taskGroup(t.due_at, now) === g);
            if (items.length === 0) return null;
            return (
              <section key={g} className="rounded-lg border bg-background">
                <h2
                  className={
                    g === "overdue"
                      ? "border-b bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive"
                      : "border-b bg-muted/50 px-4 py-2 text-sm font-semibold"
                  }
                >
                  {TASK_GROUP_LABEL[g]} · {items.length}
                </h2>
                <div className="divide-y">{items.map(row)}</div>
              </section>
            );
          })
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <TaskForm
              key={editing.id}
              dealId={editing.deal_id}
              task={editing}
              defaultAssigneeId={editing.assignee_id}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <DealDialog dealId={dealId} onClose={() => setDealId(null)} />
    </AdminShell>
  );
}
