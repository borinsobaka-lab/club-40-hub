/**
 * CRM — загрузка и запись (React Query, таблицы crm_* и RPC,
 * db/migrations/2026-11-17_zzz_crm_core.sql). Ключи — ["crm", …]; после
 * записи — invalidateCrm. Что видит сотрудник, решает RLS: сделки своих
 * клубов и без клуба (crm.view), всех клубов (crm.manage).
 */
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { sortStages } from "./logic";
import type {
  CrmAutomation,
  CrmChannelAccount,
  CrmConversation,
  CrmMessage,
  CrmReplyTemplate,
  CrmDeal,
  CrmEvent,
  CrmLossReason,
  CrmPerson,
  CrmPipeline,
  CrmStage,
  CrmTask,
  CrmTaskWithDeal,
} from "./types";

export const CRM_KEY = "crm";

export function invalidateCrm(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: [CRM_KEY] });
}

/** Ошибка базы — текстом для тоста. */
export function crmErrorText(e: unknown, fallback = "Не удалось сохранить"): string {
  const message = e instanceof Error ? e.message : "";
  if (/crm_forbidden|row-level security/i.test(message)) return "Недостаточно прав";
  if (/crm_deals_(pipeline|stage)_id_fkey/.test(message))
    return "В воронке или этапе есть сделки — сначала перенесите их";
  return message || fallback;
}

export async function crmRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Воронки, этапы (по порядку) и причины отказа — справочники раздела. */
export const crmSetupQuery = queryOptions({
  queryKey: [CRM_KEY, "setup"],
  queryFn: async () => {
    const [pipelines, stages, lossReasons] = await Promise.all([
      unwrap<CrmPipeline[]>(
        supabase
          .from("crm_pipelines")
          .select("id, name, sort_order, is_archived")
          .order("sort_order"),
      ),
      unwrap<CrmStage[]>(
        supabase
          .from("crm_stages")
          .select("id, pipeline_id, name, color, kind, sort_order, created_at"),
      ),
      unwrap<CrmLossReason[]>(
        supabase
          .from("crm_loss_reasons")
          .select("id, name, sort_order, is_active")
          .order("sort_order"),
      ),
    ]);
    return { pipelines, stages: sortStages(stages), lossReasons };
  },
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить воронки" },
});

export const crmPeopleQuery = queryOptions({
  queryKey: [CRM_KEY, "people"],
  queryFn: () => crmRpc<CrmPerson[]>("crm_people"),
  staleTime: 5 * 60_000,
  meta: { errorMessage: "Не удалось загрузить сотрудников CRM" },
});

const DEAL_COLUMNS =
  "id, title, pipeline_id, stage_id, contact_id, studio_id, responsible_id, budget, source, tags, loss_reason_id, stage_entered_at, closed_at, created_at, updated_at, contact:crm_contacts(id, name, phone, email, client_id)";

/** Сколько дней закрытые сделки остаются в колонках «Успешно» / «Не реализовано». */
export const CLOSED_DAYS = 30;

/**
 * Сделки воронки для канбана: все открытые и закрытые за последние
 * CLOSED_DAYS дней; с ними — невыполненные задачи (метка срока на карточке).
 */
export function usePipelineDeals(pipelineId: string | null) {
  return useQuery({
    queryKey: [CRM_KEY, "deals", pipelineId],
    queryFn: async () => {
      const since = new Date(Date.now() - CLOSED_DAYS * 86_400_000).toISOString();
      const deals = await unwrap<CrmDeal[]>(
        supabase
          .from("crm_deals")
          .select(DEAL_COLUMNS)
          .eq("pipeline_id", pipelineId!)
          .or(`closed_at.is.null,closed_at.gte.${since}`)
          .order("stage_entered_at", { ascending: false })
          .limit(1000),
      );
      const ids = deals.map((d) => d.id);
      const tasks = ids.length
        ? await unwrap<Pick<CrmTask, "deal_id" | "due_at" | "done_at">[]>(
            supabase
              .from("crm_tasks")
              .select("deal_id, due_at, done_at")
              .is("done_at", null)
              .in("deal_id", ids),
          )
        : [];
      return { deals, tasks };
    },
    enabled: !!pipelineId,
    refetchInterval: 60_000,
    meta: { errorMessage: "Не удалось загрузить сделки" },
  });
}

