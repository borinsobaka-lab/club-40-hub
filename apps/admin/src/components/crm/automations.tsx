import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { PersonSelect, StageSelect } from "@/components/crm/parts";
import { StaffAvatar } from "@/components/employee-photo";
import { Button } from "@/components/ui/button";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckboxOption, FormField, InfoNote } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  crmAutomationsQuery,
  crmErrorText,
  crmPeopleQuery,
  crmTaskTypesQuery,
  invalidateCrm,
} from "@/lib/crm/data";
import {
  automationLabel,
  joinDuration,
  NONE,
  splitDuration,
  type DurationUnit,
} from "@/lib/crm/logic";
import type { AutomationAction, AutomationTrigger, CrmAutomation, CrmStage } from "@/lib/crm/types";

const TRIGGERS: { value: AutomationTrigger; label: string }[] = [
  { value: "enter", label: "Сделка вошла в этап" },
  { value: "inbound", label: "Клиент написал" },
  { value: "no_reply", label: "Клиент не ответил" },
  { value: "trial_sale", label: "Куплено пробное или разовое" },
  { value: "booked", label: "Клиент записан на занятие" },
  { value: "attended", label: "Клиент посетил занятие" },
];
const ACTIONS: { value: AutomationAction; label: string }[] = [
  { value: "task", label: "Поставить задачу" },
  { value: "responsible", label: "Назначить ответственного" },
  { value: "message", label: "Отправить сообщение клиенту" },
  { value: "move", label: "Перевести в другой этап" },
  { value: "tag", label: "Поставить тег" },
];
const UNITS: { value: DurationUnit; label: string }[] = [
  { value: "minutes", label: "минут" },
  { value: "hours", label: "часов" },
  { value: "days", label: "дней" },
];

