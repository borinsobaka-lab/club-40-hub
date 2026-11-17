/**
 * Каналы CRM на сервере (CRM.md, этап 2): подключение аккаунта, приём
 * входящих и отправка ответов. Сервис-ключ — только здесь: токены каналов
 * (crm_channel_secrets) и запись сообщений закрыты от браузера. Вызывающего
 * проверяют роуты и серверные функции (право CRM и видимость диалога — RLS
 * от его имени) до обращения сюда.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/integrations/supabase/client.server";
import { renderWaTemplate, toWaTemplate, waBodyProblem, waPhone, waVarCount } from "./logic";
import { needsHumanAgentTag, parseMetaWebhook, type MetaIncoming, type MetaKind } from "./meta";
import {
  fetchUrl,
  messagingProfile,
  MetaError,
  pageInfo,
  pageSend,
  pageSubscribe,
  waDownload,
  waPhoneInfo,
  waSendFile,
  waSendTemplate,
  waSendText,
  waSubscribe,
  waTemplateCreate,
  waTemplateDelete,
  waTemplatesList,
} from "./meta.server";
import { attachmentKind, parseTelegramUpdate, safeFileName, type IncomingFile } from "./telegram";
import {
  TelegramError,
  tgDeleteWebhook,
  tgDownload,
  tgGetMe,
  tgSendFile,
  tgSendText,
  tgSetWebhook,
} from "./telegram.server";

export const CRM_MEDIA_BUCKET = "crm-media";
/** Исходящий файл — до 20 МБ. */
export const CRM_MAX_UPLOAD = 20 * 1024 * 1024;

const adminUrl = () =>
  (process.env.ADMIN_APP_URL ?? "https://admin.base40.fit").replace(/\/+$/, "");
const webhookUrl = (accountId: string) => `${adminUrl()}/api/crm/telegram/${accountId}`;

type Secret = { token: string; webhook_secret: string | null };

async function loadSecret(accountId: string): Promise<Secret | null> {
  const { data } = await getSupabaseAdmin()
    .from("crm_channel_secrets")
    .select("token, webhook_secret")
    .eq("account_id", accountId)
    .maybeSingle();
  return (data as Secret | null) ?? null;
}

function channelError(e: unknown): string {
  if (e instanceof TelegramError) {
    if (e.code === 401) return "Telegram не принял токен бота — проверьте его в @BotFather";
    if (e.code === 403) return "Человек заблокировал бота — написать ему нельзя";
    return `Telegram: ${e.message}`;
  }
  if (e instanceof MetaError) {
    if (e.code === 131047 || e.code === 10 || /outside of allowed window/i.test(e.message))
      return "Прошло больше 24 часов с последнего сообщения клиента — ответить можно, когда он напишет снова";
    if (e.code === 190)
      return "Meta не приняла токен — он отозван или истёк, подключите аккаунт заново";
    if (e.code === 132001) return "Шаблон не одобрен или удалён в Meta — обновите статусы шаблонов";
    if (e.code === 132000 || e.code === 132012)
      return "Meta не приняла значения переменных шаблона";
    if (e.code === 132015 || e.code === 132016)
      return "Meta приостановила или отключила этот шаблон";
    if (e.code === 131026)
      return "Сообщение не доставить: номер не в WhatsApp или клиент не принимает сообщения";
    if (e.code === 131049)
      return "WhatsApp не доставил рекламный шаблон этому клиенту (лимит маркетинговых сообщений) — попробуйте позже";
    if (e.code === 131050) return "Клиент отказался от рекламных сообщений в WhatsApp";
    if (e.code === 131048 || e.code === 130429 || e.code === 131056)
      return "WhatsApp ограничил частоту отправки — попробуйте через несколько минут";
    if (e.code === 200)
      return "У токена нет права на это действие (нужно whatsapp_business_management)";
    return `Meta: ${e.message}`;
  }
  return e instanceof Error ? e.message : "Ошибка канала";
}

const tokenRejected = (e: unknown) =>
  (e instanceof TelegramError && e.code === 401) || (e instanceof MetaError && e.code === 190);

// Подключение -----------------------------------------------------------------

