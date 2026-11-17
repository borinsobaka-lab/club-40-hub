/**
 * Telegram Bot API — сеть (только сервер). Токен бота — секрет аккаунта
 * канала (crm_channel_secrets), в логи и ответы браузеру не попадает.
 */
const API = "https://api.telegram.org";
const TIMEOUT_MS = 20_000;
/** Bot API отдаёт файлы до 20 МБ. */
export const TG_MAX_DOWNLOAD = 20 * 1024 * 1024;

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

async function tg<T>(
  token: string,
  method: string,
  body?: Record<string, unknown> | FormData,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      ...(body instanceof FormData
        ? { body }
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Текст ошибки fetch содержит адрес с токеном — наружу не отдаём.
    throw new TelegramError("Telegram не отвечает", 0);
  }
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
    description?: string;
    error_code?: number;
  } | null;
  if (!json?.ok)
    throw new TelegramError(
      json?.description ?? `Ошибка Telegram ${res.status}`,
      json?.error_code ?? res.status,
    );
  return json.result as T;
}

export type TgBot = { id: number; username?: string; first_name?: string };

export const tgGetMe = (token: string) => tg<TgBot>(token, "getMe");

export const tgSetWebhook = (token: string, url: string, secret: string) =>
  tg<boolean>(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });

export const tgDeleteWebhook = (token: string) => tg<boolean>(token, "deleteWebhook", {});

export async function tgSendText(token: string, chatId: string, text: string): Promise<string> {
  const msg = await tg<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text });
  return String(msg.message_id);
}

export async function tgSendFile(
  token: string,
  chatId: string,
  file: Blob,
  name: string,
  caption: string | null,
): Promise<string> {
  const image =
    file.type.startsWith("image/") && file.type !== "image/gif" && file.size < 10 * 1024 * 1024;
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) form.set("caption", caption.slice(0, 1024));
  form.set(image ? "photo" : "document", file, name);
  const msg = await tg<{ message_id: number }>(token, image ? "sendPhoto" : "sendDocument", form);
  return String(msg.message_id);
}

/** Файл входящего сообщения; null — больше 20 МБ или недоступен. */
export async function tgDownload(token: string, fileId: string): Promise<ArrayBuffer | null> {
  try {
    const info = await tg<{ file_path?: string; file_size?: number }>(token, "getFile", {
      file_id: fileId,
    });
    if (!info.file_path || (info.file_size ?? 0) > TG_MAX_DOWNLOAD) return null;
    const res = await fetch(`${API}/file/bot${token}/${info.file_path}`, {
      signal: AbortSignal.timeout(60_000),
    });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