function Duration({
  minutes,
  onChange,
  label,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  label: string;
}) {
  const init = splitDuration(minutes);
  const [value, setValue] = useState(String(init.value));
  const [unit, setUnit] = useState<DurationUnit>(init.unit);
  const update = (v: string, u: DurationUnit) => {
    setValue(v);
    setUnit(u);
    onChange(joinDuration(Number(v.replace(/\D/g, "")) || 0, u));
  };
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => update(e.target.value, unit)}
        inputMode="numeric"
        aria-label={label}
        className="w-24"
      />
      <Select value={unit} onValueChange={(u) => update(value, u as DurationUnit)}>
        <SelectTrigger aria-label="Единица времени" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u.value} value={u.value}>
              {u.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Автоматизации этапа (окно из «Настроек» CRM): список правил «когда → что
 * сделать» и форма правила. Исполняет их сервер (очередь в базе, раз в
 * несколько секунд); сделанное видно в ленте сделки.
 */
export function StageAutomations({ stage, stages }: { stage: CrmStage; stages: CrmStage[] }) {
  const qc = useQueryClient();
  const { data: all = [] } = useQuery(crmAutomationsQuery);
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<CrmAutomation | "new" | null>(null);
  const rules = all.filter((a) => a.stage_id === stage.id);
  const names = {
    stage: (id: string) => stages.find((s) => s.id === id)?.name ?? "удалён",
    person: (id: string) => people.find((p) => p.id === id)?.full_name ?? "без доступа",
  };

  const act = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await q;
    if (error) toast.error(crmErrorText(new Error(error.message)));
    await invalidateCrm(qc);
  };

  if (editing)
    return (
      <RuleForm
        key={editing === "new" ? "new" : editing.id}
        stage={stage}
        stages={stages}
        item={editing === "new" ? null : editing}
        nextOrder={rules.length + 1}
        onDone={() => setEditing(null)}
      />
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Автоматизации этапа «{stage.name}»</DialogTitle>
        <DialogDescription>
          Что происходит со сделкой в этом этапе без участия сотрудника.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-2">
          {rules.length === 0 && (
            <InfoNote variant="empty">
              Правил нет. Например: «Сразу при входе в этап → ответственный по очереди» или «Клиент
              не ответил 1 день → задача».
            </InfoNote>
          )}
          {rules.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <span
                className={
                  a.is_active
                    ? "min-w-0 flex-1 text-sm"
                    : "min-w-0 flex-1 text-sm text-muted-foreground"
                }
              >
                {automationLabel(a, names)}
              </span>
              <Switch
                checked={a.is_active}
                aria-label="Правило включено"
                onCheckedChange={(v) =>
                  void act(supabase.from("crm_automations").update({ is_active: v }).eq("id", a.id))
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Изменить правило"
                onClick={() => setEditing(a)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить правило"
                onClick={async () => {
                  if (await confirm({ title: "Удалить правило?" }))
                    await act(supabase.from("crm_automations").delete().eq("id", a.id));
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={() => setEditing("new")}>
          <Plus />
          Добавить правило
        </Button>
      </DialogFooter>
      {confirmDialog}
    </>
  );
}

function RuleForm({
  stage,
  stages,
  item,
  nextOrder,
  onDone,
}: {
  stage: CrmStage;
  stages: CrmStage[];
  item: CrmAutomation | null;
  nextOrder: number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const others = stages.filter((s) => s.id !== stage.id);
  const [trigger, setTrigger] = useState<AutomationTrigger>(item?.trigger ?? "enter");
  const [delay, setDelay] = useState(item?.delay_minutes ?? 0);
  const [action, setAction] = useState<AutomationAction>(item?.action ?? "task");
  const [title, setTitle] = useState(item?.params.title ?? "");
  const [due, setDue] = useState(item?.params.due_minutes ?? 60);
  const { data: taskTypes = [] } = useQuery(crmTaskTypesQuery);
  const [taskType, setTaskType] = useState(item?.params.type_id ?? NONE);
  // null — ответственный сделки.
  const [taskFor, setTaskFor] = useState<string | null>(
    item?.params.assignee && item.params.assignee !== "responsible" ? item.params.assignee : null,
  );
  const [users, setUsers] = useState<string[]>(item?.params.user_ids ?? []);
  const [moveTo, setMoveTo] = useState(item?.params.stage_id ?? others[0]?.id ?? "");
  const [body, setBody] = useState(item?.params.body ?? "");
  const [tag, setTag] = useState(item?.params.tag ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const params =
      action === "task"
        ? {
            title,
            due_minutes: due,
            assignee: taskFor ?? "responsible",
            type_id: taskType === NONE ? null : taskType,
          }
        : action === "responsible"
          ? { user_ids: users }
          : action === "move"
            ? { stage_id: moveTo }
            : action === "message"
              ? { body }
              : { tag };
    setSaving(true);
    try {
      const row = {
        trigger,
        delay_minutes:
          trigger === "inbound" ? 0 : trigger === "no_reply" ? Math.max(1, delay) : delay,
        action,
        params,
      };
      const { error } = item
        ? await supabase.from("crm_automations").update(row).eq("id", item.id)
        : await supabase
            .from("crm_automations")
            .insert({ ...row, stage_id: stage.id, sort_order: nextOrder });
      if (error) throw new Error(error.message);
      await invalidateCrm(qc);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Изменить правило" : "Новое правило"}</DialogTitle>
        <DialogDescription>Этап «{stage.name}»</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Когда" required>
              <Select value={trigger} onValueChange={(v) => setTrigger(v as AutomationTrigger)}>
                <SelectTrigger aria-label="Когда">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {(trigger === "trial_sale" || trigger === "booked" || trigger === "attended") && (
              <InfoNote>
                Событие портала: срабатывает у сделок, контакт которых привязан к карточке клиента.
                Покупка абонемента (не пробного) закрывает сделку «Успешно» сама, без правила.
              </InfoNote>
            )}
            {trigger !== "inbound" && trigger !== "no_reply" && (
              <FormField
                label="Через сколько"
                hint="0 — сразу. Если сделка уйдёт из этапа раньше, правило не сработает."
              >
                <Duration minutes={delay} onChange={setDelay} label="Через сколько" />
              </FormField>
            )}
            {trigger === "no_reply" && (
              <FormField
                label="Сколько ждать ответа"
                required
                hint="Считается от последнего сообщения сотрудника. Клиент ответил — правило не сработает."
              >
                <Duration
                  minutes={delay || 1440}
                  onChange={setDelay}
                  label="Сколько ждать ответа"
                />
              </FormField>
            )}
            {trigger === "inbound" && (
              <InfoNote>
                Срабатывает на каждое сообщение клиента, пока сделка в этом этапе (кроме самого
                первого — оно создаёт сделку).
              </InfoNote>
            )}

            <FormField label="Что сделать" required>
              <Select value={action} onValueChange={(v) => setAction(v as AutomationAction)}>
                <SelectTrigger aria-label="Что сделать">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {action === "task" && (
              <>
                <FormField
                  label="Текст задачи"
                  required
                  hint="Можно написать {имя} — подставится имя контакта."
                >
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Связаться с клиентом"
                    maxLength={500}
                  />
                </FormField>
                <FormField label="Срок задачи" hint="От момента, когда задача поставлена.">
                  <Duration minutes={due} onChange={setDue} label="Срок задачи" />
                </FormField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Тип задачи">
                    <Select value={taskType} onValueChange={setTaskType}>
                      <SelectTrigger aria-label="Тип задачи">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Без типа</SelectItem>
                        {taskTypes.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Кому">
                    <PersonSelect
                      value={taskFor}
                      onChange={setTaskFor}
                      aria-label="Кому задача"
                      noneLabel="Ответственному сделки"
                    />
                  </FormField>
                </div>
              </>
            )}
            {action === "responsible" && (
              <FormField
                label="Сотрудники"
                required
                hint="Один — сделки получает он. Несколько — по очереди: первая сделка первому, вторая второму и так по кругу. Сделку, у которой ответственный уже есть, правило не трогает."
              >
                <div className="space-y-2 rounded-md border p-3">
                  {people.map((p) => (
                    <CheckboxOption
                      key={p.id}
                      checked={users.includes(p.id)}
                      onCheckedChange={(v) =>
                        setUsers((u) => (v ? [...u, p.id] : u.filter((id) => id !== p.id)))
                      }
                    >
                      <span className="flex items-center gap-2">
                        <StaffAvatar
                          value={p.avatar_url}
                          name={p.full_name ?? ""}
                          className="size-5 text-[10px]"
                        />
                        {p.full_name ?? "Без имени"}
                        {users.includes(p.id) && users.length > 1 && (
                          <span className="text-xs text-muted-foreground">
                            № {users.indexOf(p.id) + 1}
                          </span>
                        )}
                      </span>
                    </CheckboxOption>
                  ))}
                  {people.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Нет сотрудников с доступом к CRM.
                    </p>
                  )}
                </div>
              </FormField>
            )}
            {action === "message" && (
              <FormField
                label="Текст сообщения"
                required
                hint="Уходит в последний диалог контакта. {имя} — имя контакта, {клуб} — клуб сделки."
              >
                <Textarea
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={4000}
                  placeholder="Здравствуйте, {имя}! …"
                />
              </FormField>
            )}
            {action === "move" && (
              <FormField label="В какой этап" required>
                <StageSelect stages={others} value={moveTo} onChange={setMoveTo} />
              </FormField>
            )}
            {action === "tag" && (
              <FormField label="Тег" required>
                <Input
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="не отвечает"
                  maxLength={60}
                />
              </FormField>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Назад
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
