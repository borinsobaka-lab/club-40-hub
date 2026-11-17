/**
 * CRM — загрузка и запись (React Query, таблицы crm_* и RPC,
 * db/migrations/2026-11-17_zzz_crm_core.sql). Ключи — ["crm", …]; после
 * записи — invalidateCrm. Что видит сотрудник, решает RLS: сделки своих
 * клубов и без клуба (crm.view), всех клубов (crm.manage).
 */
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import {
  DEFAULT_CRM_SETTINGS,
  sortStages,
  type CrmSettings,
  type FunnelGroup,
  type FunnelRow,
  type ScenarioKey,
} from "./logic";
import type {
  CrmAutomation,
  CrmWaTemplate,
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
  CrmTaskRow,
  CrmTaskType,
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
  "id, title, pipeline_id, stage_id, contact_id, studio_id, responsible_id, budget, source, tags, loss_reason_id, stage_entered_at, closed_at, created_at, updated_at, scenario, utm_source, utm_medium, utm_campaign, utm_content, page_url, contact:crm_contacts(id, name, phone, email, client_id)";

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
            .select("id, deal_id, title, note, result, due_at, assignee_id, type_id, auto, done_at")
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

export const crmTaskTypesQuery = queryOptions({
  queryKey: [CRM_KEY, "task-types"],
  queryFn: () =>
    unwrap<CrmTaskType[]>(
      supabase.from("crm_task_types").select("id, name, color, sort_order").order("sort_order"),
    ),
  staleTime: 5 * 60_000,
  meta: { errorMessage: "Не удалось загрузить типы задач" },
});

/**
 * Раздел «Задачи»: невыполненные (ближайшие и просроченные сверху) или
 * выполненные за 30 дней; assigneeId null — всех сотрудников.
 */
export function useTasksList(opts: {
  assigneeId: string | null;
  typeId: string | null;
  done: boolean;
}) {
  return useQuery({
    queryKey: [CRM_KEY, "tasks", opts.assigneeId ?? "all", opts.typeId ?? "any", opts.done],
    queryFn: () =>
      crmRpc<CrmTaskRow[]>("crm_tasks_list", {
        p_assignee: opts.assigneeId,
        p_type: opts.typeId,
        p_done: opts.done,
      }),
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

export type TaskInput = {
  title: string;
  due_at: string;
  assignee_id: string | null;
  type_id: string | null;
  note: string | null;
};

export const addTask = (dealId: string, task: TaskInput) =>
  run(supabase.from("crm_tasks").insert({ deal_id: dealId, ...task }));
export const updateTask = (id: string, patch: Partial<TaskInput>) =>
  run(supabase.from("crm_tasks").update(patch).eq("id", id));
/** Выполнить с результатом (пишется в ленту сделки) или вернуть в работу. */
export const setTaskDone = (id: string, done: boolean, result: string | null = null) =>
  run(
    supabase
      .from("crm_tasks")
      .update({ done_at: done ? new Date().toISOString() : null, result: done ? result : null })
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

// Тип string (не литерал) — как UNREAD_COLUMNS ниже.
const CONVERSATION_COLUMNS: string =
  "id, contact_id, account_id, studio_id, last_message_at, last_message_text, last_direction, last_inbound_at, waiting_since, unread_count, contact:crm_contacts(id, name, phone, client_id), identity:crm_contact_identities(username, display_name)";

/** Как часто перезапрашивать переписку, пока вкладка открыта (Realtime нет). */
const CHAT_POLL_MS = 4_000;
const INBOX_POLL_MS = 8_000;

/** Диалоги: последние сверху; unreadOnly — только с непрочитанным. */
export function useConversations(opts: {
  accountId: string;
  unreadOnly: boolean;
  waitingOnly?: boolean;
}) {
  return useQuery({
    queryKey: [CRM_KEY, "conversations", opts.accountId, opts.unreadOnly, !!opts.waitingOnly],
    queryFn: () => {
      let q = supabase
        .from("crm_conversations")
        .select(CONVERSATION_COLUMNS)
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(200);
      if (opts.accountId) q = q.eq("account_id", opts.accountId);
      if (opts.unreadOnly) q = q.gt("unread_count", 0);
      if (opts.waitingOnly) q = q.filter("waiting_since", "not.is", null);
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

// Тип string (не литерал): разбор длинной строки select вместе с .or() уводит
// tsc в слишком глубокую рекурсию.
const UNREAD_COLUMNS: string =
  "contact_id, unread_count, last_message_text, last_message_at, waiting_since";

export type ContactUnread = {
  count: number;
  text: string | null;
  /** С какого сообщения клиент ждёт ответа (самое раннее по его диалогам). */
  waitingSince: string | null;
};

/** Непрочитанное по контактам — для карточек канбана: кто ждёт ответа. */
export function useUnreadByContact(enabled = true) {
  const { data } = useQuery({
    queryKey: [CRM_KEY, "conversations", "unread-by-contact"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("crm_conversations")
        .select(UNREAD_COLUMNS)
        .or("unread_count.gt.0,waiting_since.not.is.null")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw new Error(error.message);
      const map = new Map<string, ContactUnread>();
      for (const r of (rows ?? []) as unknown as {
        contact_id: string;
        unread_count: number;
        last_message_text: string | null;
        waiting_since: string | null;
      }[]) {
        const prev = map.get(r.contact_id);
        const waits = [prev?.waitingSince, r.waiting_since].filter((w): w is string => !!w).sort();
        map.set(r.contact_id, {
          count: (prev?.count ?? 0) + r.unread_count,
          text: prev?.text ?? r.last_message_text,
          waitingSince: waits[0] ?? null,
        });
      }
      return map;
    },
    enabled,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
  return data;
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

// Отчёт -------------------------------------------------------------------------

export type CrmReport = {
  stages: { stage_id: string; count: number; budget: number }[];
  created: number;
  won: { count: number; budget: number };
  lost: { count: number; budget: number };
  loss: { name: string; count: number }[];
  people: { user_id: string | null; open: number; won: number; won_budget: number; lost: number }[];
  sources: { source: string; created: number; won: number }[];
  reply: { count: number; median_minutes: number | null };
  unanswered: number;
};

/** Отчёт по воронке за период (даты yyyy-MM-dd, включительно). */
export function useCrmReport(pipelineId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: [CRM_KEY, "report", pipelineId, from, to],
    queryFn: () =>
      crmRpc<CrmReport>("crm_report", { p_pipeline: pipelineId, p_from: from, p_to: to }),
    enabled: !!pipelineId && !!from && !!to,
    meta: { errorMessage: "Не удалось загрузить отчёт" },
  });
}

// Клиент портала в CRM: его диалоги и сделки (карточка клиента) -------------------

/** Диалоги всех контактов CRM, привязанных к карточке клиента. */
export function useClientConversations(clientId: string | null, enabled = true) {
  return useQuery({
    queryKey: [CRM_KEY, "conversations", "client", clientId],
    queryFn: () =>
      unwrap<CrmConversation[]>(
        supabase
          .from("crm_conversations")
          .select(
            "id, contact_id, account_id, studio_id, last_message_at, last_message_text, last_direction, last_inbound_at, waiting_since, unread_count, contact:crm_contacts!inner(id, name, phone, client_id), identity:crm_contact_identities(username, display_name)",
          )
          .eq("contact.client_id", clientId!)
          .order("last_message_at", { ascending: false, nullsFirst: false }),
      ),
    enabled: enabled && !!clientId,
    refetchInterval: 8_000,
    meta: { errorMessage: "Не удалось загрузить переписку" },
  });
}

export type ClientDeal = {
  id: string;
  title: string;
  stage_id: string;
  closed_at: string | null;
  created_at: string;
};

/** Сделки клиента (через его контакты CRM): открытые первыми. */
export function useClientDeals(clientId: string | null, enabled = true) {
  return useQuery({
    queryKey: [CRM_KEY, "deals", "client", clientId],
    queryFn: () =>
      unwrap<ClientDeal[]>(
        supabase
          .from("crm_deals")
          .select(
            "id, title, stage_id, closed_at, created_at, contact:crm_contacts!inner(client_id)",
          )
          .eq("contact.client_id", clientId!)
          .order("closed_at", { ascending: false, nullsFirst: true })
          .order("created_at", { ascending: false })
          .limit(20),
      ),
    enabled: enabled && !!clientId,
    meta: { errorMessage: "Не удалось загрузить сделки клиента" },
  });
}

/** Сделка для клиента портала: контакт CRM берётся его или заводится по карточке. */
export async function createDealForClient(input: {
  clientId: string;
  name: string;
  phone: string | null;
  email: string | null;
  pipelineId: string;
  stageId: string;
  studioId: string | null;
  responsibleId: string | null;
}): Promise<string> {
  const existing = await unwrap<{ id: string }[]>(
    supabase
      .from("crm_contacts")
      .select("id")
      .eq("client_id", input.clientId)
      .order("created_at")
      .limit(1),
  );
  let contactId = existing[0]?.id;
  if (!contactId) {
    const rows = await unwrap<{ id: string }[]>(
      supabase
        .from("crm_contacts")
        .insert({
          name: input.name,
          phone: input.phone,
          email: input.email,
          client_id: input.clientId,
        })
        .select("id"),
    );
    contactId = rows[0].id;
  }
  const rows = await unwrap<{ id: string }[]>(
    supabase
      .from("crm_deals")
      .insert({
        title: input.name,
        pipeline_id: input.pipelineId,
        stage_id: input.stageId,
        contact_id: contactId,
        studio_id: input.studioId,
        responsible_id: input.responsibleId,
      })
      .select("id"),
  );
  return rows[0].id;
}

// Шаблоны WhatsApp ----------------------------------------------------------------

export const crmWaTemplatesQuery = queryOptions({
  queryKey: [CRM_KEY, "wa-templates"],
  queryFn: () =>
    unwrap<CrmWaTemplate[]>(
      supabase
        .from("crm_wa_templates")
        .select(
          "id, account_id, name, language, category, body, footer, vars, status, rejected_reason, synced_at",
        )
        .order("created_at", { ascending: false }),
    ),
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить шаблоны WhatsApp" },
});

/**
 * Отправить шаблон WhatsApp: в существующий диалог или первым — по номеру
 * (диалог заведётся). Возвращает id диалога.
 */
export async function sendWaTemplate(input: {
  templateId: string;
  values: string[];
  conversationId?: string;
  start?: { accountId: string; phone: string; name: string; clientId: string | null };
}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch("/api/crm/send-template", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: string;
    conversation_id?: string;
  } | null;
  if (!res.ok || !json?.conversation_id)
    throw new Error(json?.error ?? "Не удалось отправить шаблон");
  return json.conversation_id;
}

/** Написать первым с личного аккаунта Telegram — по номеру или @нику. */
export async function startTelegramChat(input: {
  accountId: string;
  phone: string | null;
  username: string | null;
  name: string;
  clientId: string | null;
  body: string;
}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch("/api/crm/tg-start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: string;
    conversation_id?: string;
  } | null;
  if (!res.ok || !json?.conversation_id)
    throw new Error(json?.error ?? "Не удалось отправить сообщение");
  return json.conversation_id;
}

/**
 * Единственная невыполненная задача открытой сделки: у сделки в работе
 * задача должна быть всегда (решение владельца 2026-11-18), поэтому такую
 * нельзя выполнить или удалить, не поставив следующую.
 */
export async function isLastOpenTask(task: { id: string; deal_id: string }): Promise<boolean> {
  const [deal, others] = await Promise.all([
    supabase.from("crm_deals").select("closed_at").eq("id", task.deal_id).maybeSingle(),
    supabase
      .from("crm_tasks")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", task.deal_id)
      .is("done_at", null)
      .neq("id", task.id),
  ]);
  if (deal.error || others.error) return false;
  return !!deal.data && !deal.data.closed_at && (others.count ?? 0) === 0;
}

// Распределение новых заявок (db/migrations/2026-11-18_zzz_crm_tasks_required_distribution.sql)

export type DistributionMode = "off" | "order" | "random";
export type DistributionStudio = { studio_id: string; user_ids: string[]; sort_order: number };

export const crmDistributionQuery = queryOptions({
  queryKey: [CRM_KEY, "distribution"],
  queryFn: async () => {
    const [mode, studios] = await Promise.all([
      unwrap<{ mode: DistributionMode } | null>(
        supabase.from("crm_distribution").select("mode").maybeSingle(),
      ),
      unwrap<DistributionStudio[]>(
        supabase
          .from("crm_distribution_studios")
          .select("studio_id, user_ids, sort_order")
          .order("sort_order")
          .order("created_at"),
      ),
    ]);
    return { mode: mode?.mode ?? "off", studios };
  },
  meta: { errorMessage: "Не удалось загрузить распределение заявок" },
});

export async function setDistributionMode(mode: DistributionMode) {
  const { error } = await supabase
    .from("crm_distribution")
    .update({ mode, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

export async function saveDistributionStudio(row: DistributionStudio) {
  const { error } = await supabase.from("crm_distribution_studios").upsert(row);
  if (error) throw new Error(error.message);
}

export async function removeDistributionStudio(studioId: string) {
  const { error } = await supabase
    .from("crm_distribution_studios")
    .delete()
    .eq("studio_id", studioId);
  if (error) throw new Error(error.message);
}

// Скорость ответа и уведомления (db/migrations/2026-11-19_crm_reply_sla_notifications.sql)

export const crmSettingsQuery = queryOptions({
  queryKey: [CRM_KEY, "settings"],
  queryFn: async (): Promise<CrmSettings> =>
    (await unwrap<CrmSettings | null>(
      supabase
        .from("crm_settings")
        .select("reply_sla_minutes, escalate_minutes, work_from, work_to")
        .maybeSingle(),
    )) ?? DEFAULT_CRM_SETTINGS,
  staleTime: 5 * 60_000,
  meta: { errorMessage: "Не удалось загрузить настройки CRM" },
});

export async function saveCrmSettings(patch: Partial<CrmSettings>) {
  const { error } = await supabase.from("crm_settings").update(patch).eq("id", true);
  if (error) throw new Error(error.message);
}

/** Сколько диалогов ждут ответа — для «Диалогов» и отчёта. */
export function useWaitingCount(enabled = true) {
  const { data } = useQuery({
    queryKey: [CRM_KEY, "conversations", "waiting-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("crm_conversations")
        .select("id", { count: "exact", head: true })
        .not("waiting_since", "is", null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    enabled,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
  return data ?? 0;
}

export type PeopleReportRow = {
  user_id: string | null;
  open: number;
  created: number;
  won: number;
  won_budget: number;
  lost: number;
  replies: number;
  reply_median: number | null;
  reply_in_sla: number;
  messages: number;
  tasks_done: number;
  tasks_late: number;
  tasks_overdue: number;
};

export type PeopleReport = {
  sla_minutes: number;
  unanswered: number;
  asked: number;
  answered: number;
  reply_median: number | null;
  reply_in_sla: number;
  people: PeopleReportRow[];
};

export function usePeopleReport(pipelineId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: [CRM_KEY, "report", "people", pipelineId ?? "all", from, to],
    queryFn: () =>
      crmRpc<PeopleReport>("crm_people_report", {
        p_from: from,
        p_to: to,
        p_pipeline: pipelineId,
      }),
    enabled: !!from && !!to,
    meta: { errorMessage: "Не удалось загрузить отчёт по сотрудникам" },
  });
}

// Сценарии по клиентам клуба (db/migrations/2026-11-19_zz_crm_scenarios.sql) -------

export type CrmScenario = {
  key: ScenarioKey;
  enabled: boolean;
  pipeline_id: string | null;
  stage_id: string | null;
  params: { days?: number; left?: number };
  task_title: string;
};

export const crmScenariosQuery = queryOptions({
  queryKey: [CRM_KEY, "scenarios"],
  queryFn: () =>
    unwrap<CrmScenario[]>(
      supabase
        .from("crm_scenarios")
        .select("key, enabled, pipeline_id, stage_id, params, task_title")
        .order("sort_order"),
    ),
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить сценарии" },
});

export async function saveScenario(
  key: ScenarioKey,
  patch: Partial<Pick<CrmScenario, "enabled" | "stage_id" | "params" | "task_title">>,
) {
  const { error } = await supabase.from("crm_scenarios").update(patch).eq("key", key);
  if (error) throw new Error(error.message);
}

/** Сколько клиентов подходит под сценарий сейчас (с параметрами из формы). */
export const previewScenario = (key: ScenarioKey, params: CrmScenario["params"]) =>
  crmRpc<number>("crm_scenario_preview", { p_key: key, p_params: params });

export type ScenarioReportRow = {
  key: ScenarioKey;
  created: number;
  open: number;
  won: number;
  lost: number;
  won_budget: number;
};

export function useScenariosReport(from: string, to: string) {
  return useQuery({
    queryKey: [CRM_KEY, "report", "scenarios", from, to],
    queryFn: () => crmRpc<ScenarioReportRow[]>("crm_scenarios_report", { p_from: from, p_to: to }),
    enabled: !!from && !!to,
    meta: { errorMessage: "Не удалось загрузить отчёт по сценариям" },
  });
}

// Источники и сквозная воронка (db/migrations/2026-11-19_zzz_crm_sources_funnel.sql)

export type CrmLeadForm = {
  id: string;
  name: string;
  token: string;
  source: string | null;
  pipeline_id: string | null;
  studio_id: string | null;
  is_active: boolean;
  leads_count: number;
  last_lead_at: string | null;
};

export const crmLeadFormsQuery = queryOptions({
  queryKey: [CRM_KEY, "lead-forms"],
  queryFn: () =>
    unwrap<CrmLeadForm[]>(
      supabase
        .from("crm_lead_forms")
        .select(
          "id, name, token, source, pipeline_id, studio_id, is_active, leads_count, last_lead_at",
        )
        .order("created_at"),
    ),
  meta: { errorMessage: "Не удалось загрузить формы сайта" },
});

export type LeadFormInput = Pick<
  CrmLeadForm,
  "name" | "source" | "pipeline_id" | "studio_id" | "is_active"
>;

export async function saveLeadForm(id: string | null, input: LeadFormInput) {
  const q = id
    ? supabase.from("crm_lead_forms").update(input).eq("id", id)
    : supabase.from("crm_lead_forms").insert(input);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export const deleteLeadForm = (id: string) =>
  run(supabase.from("crm_lead_forms").delete().eq("id", id));

export type CrmLink = {
  id: string;
  code: string;
  name: string;
  source: string;
  campaign: string | null;
  target_kind: "whatsapp" | "telegram" | "url";
  target: string;
  text: string | null;
  is_active: boolean;
  clicks: number;
  last_click_at: string | null;
};

export const crmLinksQuery = queryOptions({
  queryKey: [CRM_KEY, "links"],
  queryFn: () =>
    unwrap<CrmLink[]>(
      supabase
        .from("crm_links")
        .select(
          "id, code, name, source, campaign, target_kind, target, text, is_active, clicks, last_click_at",
        )
        .order("created_at", { ascending: false }),
    ),
  meta: { errorMessage: "Не удалось загрузить ссылки" },
});

export type LinkInput = Pick<
  CrmLink,
  "name" | "source" | "campaign" | "target_kind" | "target" | "text" | "is_active"
>;

export async function saveLink(id: string | null, input: LinkInput) {
  const q = id
    ? supabase.from("crm_links").update(input).eq("id", id)
    : supabase.from("crm_links").insert(input);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export const deleteLink = (id: string) => run(supabase.from("crm_links").delete().eq("id", id));

/** Сколько сделок пришло по каждой ссылке. */
export function useLinkDeals(enabled = true) {
  return useQuery({
    queryKey: [CRM_KEY, "links", "deals"],
    queryFn: async () => {
      const rows = await unwrap<{ link_id: string }[]>(
        supabase.from("crm_deals").select("link_id").not("link_id", "is", null).limit(5000),
      );
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.link_id, (map.get(r.link_id) ?? 0) + 1);
      return map;
    },
    enabled,
    staleTime: 60_000,
  });
}

export type CrmAdSpend = {
  id: string;
  month: string;
  source: string;
  campaign: string | null;
  studio_id: string | null;
  amount: number;
  note: string | null;
};

export const crmAdSpendQuery = queryOptions({
  queryKey: [CRM_KEY, "ad-spend"],
  queryFn: () =>
    unwrap<CrmAdSpend[]>(
      supabase
        .from("crm_ad_spend")
        .select("id, month, source, campaign, studio_id, amount, note")
        .order("month", { ascending: false })
        .order("source")
        .limit(500),
    ),
  meta: { errorMessage: "Не удалось загрузить расходы на рекламу" },
});

export type AdSpendInput = Omit<CrmAdSpend, "id">;

export async function saveAdSpend(id: string | null, input: AdSpendInput) {
  const q = id
    ? supabase.from("crm_ad_spend").update(input).eq("id", id)
    : supabase.from("crm_ad_spend").insert(input);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export const deleteAdSpend = (id: string) =>
  run(supabase.from("crm_ad_spend").delete().eq("id", id));

/** Источники, которые уже встречались в сделках, ссылках, формах и расходах. */
export const crmSourceNamesQuery = queryOptions({
  queryKey: [CRM_KEY, "source-names"],
  queryFn: async () => {
    const [deals, links, spend] = await Promise.all([
      unwrap<{ source: string | null }[]>(
        supabase
          .from("crm_deals")
          .select("source")
          .not("source", "is", null)
          .order("created_at", { ascending: false })
          .limit(2000),
      ),
      unwrap<{ source: string }[]>(supabase.from("crm_links").select("source")),
      // Расходы видит только настройка — у остальных список без них.
      supabase.from("crm_ad_spend").select("source").then((r) => (r.data ?? []) as { source: string }[]),
    ]);
    const seen = new Map<string, string>();
    for (const r of [...deals, ...links, ...spend])
      if (r.source && !seen.has(r.source.toLowerCase())) seen.set(r.source.toLowerCase(), r.source);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"));
  },
  staleTime: 5 * 60_000,
});

export type FunnelReport = { rows: FunnelRow[]; total: FunnelRow };

export function useFunnelReport(
  group: FunnelGroup,
  pipelineId: string | null,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: [CRM_KEY, "report", "funnel", group, pipelineId ?? "all", from, to],
    queryFn: () =>
      crmRpc<FunnelReport>("crm_funnel_report", {
        p_from: from,
        p_to: to,
        p_group: group,
        p_pipeline: pipelineId,
      }),
    enabled: !!from && !!to,
    meta: { errorMessage: "Не удалось загрузить сквозную воронку" },
  });
}
