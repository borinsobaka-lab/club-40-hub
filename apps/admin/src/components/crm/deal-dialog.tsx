import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { ClientCombobox } from "@/components/client-combobox";
import { ClientNameLink } from "@/components/client-name-link";
import { useConfirm } from "@/components/confirm-dialog";
import { ChatThread } from "@/components/crm/chat";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { hasRight } from "@/lib/admin-access";
import {
  addNote,
  addTask,
  mergeContacts,
  searchContacts,
  useContactIdentities,
  crmAccountsQuery,
  useContactConversations,
  crmErrorText,
  crmSetupQuery,
  deleteDeal,
  deleteNote,
  deleteTask,
  invalidateCrm,
  setTaskDone,
  updateContact,
  updateDeal,
  updateNote,
  useDeal,
  type DealPatch,
} from "@/lib/crm/data";
import {
  accountLabel,
  CHANNEL_LABEL,
  defaultTaskDue,
  eventText,
  parseBudget,
  parseTags,
} from "@/lib/crm/logic";
import type { CrmContact, CrmDeal, CrmEvent, CrmTask } from "@/lib/crm/types";
import { formatDateTime, formatPhone, toDateTimeLocalValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PersonSelect, StageSelect, StudioPick, TaskDue } from "./parts";
import { NONE } from "@/lib/crm/logic";
import { useCrmStudios } from "@/lib/crm/data";

/**
 * Карточка сделки (как в amoCRM): слева — сделка, контакт и клиент портала,
 * справа — задачи и лента (комментарии сотрудников и события), внизу поле
 * комментария. Поля сохраняются сразу — по выбору или уходу из поля.
 * Переписка в мессенджерах появится в этой же ленте (этапы 2+, CRM.md).
 */
export function DealDialog({ dealId, onClose }: { dealId: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!dealId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92dvh] max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {dealId && <DealCard key={dealId} dealId={dealId} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function DealCard({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const access = useAdminAccess();
  const { data, isLoading } = useDeal(dealId);
  const { data: setup } = useQuery(crmSetupQuery);
  const { data: studios = [] } = useCrmStudios();
  const { confirm, confirmDialog } = useConfirm();
  const canManage = hasRight(access, "crm.manage");

  const deal = data?.deal ?? null;

  const patch = async (p: DealPatch) => {
    try {
      await updateDeal(dealId, p);
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e));
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: "Удалить сделку?",
        description: "Сделка, её комментарии и задачи удалятся. Контакт останется.",
      }))
    )
      return;
    try {
      await deleteDeal(dealId);
      await invalidateCrm(qc);
      toast.success("Сделка удалена");
      onClose();
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось удалить"));
    }
  };

  if (isLoading || !setup)
    return (
      <div className="space-y-3 p-6">
        <DialogTitle className="sr-only">Сделка</DialogTitle>
        <DialogDescription className="sr-only">Загрузка</DialogDescription>
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!deal)
    return (
      <div className="p-6">
        <DialogTitle>Сделка не найдена</DialogTitle>
        <DialogDescription>
          Её удалили, или она относится к клубу, который вам не открыт.
        </DialogDescription>
      </div>
    );

  const stages = setup.stages.filter((s) => s.pipeline_id === deal.pipeline_id);
  const stage = stages.find((s) => s.id === deal.stage_id);

  return (
    <>
      <div className="border-b px-4 py-3 pr-12 sm:px-6">
        <DialogTitle asChild>
          <div>
            <InlineText
              value={deal.title}
              aria-label="Название сделки"
              className="h-9 border-transparent bg-transparent px-1 text-lg! font-semibold shadow-none hover:border-input"
              onSave={(v) => (v ? patch({ title: v }) : undefined)}
            />
          </div>
        </DialogTitle>
        <DialogDescription className="px-1">
          Создана {formatDateTime(deal.created_at)}
          {deal.closed_at ? ` · закрыта ${formatDateTime(deal.closed_at)}` : ""}
        </DialogDescription>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[20rem_1fr] md:overflow-hidden">
        {/* Слева: сделка и контакт */}
        <div className="space-y-4 border-b p-4 md:overflow-y-auto md:border-r md:border-b-0 sm:p-5">
          <Row label="Воронка">
            <Select
              value={deal.pipeline_id}
              onValueChange={(v) => {
                const first = setup.stages.find((s) => s.pipeline_id === v);
                if (first) void patch({ pipeline_id: v, stage_id: first.id });
              }}
            >
              <SelectTrigger aria-label="Воронка">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {setup.pipelines
                  .filter((p) => !p.is_archived || p.id === deal.pipeline_id)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Этап">
            <StageSelect
              stages={stages}
              value={deal.stage_id}
              onChange={(v) => void patch({ stage_id: v })}
            />
          </Row>
          {stage?.kind === "lost" && (
            <Row label="Причина отказа">
              <Select
                value={deal.loss_reason_id ?? NONE}
                onValueChange={(v) => void patch({ loss_reason_id: v === NONE ? null : v })}
              >
                <SelectTrigger aria-label="Причина отказа">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Не указана</SelectItem>
                  {setup.lossReasons
                    .filter((r) => r.is_active || r.id === deal.loss_reason_id)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Row>
          )}
          <Row label="Ответственный">
            <PersonSelect
              value={deal.responsible_id}
              onChange={(v) => void patch({ responsible_id: v })}
            />
          </Row>
          <Row label="Клуб">
            <StudioPick
              value={deal.studio_id}
              onChange={(v) => void patch({ studio_id: v })}
              studios={studios}
            />
          </Row>
          <Row label="Бюджет, ₾">
            <InlineText
              value={deal.budget === null ? "" : String(deal.budget)}
              aria-label="Бюджет"
              inputMode="decimal"
              placeholder="Не указан"
              onSave={(v) => {
                const n = parseBudget(v);
                if (n === undefined) {
                  toast.error("Бюджет — неотрицательное число");
                  return false;
                }
                return patch({ budget: n });
              }}
            />
          </Row>
          <Row label="Источник">
            <InlineText
              value={deal.source ?? ""}
              aria-label="Источник"
              placeholder="Не указан"
              onSave={(v) => patch({ source: v || null })}
            />
          </Row>
          <Row label="Теги">
            <InlineText
              value={deal.tags.join(", ")}
              aria-label="Теги"
              placeholder="Через запятую"
              onSave={(v) => patch({ tags: parseTags(v) })}
            />
          </Row>

          <ContactBlock deal={deal} />

          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => void remove()}
            >
              <Trash2 />
              Удалить сделку
            </Button>
          )}
        </div>

        {/* Справа: задачи и лента или переписка */}
        <RightPane
          deal={deal}
          studioName={studios.find((s) => s.id === deal.studio_id)?.name}
          feed={
            <>
              <div className="flex-1 space-y-4 p-4 md:overflow-y-auto sm:p-5">
                <Tasks
                  dealId={dealId}
                  tasks={data?.tasks ?? []}
                  responsibleId={deal.responsible_id}
                />
                <Timeline events={data?.events ?? []} />
              </div>
              <NoteInput dealId={dealId} />
            </>
          }
        />
      </div>
      {confirmDialog}
    </>
  );
}

