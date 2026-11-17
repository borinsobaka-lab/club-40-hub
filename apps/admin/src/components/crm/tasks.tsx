import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { PersonSelect, TaskDue } from "@/components/crm/parts";
import { StaffAvatar } from "@/components/employee-photo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addTask,
  crmErrorText,
  crmPeopleQuery,
  crmTaskTypesQuery,
  deleteTask,
  invalidateCrm,
  setTaskDone,
  isLastOpenTask,
  updateTask,
} from "@/lib/crm/data";
import { defaultTaskDue, DUE_PRESETS, presetDue } from "@/lib/crm/logic";
import type { CrmTask, CrmTaskType } from "@/lib/crm/types";
import { formatDateTime, toDateTimeLocalValue } from "@/lib/format";
import { cn } from "@/lib/utils";

const TIPS = {
  type: "Что нужно сделать: по типу задачи фильтруются в разделе «Задачи». Типы настраиваются в «Настройках» CRM.",
  title: "Пусто — задача называется как её тип: «Звонок», «Связаться».",
  assignee: "Кому задача. По умолчанию — ответственный сделки; можно поставить себе или коллеге.",
};

/** Тип задачи — цветной пилюлей. */
export function TaskTypeBadge({
  type,
  className,
}: {
  type: CrmTaskType | undefined;
  className?: string;
}) {
  if (!type) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium text-white",
        className,
      )}
      style={{ backgroundColor: type.color }}
    >
      {type.name}
    </span>
  );
}

/**
 * Окно задачи — новая (в сделке) или правка: тип, текст, срок с быстрыми
 * кнопками, исполнитель, комментарий. Содержимое DialogContent (с key).
 */