/** Карточка сделки: сама сделка, лента и задачи. */
export function useDeal(dealId: string | null) {
  return useQuery({
    queryKey: [CRM_KEY, "deal", dealId],
    queryFn: async () => {
      const [deal, events, tasks] = await Promise.all([
        unwrap<CrmDeal | null>(
          supabase.from("crm_deals").select(DEAL_COLUMNS).eq("id", dealId!).maybeSingle(),
        ),
        unwrap<CrmEvent[]>(
          supabase
            .from("crm_deal_events")
            .select("id, deal_id, kind, body, meta, author_id, author_name, created_at, edited_at")
            .eq("deal_id", dealId!)
            .order("created_at", { ascending: true }),
        ),
        unwrap<CrmTask[]>(
          supabase
            .from("crm_tasks")
            .select("id, deal_id, title, due_at, assignee_id, auto, done_at, created_at")
            .eq("deal_id", dealId!)
            .order("due_at", { ascending: true }),
        ),
      ]);
      return { deal, events, tasks };
    },
    enabled: !!dealId,
    meta: { errorMessage: "Не удалось загрузить сделку" },
  });
}

/** Невыполненные задачи: свои или всех (раздел «Задачи»). */
export function useOpenTasks(assigneeId: string | null) {
  return useQuery({
    queryKey: [CRM_KEY, "tasks", assigneeId ?? "all"],
    queryFn: () => {
      let q = supabase
        .from("crm_tasks")
        .select(
          "id, deal_id, title, due_at, assignee_id, auto, done_at, created_at, deal:crm_deals(id, title, pipeline_id, contact:crm_contacts(name))",
        )
        .is("done_at", null)
        .order("due_at", { ascending: true })
        .limit(500);
      if (assigneeId) q = q.eq("assignee_id", assigneeId);
      return unwrap<CrmTaskWithDeal[]>(q);
    },
    refetchInterval: 60_000,
    meta: { errorMessage: "Не удалось загрузить задачи" },
  });
}