/**
 * Правая часть карточки: «Лента» (задачи, комментарии, события) и переписка
 * с контактом — вкладка на каждый его диалог, подписанная аккаунтом, в
 * который он пишет. Пришло непрочитанное — карточка открывается на нём.
 */
function RightPane({
  deal,
  studioName,
  feed,
}: {
  deal: CrmDeal;
  studioName: string | undefined;
  feed: ReactNode;
}) {
  const { data: conversations = [] } = useContactConversations(deal.contact_id);
  const { data: accounts = [] } = useQuery(crmAccountsQuery);
  const [picked, setPicked] = useState<string | null>(null);
  const unread = conversations.find((c) => c.unread_count > 0)?.id;
  const tab = picked ?? unread ?? "feed";
  const conversation = conversations.find((c) => c.id === tab);
  const account = accounts.find((a) => a.id === conversation?.account_id);

  return (
    <div className="flex min-h-0 flex-col max-md:min-h-[70dvh]">
      {conversations.length > 0 && (
        <div className="overflow-x-auto border-b px-4 py-2 sm:px-5">
          <SegmentedControl
            aria-label="Лента или переписка"
            value={conversation ? tab : "feed"}
            onChange={setPicked}
            options={[
              { value: "feed", label: "Лента" },
              ...conversations.map((c) => ({
                value: c.id,
                label: accountLabel(accounts.find((a) => a.id === c.account_id)),
                dot: c.unread_count > 0 ? "есть непрочитанные" : undefined,
              })),
            ]}
          />
        </div>
      )}
      {conversation ? (
        <ChatThread
          key={conversation.id}
          conversationId={conversation.id}
          contactName={deal.contact?.name}
          studioName={studioName}
          disabledReason={
            account?.status === "disabled" ? "Аккаунт канала отключён — ответить нельзя." : null
          }
        />
      ) : (
        feed
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/** Поле, которое сохраняется по Enter и уходу из него; Esc — вернуть прежнее. */
function InlineText({
  value,
  onSave,
  className,
  ...props
}: {
  value: string;
  /** false — значение не принято: поле остаётся с введённым. */
  onSave: (value: string) => void | false | Promise<void> | undefined;
  className?: string;
  placeholder?: string;
  inputMode?: "decimal" | "tel" | "email";
  "aria-label": string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next !== value.trim() && onSave(next) === false) return;
    setDraft(null);
  };
  return (
    <Input
      {...props}
      className={className}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape" && draft !== null) {
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

function ContactBlock({ deal }: { deal: CrmDeal }) {
  const qc = useQueryClient();
  const studioId = useActiveStudioId();
  const [linking, setLinking] = useState(false);
  const contact = deal.contact;

  const save = async (p: Partial<Pick<CrmContact, "name" | "phone" | "email" | "client_id">>) => {
    if (!contact) return;
    try {
      await updateContact(contact.id, p);
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e));
    }
  };

  if (!contact)
    return (
      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        У сделки нет контакта.
      </div>
    );

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Контакт
      </div>
      <Row label="Имя">
        <InlineText
          value={contact.name}
          aria-label="Имя контакта"
          onSave={(v) => (v ? save({ name: v }) : false)}
        />
      </Row>
      <Row label="Телефон">
        <InlineText
          value={contact.phone ? formatPhone(contact.phone) : ""}
          aria-label="Телефон контакта"
          inputMode="tel"
          placeholder="Не указан"
          onSave={(v) => save({ phone: v || null })}
        />
      </Row>
      <Row label="Почта">
        <InlineText
          value={contact.email ?? ""}
          aria-label="Почта контакта"
          inputMode="email"
          placeholder="Не указана"
          onSave={(v) => save({ email: v || null })}
        />
      </Row>
      <ContactChannels contactId={contact.id} />
      <div className="border-t pt-3">
        <div className="mb-1 text-xs text-muted-foreground">Клиент клуба</div>
        {contact.client_id ? (
          <div className="flex items-center justify-between gap-2">
            <ClientNameLink clientId={contact.client_id}>Открыть карточку клиента</ClientNameLink>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Отвязать от клиента"
              title="Отвязать от клиента"
              onClick={() => void save({ client_id: null })}
            >
              <X />
            </Button>
          </div>
        ) : linking ? (
          <ClientCombobox
            studioId={studioId}
            value=""
            creatable
            placeholder="Найти клиента"
            onChange={(id) => {
              setLinking(false);
              if (id) void save({ client_id: id });
            }}
          />
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Ещё не клиент: карточки с таким телефоном или почтой нет.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLinking(true)}
              disabled={!studioId}
            >
              Привязать к клиенту
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Каналы контакта и «Объединить» — дубль того же человека из другого канала. */
function ContactChannels({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const { data: identities = [] } = useContactIdentities(contactId);
  const { confirm, confirmDialog } = useConfirm();
  const [merging, setMerging] = useState(false);
  const [query, setQuery] = useState("");
  const term = query.trim();
  const { data: matches = [], isFetching } = useQuery({
    queryKey: ["crm", "contact-search", contactId, term],
    queryFn: () => searchContacts(term, contactId),
    enabled: merging && term.length >= 2,
    staleTime: 10_000,
  });

  const merge = async (other: { id: string; name: string }) => {
    if (
      !(await confirm({
        title: `Объединить с контактом «${other.name}»?`,
        description:
          "Его каналы, диалоги и сделки перейдут к этому контакту, а сам он удалится. Отменить объединение нельзя.",
        confirmLabel: "Объединить",
      }))
    )
      return;
    try {
      await mergeContacts(contactId, other.id);
      setMerging(false);
      setQuery("");
      await invalidateCrm(qc);
      toast.success("Контакты объединены");
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось объединить"));
    }
  };

  return (
    <div className="space-y-2">
      {identities.length > 0 && (
        <Row label="Каналы">
          <div className="flex flex-wrap gap-1">
            {identities.map((i) => (
              <span
                key={i.id}
                className="rounded-full bg-background px-2 py-0.5 text-xs ring-1 ring-border"
              >
                {CHANNEL_LABEL[i.channel === "telegram" ? "telegram_user" : i.channel] ?? i.channel}
                {i.username ? ` @${i.username}` : ""}
              </span>
            ))}
          </div>
        </Row>
      )}
      {merging ? (
        <div className="space-y-1.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя, телефон или @ник дубля"
            aria-label="Найти контакт для объединения"
            autoFocus
          />
          {term.length >= 2 &&
            (matches.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {isFetching ? "Поиск…" : "Никого не нашли."}
              </p>
            ) : (
              matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void merge(m)}
                  className="block w-full cursor-pointer rounded-md border bg-background px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      m.phone ? formatPhone(m.phone) : null,
                      m.email,
                      ...m.channels,
                      `сделок: ${m.deals}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))
            ))}
          <Button variant="ghost" size="xs" onClick={() => setMerging(false)}>
            Отмена
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="xs" className="-ml-2" onClick={() => setMerging(true)}>
          Объединить с дублем…
        </Button>
      )}
      {confirmDialog}
    </div>
  );
}

function Tasks({
  dealId,
  tasks,
  responsibleId,
}: {
  dealId: string;
  tasks: CrmTask[];
  responsibleId: string | null;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(() => toDateTimeLocalValue(defaultTaskDue(new Date())));
  const [assignee, setAssignee] = useState<string | null>(responsibleId);
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const open = tasks.filter((t) => !t.done_at);

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e));
    }
  };

  const add = async () => {
    if (!title.trim()) {
      toast.error("Напишите, что нужно сделать");
      return;
    }
    if (!due) {
      toast.error("Укажите срок");
      return;
    }
    setSaving(true);
    await act(() =>
      addTask({
        deal_id: dealId,
        title: title.trim(),
        due_at: new Date(due).toISOString(),
        assignee_id: assignee,
      }),
    );
    setSaving(false);
    setTitle("");
    setAdding(false);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Задачи{open.length ? ` · ${open.length}` : ""}</h3>
        {!adding && (
          <Button variant="outline" size="xs" onClick={() => setAdding(true)}>
            <Plus />
            Задача
          </Button>
        )}
      </div>
      {open.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          Задач нет — поставьте следующую, чтобы сделка не потерялась.
        </p>
      )}
      {open.map((t) => (
        <div
          key={t.id}
          className="group flex items-start gap-2 rounded-md border bg-background px-3 py-2"
        >
          <Checkbox
            className="mt-0.5"
            aria-label={`Выполнить: ${t.title}`}
            onCheckedChange={() => void act(() => setTaskDone(t.id, true))}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm">{t.title}</div>
            <TaskDue dueAt={t.due_at} now={now} />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
            aria-label="Удалить задачу"
            onClick={() => void act(() => deleteTask(t.id))}
          >
            <X />
          </Button>
        </div>
      ))}
      {adding && (
        <form
          className="space-y-2 rounded-md border bg-background p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Позвонить, напомнить о пробном…"
            aria-label="Что сделать"
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Срок"
              className="w-52"
            />
            <PersonSelect
              value={assignee}
              onChange={setAssignee}
              className="w-52"
              aria-label="Исполнитель"
            />
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Отмена
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                Поставить
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function Timeline({ events }: { events: CrmEvent[] }) {
  const qc = useQueryClient();
  const { data: me } = useStaffProfile();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.body.trim()) {
      toast.error("Комментарий пуст");
      return;
    }
    try {
      await updateNote(editing.id, editing.body.trim());
      setEditing(null);
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e));
    }
  };
  const remove = async (id: string) => {
    if (!(await confirm({ title: "Удалить комментарий?" }))) return;
    try {
      await deleteNote(id);
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось удалить"));
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Лента</h3>
      {events.map((e) =>
        e.kind === "note" ? (
          <div key={e.id} className="group rounded-md border border-note-border bg-note px-3 py-2">
            <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{e.author_name ?? "Сотрудник"}</span>
              <span>{formatDateTime(e.created_at)}</span>
              {e.edited_at && <span>изменён</span>}
              {e.author_id === me?.id && editing?.id !== e.id && (
                <span className="ml-auto flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Изменить комментарий"
                    onClick={() => setEditing({ id: e.id, body: e.body ?? "" })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Удалить комментарий"
                    onClick={() => void remove(e.id)}
                  >
                    <Trash2 />
                  </Button>
                </span>
              )}
            </div>
            {editing?.id === e.id ? (
              <div className="space-y-2">
                <Textarea
                  note
                  rows={3}
                  value={editing.body}
                  onChange={(ev) => setEditing({ id: e.id, body: ev.target.value })}
                  aria-label="Комментарий"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Отмена
                  </Button>
                  <Button size="sm" onClick={() => void saveEdit()}>
                    <Check />
                    Сохранить
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm break-words whitespace-pre-wrap">{e.body}</p>
            )}
          </div>
        ) : (
          <div
            key={e.id}
            className={cn("flex flex-wrap gap-x-2 px-1 text-xs text-muted-foreground")}
          >
            <span>{formatDateTime(e.created_at)}</span>
            <span className="text-foreground/80">{eventText(e)}</span>
            {e.author_name && <span>· {e.author_name}</span>}
          </div>
        ),
      )}
      {confirmDialog}
    </section>
  );
}

function NoteInput({ dealId }: { dealId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const send = async () => {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      await addNote(dealId, body.trim());
      setBody("");
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось сохранить комментарий"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-end gap-2 border-t bg-background p-3 sm:px-5">
      <Textarea
        note
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder="Комментарий по сделке — видят сотрудники. Ctrl+Enter — отправить"
        aria-label="Комментарий по сделке"
        className="min-h-0 flex-1"
      />
      <Button
        size="icon"
        aria-label="Добавить комментарий"
        disabled={!body.trim() || saving}
        onClick={() => void send()}
      >
        {saving ? <Loader2 className="animate-spin" /> : <Send />}
      </Button>
    </div>
  );
}
