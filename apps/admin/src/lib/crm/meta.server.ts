/**
 * Graph API Meta — сеть (только сервер): WhatsApp Cloud API, Messenger и
 * Instagram (через страницу Facebook и её токен). Токены — секреты аккаунта
 * канала; секрет приложения и токен проверки вебхука — переменные сервера
 * META_APP_SECRET и META_VERIFY_TOKEN. Версия API — META_GRAPH_VERSION.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TIMEOUT_MS = 20_000;
const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v27.0"}`;

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

export const metaConfigured = () =>
  !!process.env.META_APP_SECRET && !!process.env.META_VERIFY_TOKEN;

/** Подпись вебхука: X-Hub-Signature-256 = sha256=<HMAC тела секретом приложения>. */
export function metaSignatureValid(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  const got = Buffer.from(header.slice(7));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

async function call<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: Record<string, unknown> | FormData },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${graph()}/${path}`, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        init?.body instanceof FormData
          ? init.body
          : init?.body
            ? JSON.stringify(init.body)
            : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MetaError("Meta не отвечает", 0);
  }
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string; code?: number };
  } | null;
  if (!res.ok || json?.error)
    throw new MetaError(
      json?.error?.message ?? `Ошибка Meta ${res.status}`,
      json?.error?.code ?? res.status,
    );
  return json as T;
}

// WhatsApp ----------------------------------------------------------------------

export const waPhoneInfo = (token: string, phoneNumberId: string) =>
  call<{ id: string; display_phone_number?: string; verified_name?: string }>(
    token,
    `${phoneNumberId}?fields=display_phone_number,verified_name`,
  );

/** Подписать приложение на события аккаунта WhatsApp Business. */
export const waSubscribe = (token: string, wabaId: string) =>
  call<{ success: boolean }>(token, `${wabaId}/subscribed_apps`, { method: "POST" });

export async function waSendText(
  token: string,
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<string> {
  const res = await call<{ messages?: { id: string }[] }>(token, `${phoneNumberId}/messages`, {
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    },
  });
  return res.messages?.[0]?.id ?? "";
}

export async function waSendFile(
  token: string,
  phoneNumberId: string,
  to: string,
  file: File,
  caption: string | null,
): Promise<string> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", file.type || "application/octet-stream");
  form.set("file", file, file.name);
  const media = await call<{ id: string }>(token, `${phoneNumberId}/media`, { body: form });
  // Картинкой — только JPEG/PNG до 5 МБ, остальное — документом.
  const image =
    (file.type === "image/jpeg" || file.type === "image/png") && file.size <= 5 * 1024 * 1024;
  const payload = image
    ? {
        type: "image",
        image: { id: media.id, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
      }
    : {
        type: "document",
        document: {
          id: media.id,
          filename: file.name,
          ...(caption ? { caption: caption.slice(0, 1024) } : {}),
        },
      };
  const res = await call<{ messages?: { id: string }[] }>(token, `${phoneNumberId}/messages`, {
    body: { messaging_product: "whatsapp", recipient_type: "individual", to, ...payload },
  });
  return res.messages?.[0]?.id ?? "";
}

/** Файл входящего сообщения WhatsApp по id медиа; null — недоступен. */
export async function waDownload(
  token: string,
  mediaId: string,
): Promise<{ bytes: ArrayBuffer; mime: string | null } | null> {
  try {
    const info = await call<{ url?: string; mime_type?: string }>(token, mediaId);
    if (!info.url) return null;
    const res = await fetch(info.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    return res.ok ? { bytes: await res.arrayBuffer(), mime: info.mime_type ?? null } : null;
  } catch {
    return null;
  }
}

// Страница Facebook и Instagram (токен страницы) -----------------------------------

export const pageInfo = (pageToken: string) =>
  call<{
    id: string;
    name?: string;
    instagram_business_account?: { id: string; username?: string };
  }>(pageToken, "me?fields=id,name,instagram_business_account{id,username}");

/** Подписать страницу на сообщения (Messenger и связанный Instagram). */
export const pageSubscribe = (pageToken: string) =>
  call<{ success: boolean }>(pageToken, "me/subscribed_apps?subscribed_fields=messages", {
    method: "POST",
  });

/** Имя и ник собеседника; пусто — Meta не отдала (нет доступа к профилям). */
export async function messagingProfile(
  pageToken: string,
  kind: "facebook" | "instagram",
  userId: string,
): Promise<{ name: string | null; username: string | null }> {
  try {
    const fields = kind === "instagram" ? "name,username" : "first_name,last_name";
    const p = await call<{
      name?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    }>(pageToken, `${userId}?fields=${fields}`);
    const name = p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || null);
    return { name: name || null, username: p.username ?? null };
  } catch {
    return { name: null, username: null };
  }
}

/** Сообщение в Messenger или Instagram: текст и (или) вложение по ссылке. */
export async function pageSend(
  pageToken: string,
  recipientId: string,
  body: string,
  attachment: { url: string; mime: string } | null,
): Promise<string> {
  const send = (message: Record<string, unknown>) =>
    call<{ message_id?: string }>(pageToken, "me/messages", {
      body: { recipient: { id: recipientId }, messaging_type: "RESPONSE", message },
    });
  let id = "";
  if (attachment) {
    const type = attachment.mime.startsWith("image/")
      ? "image"
      : attachment.mime.startsWith("video/")
        ? "video"
        : attachment.mime.startsWith("audio/")
          ? "audio"
          : "file";
    id = (await send({ attachment: { type, payload: { url: attachment.url } } })).message_id ?? "";
  }
  if (body) id = (await send({ text: body })).message_id ?? id;
  return id;
}

export async function fetchUrl(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
