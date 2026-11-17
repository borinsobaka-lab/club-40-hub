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
  return e instanceof Error ? e.message : "Ошибка канала";
}

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

/** Включить (вебхук заново) или отключить (вебхук снят, переписка остаётся). */
export async function setChannelEnabled(accountId: string, enabled: boolean): Promise<void> {
  const admin = getSupabaseAdmin();
  const secret = await loadSecret(accountId);
  if (!secret) throw new Error("У аккаунта нет токена — подключите его заново");
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
  if (secret) await tgDeleteWebhook(secret.token).catch(() => {});
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

// Отправка --------------------------------------------------------------------

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
    .select("id, external_chat_id, account:crm_channel_accounts(id, kind, status)")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const account = (conv as { account?: { id: string; kind: string; status: string } | null } | null)
    ?.account;
  if (!conv || !account) throw new Error("Диалог не найден");
  if (account.status === "disabled") throw new Error("Аккаунт канала отключён");
  if (account.kind !== "telegram_bot")
    throw new Error("Отправка в этот канал пока не поддерживается");

  const secret = await loadSecret(account.id);
  if (!secret) throw new Error("У аккаунта нет токена — подключите его заново");
  const admin = getSupabaseAdmin();
  const chatId = conv.external_chat_id as string;

  let externalId: string;
  try {
    externalId = input.file
      ? await tgSendFile(secret.token, chatId, input.file, input.file.name, body || null)
      : await tgSendText(secret.token, chatId, body);
  } catch (e) {
    const note = channelError(e);
    if (e instanceof TelegramError && e.code === 401)
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
      external_id: externalId,
      status: "sent",
      sent_by: input.userId,
      sent_by_name: (profile?.full_name as string | null)?.trim() || null,
    })
    .select("id")
    .single();
  // Сообщение ушло клиенту — сбой записи не должен выглядеть как «не отправлено».
  if (insErr) {
    console.error("[crm] out message:", insErr.message);
    return { id: "" };
  }
  if (input.file) {
    const path = `${input.conversationId}/${msg.id}-${safeFileName(input.file.name)}`;
    const { error: upErr } = await admin.storage
      .from(CRM_MEDIA_BUCKET)
      .upload(path, await input.file.arrayBuffer(), {
        contentType: input.file.type || undefined,
        upsert: true,
      });
    if (!upErr)
      await admin
        .from("crm_messages")
        .update({
          attachments: [
            {
              kind: attachmentKind(input.file.type),
              path,
              name: input.file.name,
              mime: input.file.type || null,
              size: input.file.size,
            },
          ],
        })
        .eq("id", msg.id);
  }
  return { id: msg.id as string };
}
