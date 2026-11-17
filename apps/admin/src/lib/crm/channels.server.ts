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
import { parseMetaWebhook, type MetaIncoming, type MetaKind } from "./meta";
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
  waSendText,
  waSubscribe,
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
  const { messages, statuses } = parseMetaWebhook(payload);
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

type OutAccount = { id: string; kind: string; status: string; external_id: string | null };
type OutFile = { file: File; path: string };

/** Отправить в канал аккаунта; возвращает id сообщения в канале. */
async function deliver(
  account: OutAccount,
  secret: Secret,
  chatId: string,
  body: string,
  out: OutFile | null,
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
    return pageSend(secret.token, chatId, body, attachment);
  }
  throw new Error("Отправка в этот канал пока не поддерживается");
}

const ACCOUNT_COLUMNS =
  "id, external_chat_id, account:crm_channel_accounts(id, kind, status, external_id)";

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
    externalId = await deliver(account, secret, chatId, body, out);
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