/** Число своих задач на сегодня и просроченных — счётчик в меню и рейке. */
export function useMyDueTasksCount(userId: string | null, enabled: boolean) {
  const { data } = useQuery({
    queryKey: [CRM_KEY, "tasks", "due-count", userId],
    queryFn: async () => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const { count, error } = await supabase
        .from("crm_tasks")
        .select("id", { count: "exact", head: true })
        .is("done_at", null)
        .eq("assignee_id", userId!)
        .lte("due_at", end.toISOString());
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    enabled: enabled && !!userId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return data ?? 0;
}

// Запись ---------------------------------------------------------------------

async function run(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export type DealPatch = Partial<
  Pick<
    CrmDeal,
    | "title"
    | "pipeline_id"
    | "stage_id"
    | "studio_id"
    | "responsible_id"
    | "budget"
    | "source"
    | "tags"
    | "loss_reason_id"
    | "contact_id"
  >
>;

export const updateDeal = (id: string, patch: DealPatch) =>
  run(supabase.from("crm_deals").update(patch).eq("id", id));

export const deleteDeal = (id: string) => run(supabase.from("crm_deals").delete().eq("id", id));

export type NewDeal = {
  title: string;
  pipeline_id: string;
  stage_id: string;
  studio_id: string | null;
  responsible_id: string | null;
  budget: number | null;
  source: string | null;
  tags: string[];
  contact: { name: string; phone: string | null; email: string | null } | null;
};

/** Новая сделка; контакт заводится вместе с ней. */
export async function createDeal(input: NewDeal): Promise<string> {
  let contactId: string | null = null;
  if (input.contact) {
    const rows = await unwrap<{ id: string }[]>(
      supabase.from("crm_contacts").insert(input.contact).select("id"),
    );
    contactId = rows[0].id;
  }
  const { contact: _contact, ...deal } = input;
  const rows = await unwrap<{ id: string }[]>(
    supabase
      .from("crm_deals")
      .insert({ ...deal, contact_id: contactId })
      .select("id"),
  );
  return rows[0].id;
}

export const updateContact = (
  id: string,
  patch: Partial<{
    name: string;
    phone: string | null;
    email: string | null;
    client_id: string | null;
  }>,
) => run(supabase.from("crm_contacts").update(patch).eq("id", id));

export const addNote = (dealId: string, body: string) =>
  run(supabase.from("crm_deal_events").insert({ deal_id: dealId, body }));
export const updateNote = (id: string, body: string) =>
  run(supabase.from("crm_deal_events").update({ body }).eq("id", id));
export const deleteNote = (id: string) =>
  run(supabase.from("crm_deal_events").delete().eq("id", id));

export const addTask = (task: {
  deal_id: string;
  title: string;
  due_at: string;
  assignee_id: string | null;
}) => run(supabase.from("crm_tasks").insert(task));
export const setTaskDone = (id: string, done: boolean) =>
  run(
    supabase
      .from("crm_tasks")
      .update({ done_at: done ? new Date().toISOString() : null })
      .eq("id", id),
  );
export const deleteTask = (id: string) => run(supabase.from("crm_tasks").delete().eq("id", id));

/** Клубы для сделок: названия всех клубов (studios читается публично). */
export function useCrmStudios() {
  return useQuery({
    queryKey: [CRM_KEY, "studios"],
    queryFn: () =>
      unwrap<{ id: string; name: string }[]>(
        supabase.from("studios").select("id, name").order("name"),
      ),
    staleTime: 5 * 60_000,
    meta: { errorMessage: "Не удалось загрузить клубы" },
  });
}

// Переписка --------------------------------------------------------------------

export const crmAccountsQuery = queryOptions({
  queryKey: [CRM_KEY, "accounts"],
  queryFn: () =>
    unwrap<CrmChannelAccount[]>(
      supabase
        .from("crm_channel_accounts")
        .select(
          "id, kind, name, studio_id, pipeline_id, external_id, username, status, status_note, last_event_at",
        )
        .order("created_at"),
    ),
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить каналы" },
});

export const crmTemplatesQuery = queryOptions({
  queryKey: [CRM_KEY, "templates"],
  queryFn: () =>
    unwrap<CrmReplyTemplate[]>(
      supabase
        .from("crm_reply_templates")
        .select("id, title, body, sort_order")
        .order("sort_order"),
    ),
  staleTime: 5 * 60_000,
  meta: { errorMessage: "Не удалось загрузить шаблоны ответов" },
});

const CONVERSATION_COLUMNS =
  "id, contact_id, account_id, studio_id, last_message_at, last_message_text, last_direction, last_inbound_at, unread_count, contact:crm_contacts(id, name, phone, client_id), identity:crm_contact_identities(username, display_name)";

/** Как часто перезапрашивать переписку, пока вкладка открыта (Realtime нет). */
const CHAT_POLL_MS = 4_000;
const INBOX_POLL_MS = 8_000;

/** Диалоги: последние сверху; unreadOnly — только с непрочитанным. */
export function useConversations(opts: { accountId: string; unreadOnly: boolean }) {
  return useQuery({
    queryKey: [CRM_KEY, "conversations", opts.accountId, opts.unreadOnly],
    queryFn: () => {
      let q = supabase
        .from("crm_conversations")
        .select(CONVERSATION_COLUMNS)
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(200);
      if (opts.accountId) q = q.eq("account_id", opts.accountId);
      if (opts.unreadOnly) q = q.gt("unread_count", 0);
      return unwrap<CrmConversation[]>(q);
    },
    refetchInterval: INBOX_POLL_MS,
    meta: { errorMessage: "Не удалось загрузить диалоги" },
  });
}

/** Диалоги контакта (карточка сделки): во всех каналах и аккаунтах. */
export function useContactConversations(contactId: string | null) {
  return useQuery({
    queryKey: [CRM_KEY, "conversations", "contact", contactId],
    queryFn: () =>
      unwrap<CrmConversation[]>(
        supabase
          .from("crm_conversations")
          .select(CONVERSATION_COLUMNS)
          .eq("contact_id", contactId!)
          .order("last_message_at", { ascending: false }),
      ),
    enabled: !!contactId,
    refetchInterval: INBOX_POLL_MS,
    meta: { errorMessage: "Не удалось загрузить переписку" },
  });
}

/** Последние 300 сообщений диалога, старые сверху. */
export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: [CRM_KEY, "messages", conversationId],
    queryFn: async () => {
      const rows = await unwrap<CrmMessage[]>(
        supabase
          .from("crm_messages")
          .select(
            "id, conversation_id, direction, body, attachments, status, error, sent_by_name, auto, created_at",
          )
          .eq("conversation_id", conversationId!)
          .order("created_at", { ascending: false })
          .limit(300),
      );
      return rows.reverse();
    },
    enabled: !!conversationId,
    refetchInterval: CHAT_POLL_MS,
    meta: { errorMessage: "Не удалось загрузить сообщения" },
  });
}