export async function connectTelegramBot(input: {
  name: string;
  token: string;
  studioId: string | null;
  pipelineId: string | null;
  userId: string;
}): Promise<{ id: string; username: string | null }> {
  const admin = getSupabaseAdmin();
  const token = input.token.trim();
  let bot;
  try {
    bot = await tgGetMe(token);
  } catch (e) {
    throw new Error(channelError(e));
  }
  const externalId = String(bot.id);
  const row = {
    kind: "telegram_bot",
    name: input.name.trim() || bot.first_name || bot.username || "Telegram-бот",
    studio_id: input.studioId,
    pipeline_id: input.pipelineId,
    external_id: externalId,
    username: bot.username ?? null,
    status: "active",
    status_note: null,
  };
  // Тот же бот уже подключён — обновляем его (новый токен, настройки).
  const { data: existing } = await admin
    .from("crm_channel_accounts")
    .select("id")
    .eq("kind", "telegram_bot")
    .eq("external_id", externalId)
    .maybeSingle();
  let id = existing?.id as string | undefined;
  if (id) {
    const { error } = await admin.from("crm_channel_accounts").update(row).eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await admin
      .from("crm_channel_accounts")
      .insert({ ...row, created_by: input.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  }
  const secret = randomBytes(24).toString("hex");
  const { error: secretError } = await admin.from("crm_channel_secrets").upsert({
    account_id: id,
    token,
    webhook_secret: secret,
    updated_at: new Date().toISOString(),
  });
  if (secretError) throw new Error(secretError.message);
  try {
    await tgSetWebhook(token, webhookUrl(id), secret);
  } catch (e) {
    const note = channelError(e);
    await admin
      .from("crm_channel_accounts")
      .update({ status: "error", status_note: note })
      .eq("id", id);
    throw new Error(`Бот найден, но вебхук не поставился. ${note}`);
  }
  return { id, username: bot.username ?? null };
}

async function accountKind(accountId: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("crm_channel_accounts")
    .select("kind")
    .eq("id", accountId)
    .maybeSingle();
  return (data?.kind as string | undefined) ?? null;
}

/**
 * Включить или отключить аккаунт (переписка остаётся). У Telegram-бота
 * вебхук ставится и снимается; у каналов Meta вебхук общий на приложение —
 * события выключенного аккаунта просто не принимаются.
 */
export async function setChannelEnabled(accountId: string, enabled: boolean): Promise<void> {
  const admin = getSupabaseAdmin();
  const secret = await loadSecret(accountId);
  if (!secret) throw new Error("У аккаунта нет токена — подключите его заново");
  if ((await accountKind(accountId)) === "telegram_bot") {
    try {
      if (enabled) {
        const next = secret.webhook_secret ?? randomBytes(24).toString("hex");
        if (!secret.webhook_secret)
          await admin
            .from("crm_channel_secrets")
            .update({ webhook_secret: next })
            .eq("account_id", accountId);
        await tgSetWebhook(secret.token, webhookUrl(accountId), next);
      } else {
        await tgDeleteWebhook(secret.token);
      }
    } catch (e) {
      if (enabled) throw new Error(channelError(e));
      // Отключаем в любом случае: токен мог быть уже отозван.
    }
  }
  const { error } = await admin
    .from("crm_channel_accounts")
    .update({ status: enabled ? "active" : "disabled", status_note: null })
    .eq("id", accountId);
  if (error) throw new Error(error.message);
}

/** Удалить аккаунт вместе с его диалогами и файлами. */
export async function deleteChannel(accountId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const secret = await loadSecret(accountId);
  if (secret && (await accountKind(accountId)) === "telegram_bot")
    await tgDeleteWebhook(secret.token).catch(() => {});
  const { data: convs } = await admin
    .from("crm_conversations")
    .select("id")
    .eq("account_id", accountId);
  for (const c of convs ?? []) {
    const { data: files } = await admin.storage
      .from(CRM_MEDIA_BUCKET)
      .list(c.id as string, { limit: 1000 });
    if (files?.length)
      await admin.storage.from(CRM_MEDIA_BUCKET).remove(files.map((f) => `${c.id}/${f.name}`));
  }
  const { error } = await admin.from("crm_channel_accounts").delete().eq("id", accountId);
  if (error) throw new Error(error.message);
}

/**
 * Подключить аккаунт Meta по токену (системного пользователя — WhatsApp,
 * страницы — Facebook и Instagram). Токен проверяется запросом к Graph API,
 * приложение подписывается на сообщения.
 */
export async function connectMetaAccount(input: {
  kind: MetaKind;
  name: string;
  token: string;
  /** WhatsApp: id номера (Phone number ID) и id аккаунта WhatsApp Business. */
  phoneNumberId: string | null;
  wabaId: string | null;
  studioId: string | null;
  pipelineId: string | null;
  userId: string;
}): Promise<{ id: string; label: string }> {
  const admin = getSupabaseAdmin();
  const token = input.token.trim();
  let externalId: string;
  let username: string | null = null;
  let label: string;
  try {
    if (input.kind === "whatsapp") {
      if (!input.phoneNumberId) throw new Error("Укажите Phone number ID");
      if (!input.wabaId)
        throw new Error("Укажите ID аккаунта WhatsApp Business — без него не работают шаблоны");
      const info = await waPhoneInfo(token, input.phoneNumberId);
      externalId = info.id;
      username = info.display_phone_number ?? null;
      label = info.verified_name ?? info.display_phone_number ?? "WhatsApp";
      if (input.wabaId) await waSubscribe(token, input.wabaId);
    } else {
      const page = await pageInfo(token);
      if (input.kind === "instagram") {
        if (!page.instagram_business_account)
          throw new Error(`К странице «${page.name ?? page.id}» не привязан аккаунт Instagram`);
        externalId = page.instagram_business_account.id;
        username = page.instagram_business_account.username ?? null;
        label = username ? `@${username}` : "Instagram";
      } else {
        externalId = page.id;
        label = page.name ?? "Facebook";
      }
      await pageSubscribe(token);
    }
  } catch (e) {
    throw new Error(channelError(e));
  }
  const row = {
    kind: input.kind,
    name: input.name.trim() || label,
    studio_id: input.studioId,
    pipeline_id: input.pipelineId,
    external_id: externalId,
    username,
    waba_id: input.kind === "whatsapp" ? input.wabaId : null,
    status: "active",
    status_note: null,
  };
  const { data: existing } = await admin
    .from("crm_channel_accounts")
    .select("id")
    .eq("kind", input.kind)
    .eq("external_id", externalId)
    .maybeSingle();
  let id = existing?.id as string | undefined;
  if (id) {
    const { error } = await admin.from("crm_channel_accounts").update(row).eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await admin
      .from("crm_channel_accounts")
      .insert({ ...row, created_by: input.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  }
  const { error: secretError } = await admin
    .from("crm_channel_secrets")
    .upsert({ account_id: id, token, updated_at: new Date().toISOString() });
  if (secretError) throw new Error(secretError.message);
  return { id, label };
}

// Входящие --------------------------------------------------------------------

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Attachment = {
  kind: IncomingFile["kind"];
  path: string;
  name: string;
  mime: string | null;
  size: number | null;
};

/**
 * Вебхук Telegram-бота. Ответ: 200 — принято (в том числе то, что нам не
 * нужно: группы, правки), 403 — секрет не тот, 500 — сбой базы (Telegram
 * повторит доставку; повтор не задвоит сообщение).
 */
export async function handleTelegramWebhook(
  accountId: string,
  secretHeader: string | null,
  update: unknown,
): Promise<number> {
  const secret = await loadSecret(accountId);
  if (!secret?.webhook_secret || !secretHeader || !sameSecret(secret.webhook_secret, secretHeader))
    return 403;
  const incoming = parseTelegramUpdate(update);
  if (!incoming) return 200;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("crm_ingest_message", {
    p_account: accountId,
    p_chat: incoming.chatId,
    p_sender: incoming.sender,
    p_message: incoming.message,
  });
  if (error) {
    // Аккаунт отключён или удалён — повторять незачем.
    if (/crm_account_not_found/.test(error.message)) return 200;
    console.error("[crm] ingest:", error.message);
    return 500;
  }
  const result = data as { duplicate: boolean; conversation_id: string; message_id?: string };
  if (result.duplicate || !result.message_id || incoming.files.length === 0) return 200;

  // Файлы — после записи сообщения: папка бакета — id диалога.
  const attachments: Attachment[] = [];
  for (const f of incoming.files) {
    const bytes = await tgDownload(secret.token, f.fileId);
    if (!bytes) {
      attachments.push({
        kind: f.kind,
        path: "",
        name: `${f.name} (не загружен: больше 20 МБ)`,
        mime: f.mime,
        size: f.size,
      });
      continue;
    }
    const path = `${result.conversation_id}/${result.message_id}-${safeFileName(f.name)}`;
    const { error: upErr } = await admin.storage
      .from(CRM_MEDIA_BUCKET)
      .upload(path, bytes, { contentType: f.mime ?? undefined, upsert: true });
    if (upErr) {
      console.error("[crm] media:", upErr.message);
      continue;
    }
    attachments.push({
      kind: f.kind,
      path,
      name: f.name,
      mime: f.mime,
      size: f.size ?? bytes.byteLength,
    });
  }
  if (attachments.length)
    await admin.from("crm_messages").update({ attachments }).eq("id", result.message_id);
  return 200;
}

// Входящие Meta ----------------------------------------------------------------

async function ingestMeta(m: MetaIncoming): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: account } = await admin
    .from("crm_channel_accounts")
    .select("id, status")
    .eq("kind", m.kind)
    .eq("external_id", m.accountExternalId)
    .maybeSingle();
  if (!account || account.status === "disabled") return;
  const secret = await loadSecret(account.id as string);
  if (!secret) return;

  // Имя и ник собеседника Messenger / Instagram — отдельным запросом, только
  // для нового диалога (ник нужен, чтобы склеить человека из двух аккаунтов).
  let sender = m.sender;
  if (m.kind !== "whatsapp") {
    const { data: known } = await admin
      .from("crm_conversations")
      .select("id")
      .eq("account_id", account.id)
      .eq("external_chat_id", m.chatId)
      .maybeSingle();
    if (!known) {
      const profile = await messagingProfile(secret.token, m.kind, m.sender.external_id);
      sender = { ...sender, name: profile.name, username: profile.username };
    }
  }
  const { data, error } = await admin.rpc("crm_ingest_message", {
    p_account: account.id,
    p_chat: m.chatId,
    p_sender: sender,
    p_message: m.message,
  });
  if (error) throw new Error(error.message);
  const result = data as { duplicate: boolean; conversation_id: string; message_id?: string };
  if (result.duplicate || !result.message_id || m.files.length === 0) return;

  const attachments: Attachment[] = [];
  for (const f of m.files) {
    const got = f.mediaId
      ? await waDownload(secret.token, f.mediaId)
      : f.url
        ? await fetchUrl(f.url).then((bytes) => (bytes ? { bytes, mime: f.mime } : null))
        : null;
    if (!got) {
      attachments.push({
        kind: f.kind,
        path: "",
        name: `${f.name} (не загружен)`,
        mime: f.mime,
        size: null,
      });
      continue;
    }
    const path = `${result.conversation_id}/${result.message_id}-${safeFileName(f.name)}`;
    const { error: upErr } = await admin.storage
      .from(CRM_MEDIA_BUCKET)
      .upload(path, got.bytes, { contentType: got.mime ?? undefined, upsert: true });
    if (upErr) {
      console.error("[crm] media:", upErr.message);
      continue;
    }
    attachments.push({
      kind: f.kind,
      path,
      name: f.name,
      mime: got.mime,
      size: got.bytes.byteLength,
    });
  }
  if (attachments.length)
    await admin.from("crm_messages").update({ attachments }).eq("id", result.message_id);
}

/**
 * Вебхук приложения Meta (WhatsApp, Messenger, Instagram) — тело уже
 * проверено по подписи. false — сбой базы: ответить ошибкой, Meta повторит
 * (повтор сообщение не задвоит).
 */
export async function handleMetaWebhook(payload: unknown): Promise<boolean> {
  const { messages, statuses, templates } = parseMetaWebhook(payload);
  let ok = true;
  // События могут прийти не по порядку — раскладываем по времени.
  messages.sort((a, b) => a.message.sent_at.localeCompare(b.message.sent_at));
  for (const m of messages) {
    try {
      await ingestMeta(m);
    } catch (e) {
      console.error("[crm] meta ingest:", e instanceof Error ? e.message : e);
      ok = false;
    }
  }
  const admin = getSupabaseAdmin();
  for (const t of templates)
    await admin
      .from("crm_wa_templates")
      .update({
        status: t.status,
        rejected_reason: t.status === "APPROVED" ? null : t.reason,
        synced_at: new Date().toISOString(),
      })
      .eq("meta_id", t.metaId);
  for (const s of statuses) {
    // «Прочитано» не откатываем к «доставлено», если статусы пришли не по порядку.
    let q = admin
      .from("crm_messages")
      .update({ status: s.status, error: s.error })
      .eq("external_id", s.externalId)
      .eq("direction", "out");
    if (s.status === "sent") q = q.in("status", ["sent"]);
    if (s.status === "delivered") q = q.in("status", ["sent", "delivered"]);
    await q;
  }
  return ok;
}

// Отправка --------------------------------------------------------------------

type OutAccount = {
  id: string;
  kind: string;
  status: string;
  external_id: string | null;
  waba_id?: string | null;
};
type OutFile = { file: File; path: string };

/** Отправить в канал аккаунта; возвращает id сообщения в канале. */
async function deliver(
  account: OutAccount,
  secret: Secret,
  chatId: string,
  body: string,
  out: OutFile | null,
  lastInboundAt: string | null = null,
): Promise<string> {
  if (account.kind === "telegram_bot")
    return out
      ? tgSendFile(secret.token, chatId, out.file, out.file.name, body || null)
      : tgSendText(secret.token, chatId, body);
  if (account.kind === "whatsapp") {
    if (!account.external_id) throw new Error("У аккаунта нет номера");
    return out
      ? waSendFile(secret.token, account.external_id, chatId, out.file, body || null)
      : waSendText(secret.token, account.external_id, chatId, body);
  }
  if (account.kind === "facebook" || account.kind === "instagram") {
    let attachment: { url: string; mime: string } | null = null;
    if (out) {
      // Meta забирает вложение по ссылке — подписанная ссылка на наш файл.
      const { data } = await getSupabaseAdmin()
        .storage.from(CRM_MEDIA_BUCKET)
        .createSignedUrl(out.path, 3600);
      if (!data?.signedUrl) throw new Error("Не удалось подготовить файл");
      attachment = { url: data.signedUrl, mime: out.file.type || "application/octet-stream" };
    }
    return pageSend(
      secret.token,
      chatId,
      body,
      attachment,
      needsHumanAgentTag(account.kind, lastInboundAt, new Date()),
    );
  }
  throw new Error("Отправка в этот канал пока не поддерживается");
}

const ACCOUNT_COLUMNS =
  "id, external_chat_id, last_inbound_at, account:crm_channel_accounts(id, kind, status, external_id, waba_id)";

/**
 * Ответ сотрудника в диалог. `user` — клиент от имени сотрудника: диалог
 * читается через RLS (не видит — отправить не может).
 */
export async function sendToConversation(input: {
  user: SupabaseClient;
  userId: string;
  conversationId: string;
  body: string;
  file: File | null;
}): Promise<{ id: string }> {
  const body = input.body.trim();
  if (!body && !input.file) throw new Error("Сообщение пустое");
  if (input.file && input.file.size > CRM_MAX_UPLOAD) throw new Error("Файл больше 20 МБ");

  const { data: conv, error } = await input.user
    .from("crm_conversations")
    .select(ACCOUNT_COLUMNS)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const account = (conv as { account?: OutAccount | null } | null)?.account;
  if (!conv || !account) throw new Error("Диалог не найден");
  if (account.status === "disabled") throw new Error("Аккаунт канала отключён");

  const secret = await loadSecret(account.id);
  if (!secret) throw new Error("У аккаунта нет токена — подключите его заново");
  const admin = getSupabaseAdmin();
  const chatId = conv.external_chat_id as string;

  // Файл — сначала в бакет (Messenger и Instagram забирают его по ссылке).
  let out: OutFile | null = null;
  if (input.file) {
    const path = `${input.conversationId}/out-${randomBytes(6).toString("hex")}-${safeFileName(input.file.name)}`;
    const { error: upErr } = await admin.storage
      .from(CRM_MEDIA_BUCKET)
      .upload(path, await input.file.arrayBuffer(), {
        contentType: input.file.type || undefined,
      });
    if (upErr) throw new Error("Не удалось сохранить файл");
    out = { file: input.file, path };
  }

  let externalId: string;
  try {
    externalId = await deliver(
      account,
      secret,
      chatId,
      body,
      out,
      (conv.last_inbound_at as string | null) ?? null,
    );
  } catch (e) {
    if (out) await admin.storage.from(CRM_MEDIA_BUCKET).remove([out.path]);
    const note = channelError(e);
    if (tokenRejected(e))
      await admin
        .from("crm_channel_accounts")
        .update({ status: "error", status_note: note })
        .eq("id", account.id);
    throw new Error(note);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", input.userId)
    .maybeSingle();
  const { data: msg, error: insErr } = await admin
    .from("crm_messages")
    .insert({
      conversation_id: input.conversationId,
      direction: "out",
      body: body || null,
      external_id: externalId || null,
      status: "sent",
      sent_by: input.userId,
      sent_by_name: (profile?.full_name as string | null)?.trim() || null,
      attachments: out
        ? [
            {
              kind: attachmentKind(out.file.type),
              path: out.path,
              name: out.file.name,
              mime: out.file.type || null,
              size: out.file.size,
            },
          ]
        : [],
    })
    .select("id")
    .single();
  // Сообщение ушло клиенту — сбой записи не должен выглядеть как «не отправлено».
  if (insErr) {
    console.error("[crm] out message:", insErr.message);
    return { id: "" };
  }
  return { id: msg.id as string };
}

/**
 * Сообщение автоматизации этапа (без сотрудника): отправить в диалог и
 * записать как автоматическое. Ошибка — исключение с текстом для ленты сделки.
 */
export async function sendAutoMessage(conversationId: string, body: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: conv, error } = await admin
    .from("crm_conversations")
    .select(ACCOUNT_COLUMNS)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const account = (conv as { account?: OutAccount | null } | null)?.account;
  if (!conv || !account || account.status !== "active")
    throw new Error("Аккаунт канала недоступен");
  const secret = await loadSecret(account.id);
  if (!secret) throw new Error("У аккаунта нет токена");
  let externalId: string;
  try {
    externalId = await deliver(account, secret, conv.external_chat_id as string, body, null);
  } catch (e) {
    throw new Error(channelError(e));
  }
  const { error: insErr } = await admin.from("crm_messages").insert({
    conversation_id: conversationId,
    direction: "out",
    body,
    external_id: externalId || null,
    status: "sent",
    auto: true,
  });
  if (insErr) console.error("[crm] auto message:", insErr.message);
}

// Шаблоны WhatsApp --------------------------------------------------------------

type WaAccount = {
  id: string;
  kind: string;
  status: string;
  external_id: string | null;
  waba_id: string | null;
  studio_id: string | null;
};

async function waAccount(accountId: string): Promise<{ account: WaAccount; secret: Secret }> {
  const { data } = await getSupabaseAdmin()
    .from("crm_channel_accounts")
    .select("id, kind, status, external_id, waba_id, studio_id")
    .eq("id", accountId)
    .maybeSingle();
  const account = data as WaAccount | null;
  if (!account || account.kind !== "whatsapp") throw new Error("Аккаунт WhatsApp не найден");
  if (!account.waba_id)
    throw new Error("У аккаунта не указан ID аккаунта WhatsApp Business — подключите его заново");
  const secret = await loadSecret(account.id);
  if (!secret) throw new Error("У аккаунта нет токена — подключите его заново");
  return { account, secret };
}

const WA_EXAMPLE: Record<string, string> = {
  name: "Анна",
  studio: "Lady Stretch",
  text: "завтра в 19:00",
};

/**
 * Новый шаблон: текст с {имя}, {клуб} и {текст} переводится в {{1}}… и
 * уходит на проверку Meta (до 24 часов). Статус потом приходит вебхуком и
 * при «Обновить статусы».
 */
export async function createWaTemplate(input: {
  accountId: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  body: string;
  footer: string | null;
  userId: string;
}): Promise<{ id: string; status: string }> {
  const { account, secret } = await waAccount(input.accountId);
  const { body, vars } = toWaTemplate(input.body.trim());
  const problem = waBodyProblem(body);
  if (problem) throw new Error(problem);
  let created;
  try {
    created = await waTemplateCreate(secret.token, account.waba_id!, {
      name: input.name,
      language: input.language,
      category: input.category,
      body,
      footer: input.footer,
      examples: vars.map((v) => WA_EXAMPLE[v] ?? "текст"),
    });
  } catch (e) {
    throw new Error(channelError(e));
  }
  const { data, error } = await getSupabaseAdmin()
    .from("crm_wa_templates")
    .upsert(
      {
        account_id: account.id,
        name: input.name,
        language: input.language,
        category: created.category ?? input.category,
        body,
        footer: input.footer,
        vars,
        status: created.status ?? "PENDING",
        rejected_reason: null,
        meta_id: created.id,
        created_by: input.userId,
        updated_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      },
      { onConflict: "account_id,name,language" },
    )
    .select("id, status")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, status: data.status as string };
}

/**
 * Сверить шаблоны аккаунта с Meta: статусы, причины отказа; шаблоны,
 * созданные в кабинете Meta, появляются у нас, удалённые там — исчезают.
 */
export async function syncWaTemplates(accountId: string): Promise<number> {
  const { account, secret } = await waAccount(accountId);
  const admin = getSupabaseAdmin();
  let remote;
  try {
    remote = await waTemplatesList(secret.token, account.waba_id!);
  } catch (e) {
    throw new Error(channelError(e));
  }
  const { data: local } = await admin
    .from("crm_wa_templates")
    .select("id, name, language, meta_id")
    .eq("account_id", account.id);
  const now = new Date().toISOString();
  const seen = new Set<string>();
  for (const r of remote) {
    const mine = (local ?? []).find(
      (l) => l.meta_id === r.id || (l.name === r.name && l.language === r.language),
    );
    const patch = {
      status: r.status,
      category: r.category,
      rejected_reason: r.rejected_reason && r.rejected_reason !== "NONE" ? r.rejected_reason : null,
      meta_id: r.id,
      synced_at: now,
    };
    if (mine) {
      seen.add(mine.id as string);
      await admin.from("crm_wa_templates").update(patch).eq("id", mine.id);
    } else {
      const body = r.components?.find((c) => c.type === "BODY")?.text;
      if (!body || !["MARKETING", "UTILITY", "AUTHENTICATION"].includes(r.category)) continue;
      await admin.from("crm_wa_templates").insert({
        ...patch,
        account_id: account.id,
        name: r.name,
        language: r.language,
        body: body.slice(0, 1024),
        footer: r.components?.find((c) => c.type === "FOOTER")?.text?.slice(0, 60) ?? null,
        // Что значат переменные шаблона из кабинета Meta, мы не знаем.
        vars: Array.from({ length: waVarCount(body) }, () => "text"),
      });
    }
  }
  const gone = (local ?? []).filter((l) => !seen.has(l.id as string)).map((l) => l.id as string);
  if (gone.length) await admin.from("crm_wa_templates").delete().in("id", gone);
  return remote.length;
}

/** Фоновая сверка: аккаунты, у которых есть шаблоны на проверке. */
export async function syncPendingWaTemplates(): Promise<void> {
  const { data } = await getSupabaseAdmin()
    .from("crm_wa_templates")
    .select("account_id")
    .in("status", ["PENDING", "IN_APPEAL"]);
  for (const id of new Set((data ?? []).map((r) => r.account_id as string)))
    await syncWaTemplates(id).catch((e) =>
      console.error("[crm] шаблоны WhatsApp:", e instanceof Error ? e.message : e),
    );
}

export async function deleteWaTemplate(templateId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: t } = await admin
    .from("crm_wa_templates")
    .select("id, account_id, name, meta_id")
    .eq("id", templateId)
    .maybeSingle();
  if (!t) return;
  const { account, secret } = await waAccount(t.account_id as string);
  try {
    await waTemplateDelete(
      secret.token,
      account.waba_id!,
      t.name as string,
      (t.meta_id as string | null) ?? null,
    );
  } catch (e) {
    // В Meta шаблона уже нет — убираем и у себя.
    if (!(e instanceof MetaError) || ![100, 132001].includes(e.code))
      throw new Error(channelError(e));
  }
  const { error } = await admin.from("crm_wa_templates").delete().eq("id", templateId);
  if (error) throw new Error(error.message);
}

