/**
 * CRM — типы строк базы (db/migrations/2026-11-17_zzz_crm_core.sql; план и
 * решения — CRM.md). Воронки и этапы общие на сеть, сделка — клуба или без
 * клуба.
 */
export type StageKind = "open" | "won" | "lost";

export type CrmPipeline = {
  id: string;
  name: string;
  sort_order: number;
  is_archived: boolean;
};

export type CrmStage = {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  kind: StageKind;
  sort_order: number;
  created_at: string;
};

export type CrmLossReason = { id: string; name: string; sort_order: number; is_active: boolean };

export type CrmContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Карточка клиента портала (ставит база по телефону или почте, или вручную). */
  client_id: string | null;
};

export type CrmDeal = {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  studio_id: string | null;
  responsible_id: string | null;
  budget: number | null;
  source: string | null;
  tags: string[];
  loss_reason_id: string | null;
  stage_entered_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  contact: CrmContact | null;
};

export type CrmEventKind = "note" | "created" | "stage" | "pipeline" | "responsible" | "task_done";

export type CrmEvent = {
  id: string;
  deal_id: string;
  kind: CrmEventKind;
  body: string | null;
  meta: Record<string, string | null>;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  edited_at: string | null;
};

export type CrmTask = {
  id: string;
  deal_id: string;
  title: string;
  due_at: string;
  assignee_id: string | null;
  auto: boolean;
  done_at: string | null;
  created_at: string;
};

/** Задача со сделкой — раздел «Задачи». */
export type CrmTaskWithDeal = CrmTask & {
  deal: { id: string; title: string; pipeline_id: string; contact: { name: string } | null } | null;
};

/** Кого можно назначить ответственным (RPC crm_people). */
export type CrmPerson = { id: string; full_name: string | null; avatar_url: string | null };

// Переписка (db/migrations/2026-11-17_zzzz_crm_messaging.sql) ------------------

export type ChannelKind = "telegram_bot" | "telegram_user" | "whatsapp" | "instagram" | "facebook";

export type CrmChannelAccount = {
  id: string;
  kind: ChannelKind;
  name: string;
  studio_id: string | null;
  pipeline_id: string | null;
  external_id: string | null;
  username: string | null;
  status: "active" | "error" | "disabled";
  status_note: string | null;
  last_event_at: string | null;
};

export type CrmConversation = {
  id: string;
  contact_id: string;
  account_id: string;
  studio_id: string | null;
  last_message_at: string | null;
  last_message_text: string | null;
  last_direction: "in" | "out" | null;
  last_inbound_at: string | null;
  unread_count: number;
  contact: { id: string; name: string; phone: string | null; client_id: string | null } | null;
  identity: { username: string | null; display_name: string | null } | null;
};

export type CrmAttachment = {
  kind: "image" | "video" | "audio" | "file";
  /** Путь в бакете crm-media; пусто — файл не загружен. */
  path: string;
  name: string;
  mime: string | null;
  size: number | null;
};

export type CrmMessage = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  body: string | null;
  attachments: CrmAttachment[];
  status: "received" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  sent_by_name: string | null;
  auto: boolean;
  created_at: string;
};

export type CrmReplyTemplate = { id: string; title: string; body: string; sort_order: number };