/** Сколько диалогов с непрочитанным — счётчик в меню и рейке. */
export function useUnreadConversations(enabled: boolean) {
  const { data } = useQuery({
    queryKey: [CRM_KEY, "conversations", "unread-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("crm_conversations")
        .select("id", { count: "exact", head: true })
        .gt("unread_count", 0);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    enabled,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
  return data ?? 0;
}

export const markConversationRead = (id: string) =>
  crmRpc<void>("crm_conversation_read", { p_conversation: id });

/** Открытая сделка контакта (последняя) — «Открыть сделку» из диалога. */
export async function findContactDeal(contactId: string): Promise<string | null> {
  const rows = await unwrap<{ id: string }[]>(
    supabase
      .from("crm_deals")
      .select("id")
      .eq("contact_id", contactId)
      .order("closed_at", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false })
      .limit(1),
  );
  return rows[0]?.id ?? null;
}

/** Ответ в диалог — через сервер админки (токен канала есть только там). */
export async function sendCrmMessage(conversationId: string, body: string, file: File | null) {
  const { data } = await supabase.auth.getSession();
  const form = new FormData();
  form.set("conversation_id", conversationId);
  form.set("body", body);
  if (file) form.set("file", file);
  const res = await fetch("/api/crm/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: form,
  });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? "Не удалось отправить сообщение");
}

/** Подписанная ссылка на файл переписки (бакет crm-media), на час. */
export async function crmFileUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("crm-media").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// Автоматизации этапов -----------------------------------------------------------

export const crmAutomationsQuery = queryOptions({
  queryKey: [CRM_KEY, "automations"],
  queryFn: () =>
    unwrap<CrmAutomation[]>(
      supabase
        .from("crm_automations")
        .select("id, stage_id, trigger, delay_minutes, action, params, is_active, sort_order")
        .order("sort_order")
        .order("created_at"),
    ),
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить автоматизации" },
});

// Контакт: каналы и объединение дублей ---------------------------------------------

export type ContactIdentity = {
  id: string;
  channel: string;
  username: string | null;
  display_name: string | null;
};

export function useContactIdentities(contactId: string | null) {
  return useQuery({
    queryKey: [CRM_KEY, "identities", contactId],
    queryFn: () =>
      unwrap<ContactIdentity[]>(
        supabase
          .from("crm_contact_identities")
          .select("id, channel, username, display_name")
          .eq("contact_id", contactId!)
          .order("created_at"),
      ),
    enabled: !!contactId,
    staleTime: 60_000,
  });
}

export type ContactMatch = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  channels: string[];
  deals: number;
};

export const searchContacts = (query: string, exclude: string) =>
  crmRpc<ContactMatch[]>("crm_contact_search", { p_query: query, p_exclude: exclude });

/** Всё от merge переходит к keep; merge удаляется. */
export const mergeContacts = (keep: string, merge: string) =>
  crmRpc<void>("crm_contacts_merge", { p_keep: keep, p_merge: merge });