/**
 * Отправить одобренный шаблон: в диалог (окно 24 ч закрыто) или первым — по
 * номеру (контакт и диалог заводятся). `user` — клиент от имени сотрудника:
 * диалог и право CRM проверяются через RLS.
 */
export async function sendWaTemplateMessage(input: {
  user: SupabaseClient;
  userId: string;
  templateId: string;
  values: string[];
  conversationId?: string;
  start?: { accountId: string; phone: string; name: string; clientId: string | null };
}): Promise<{ conversationId: string }> {
  const admin = getSupabaseAdmin();
  const { data: tpl } = await admin
    .from("crm_wa_templates")
    .select("id, account_id, name, language, body, status")
    .eq("id", input.templateId)
    .maybeSingle();
  if (!tpl) throw new Error("Шаблон не найден");
  if (tpl.status !== "APPROVED") throw new Error("Шаблон ещё не одобрен Meta");
  const count = waVarCount(tpl.body as string);
  const values = input.values.slice(0, count).map((v) => v.trim());
  if (values.length < count || values.some((v) => !v))
    throw new Error("Заполните все переменные шаблона");
  const { account, secret } = await waAccount(tpl.account_id as string);
  if (account.status !== "active") throw new Error("Аккаунт WhatsApp отключён");

  let conversationId: string;
  let chatId: string;
  if (input.conversationId) {
    const { data: conv, error } = await input.user
      .from("crm_conversations")
      .select("id, external_chat_id, account_id")
      .eq("id", input.conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conv || conv.account_id !== account.id) throw new Error("Диалог не найден");
    conversationId = conv.id as string;
    chatId = conv.external_chat_id as string;
  } else if (input.start && input.start.accountId === account.id) {
    // Писать первым может тот, кто потом увидит этот диалог.
    const { data: canView } = await input.user.rpc("auth_crm_can_view");
    const { data: studios, error } = await input.user.rpc("auth_crm_studio_ids");
    if (error) throw new Error(error.message);
    if (
      canView !== true ||
      (account.studio_id && !((studios as string[] | null) ?? []).includes(account.studio_id))
    )
      throw new Error("Недостаточно прав, чтобы писать с этого номера");
    const phone = waPhone(input.start.phone);
    if (!phone) throw new Error("Неверный номер телефона");
    const { data, error: startErr } = await admin.rpc("crm_conversation_start", {
      p_account: account.id,
      p_chat: phone,
      p_name: input.start.name,
      p_phone: `+${phone}`,
      p_client: input.start.clientId,
    });
    if (startErr) throw new Error(startErr.message);
    conversationId = (data as { conversation_id: string }).conversation_id;
    chatId = phone;
  } else {
    throw new Error("Не указано, куда отправить шаблон");
  }

  let externalId: string;
  try {
    externalId = await waSendTemplate(secret.token, account.external_id!, chatId, {
      name: tpl.name as string,
      language: tpl.language as string,
      values,
    });
  } catch (e) {
    throw new Error(channelError(e));
  }
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", input.userId)
    .maybeSingle();
  const { error: insErr } = await admin.from("crm_messages").insert({
    conversation_id: conversationId,
    direction: "out",
    body: renderWaTemplate(tpl.body as string, values),
    external_id: externalId || null,
    status: "sent",
    sent_by: input.userId,
    sent_by_name: (profile?.full_name as string | null)?.trim() || null,
    template_id: tpl.id,
  });
  if (insErr) console.error("[crm] template message:", insErr.message);
  return { conversationId };
}