export function TaskForm({
  dealId,
  task,
  defaultAssigneeId,
  onDone,
  next,
}: {
  dealId: string;
  task: CrmTask | null;
  /**
   * «Следующая задача»: у сделки в работе задача обязательна — форма
   * открыта, потому что без новой задачи сделка осталась бы без задач.
   */
  next?: string;
  /** Новая задача: ответственный сделки (нет — ставящий). */
  defaultAssigneeId: string | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data: types = [] } = useQuery(crmTaskTypesQuery);
  const [typeId, setTypeId] = useState<string | null>(task?.type_id ?? null);
  const [title, setTitle] = useState(task?.title ?? "");
  const [due, setDue] = useState(() =>
    toDateTimeLocalValue(task ? new Date(task.due_at) : defaultTaskDue(new Date())),
  );
  const [assignee, setAssignee] = useState<string | null>(
    task ? task.assignee_id : defaultAssigneeId,
  );
  const [note, setNote] = useState(task?.note ?? "");
  const [saving, setSaving] = useState(false);
  const type = types.find((t) => t.id === typeId);

  const save = async () => {
    const text = title.trim() || type?.name || "";
    if (!text) {
      toast.error("Выберите тип или напишите, что нужно сделать");
      return;
    }
    if (!due || Number.isNaN(new Date(due).getTime())) {
      toast.error("Укажите дату и время");
      return;
    }
    setSaving(true);
    try {
      const input = {
        title: text,
        due_at: new Date(due).toISOString(),
        assignee_id: assignee,
        type_id: typeId,
        note: note.trim() || null,
      };
      if (task) await updateTask(task.id, input);
      else await addTask(dealId, input);
      await invalidateCrm(qc);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось сохранить задачу"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {next ? "Следующая задача" : task ? "Изменить задачу" : "Новая задача"}
        </DialogTitle>
        <DialogDescription>
          {next ??
            "Задача появится у исполнителя в разделе «Задачи» и на карточке сделки в воронке."}
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            {types.length > 0 && (
              <FormField label="Тип" tip={TIPS.type}>
                <div className="flex flex-wrap gap-1.5">
                  {types.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={typeId === t.id}
                      onClick={() => setTypeId(typeId === t.id ? null : t.id)}
                      className={cn(
                        "cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        typeId === t.id
                          ? "border-transparent text-white"
                          : "bg-background hover:bg-muted",
                      )}
                      style={typeId === t.id ? { backgroundColor: t.color } : undefined}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </FormField>
            )}
            <FormField label="Что сделать" tip={TIPS.title}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={type?.name ?? "Позвонить, напомнить о пробном…"}
                maxLength={500}
                autoFocus
              />
            </FormField>
            <FormField label="Когда" required>
              <div className="space-y-2">
                <Input
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  aria-label="Срок"
                  className="w-56"
                />
                <div className="flex flex-wrap gap-1.5">
                  {DUE_PRESETS.map((p) => (
                    <Button
                      key={p.key}
                      variant="outline"
                      size="xs"
                      onClick={() => setDue(toDateTimeLocalValue(presetDue(p.key, new Date())))}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
            </FormField>
            <FormField label="Исполнитель" tip={TIPS.assignee}>
              <PersonSelect
                value={assignee}
                onChange={setAssignee}
                aria-label="Исполнитель"
                noneLabel="Ответственный сделки"
              />
            </FormField>
            <FormField label="Комментарий" optional>
              <Textarea
                note
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                placeholder="Что важно знать исполнителю"
              />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {task ? "Сохранить" : "Поставить задачу"}
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

/**
 * Строка задачи: флажок открывает «Результат» (необязательный, уходит в
 * ленту сделки), карандаш — правка и перенос, корзина — удаление.
 * Выполненную можно вернуть в работу. `children` — вторая строка (сделка).
 */
export function TaskItem({
  task,
  now,
  showAssignee,
  onEdit,
  children,
}: {
  task: CrmTask;
  now: Date;
  /** Показать исполнителя (список не одного человека). */
  showAssignee?: boolean;
  onEdit: (task: CrmTask) => void;
  children?: ReactNode;
}) {
  const qc = useQueryClient();
  const { data: types = [] } = useQuery(crmTaskTypesQuery);
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [completing, setCompleting] = useState(false);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  // Последняя задача сделки в работе: сначала ставится следующая.
  const [next, setNext] = useState(false);
  const type = types.find((t) => t.id === task.type_id);
  const person = people.find((p) => p.id === task.assignee_id);
  const done = !!task.done_at;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group flex items-start gap-2.5 px-3 py-2">
      {done ? (
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm bg-emerald-600 text-white">
          <Check className="size-3" />
        </span>
      ) : (
        <Checkbox
          className="mt-0.5"
          checked={completing}
          disabled={busy}
          aria-label={`Выполнить: ${task.title}`}
          onCheckedChange={(v) => setCompleting(v === true)}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <TaskTypeBadge type={type} />
          <span className={cn("text-sm break-words", done && "text-muted-foreground line-through")}>
            {task.title}
          </span>
          {task.auto && <span className="text-[11px] text-muted-foreground">авто</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {done ? (
            <span className="text-xs text-muted-foreground">
              выполнена {formatDateTime(task.done_at)}
            </span>
          ) : (
            <TaskDue dueAt={task.due_at} now={now} />
          )}
          {showAssignee && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <StaffAvatar
                value={person?.avatar_url}
                name={person?.full_name ?? ""}
                className="size-4 text-[8px]"
              />
              {person?.full_name ?? "Без исполнителя"}
            </span>
          )}
        </div>
        {task.note && (
          <p className="mt-0.5 text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {task.note}
          </p>
        )}
        {done && task.result && (
          <p className="mt-0.5 text-xs break-words">Результат: {task.result}</p>
        )}
        {children}
        {completing && !done && (
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (await isLastOpenTask(task)) setNext(true);
                else await setTaskDone(task.id, true, result.trim() || null);
              });
            }}
          >
            <Input
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="Результат: что получилось (необязательно)"
              aria-label="Результат задачи"
              maxLength={2000}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                Выполнить
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCompleting(false)}>
                Отмена
              </Button>
            </div>
          </form>
        )}
      </div>
      <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        {done ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Вернуть в работу"
            title="Вернуть в работу"
            disabled={busy}
            onClick={() => void act(() => setTaskDone(task.id, false))}
          >
            <Undo2 />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Изменить или перенести"
            title="Изменить или перенести"
            onClick={() => onEdit(task)}
          >
            <Pencil />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Удалить задачу"
          title="Удалить задачу"
          disabled={busy}
          onClick={async () => {
            if (!done && (await isLastOpenTask(task))) {
              await confirm({
                title: "Это единственная задача сделки",
                description:
                  "У сделки в работе всегда должна быть задача. Поставьте новую или измените эту — потом её можно будет удалить.",
                confirmLabel: "Понятно",
                hideCancel: true,
              });
              return;
            }
            if (await confirm({ title: "Удалить задачу?", description: task.title }))
              await act(() => deleteTask(task.id));
          }}
        >
          <Trash2 />
        </Button>
      </div>
      {confirmDialog}
      <Dialog open={next} onOpenChange={setNext}>
        <DialogContent>
          {next && (
            <TaskForm
              dealId={task.deal_id}
              task={null}
              defaultAssigneeId={task.assignee_id}
              next="У сделки в работе всегда должна быть задача. Поставьте следующую — и эта будет отмечена выполненной."
              onDone={() => {
                setNext(false);
                void act(() => setTaskDone(task.id, true, result.trim() || null));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
