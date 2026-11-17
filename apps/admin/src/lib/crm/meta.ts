/**
 * Каналы Meta — WhatsApp Cloud API, Messenger (страницы Facebook) и
 * Instagram: разбор вебхука без сети (тест — meta.test.ts). Форматы — по
 * документации Meta на 2026-11-17 (Graph API v27.0). Эхо собственных
 * сообщений и служебные события пропускаем.
 */
import type { IncomingFile } from "./telegram";

export type MetaKind = "whatsapp" | "facebook" | "instagram";

export type MetaFile = Omit<IncomingFile, "fileId"> & {
  /** WhatsApp: id медиа (скачивается через Graph API). */
  mediaId: string | null;
  /** Messenger и Instagram: прямая ссылка. */
  url: string | null;
};

export type MetaIncoming = {
  kind: MetaKind;
  /** Наш аккаунт: phone_number_id, id страницы или id аккаунта Instagram. */
  accountExternalId: string;
  chatId: string;
  sender: {
    external_id: string;
    username: string | null;
    name: string | null;
    phone: string | null;
  };
  message: { external_id: string; body: string | null; sent_at: string };
  files: MetaFile[];
};

/** Meta изменила статус шаблона WhatsApp (проверка, пауза, отключение). */
export type MetaTemplateEvent = { metaId: string; status: string; reason: string | null };

export type MetaStatus = {
  externalId: string;
  status: "sent" | "delivered" | "read" | "failed";
  error: string | null;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;

const EXT: Record<string, string> = { image: "jpg", video: "mp4", audio: "ogg", file: "bin" };
const WA_MEDIA: Record<string, MetaFile["kind"]> = {
  image: "image",
  sticker: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
  document: "file",
};

function iso(ts: unknown): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  // WhatsApp — секунды, Messenger и Instagram — миллисекунды.
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

function whatsapp(value: Rec, out: MetaIncoming[], statuses: MetaStatus[]) {
  const phoneNumberId = str(rec(value.metadata).phone_number_id);
  if (!phoneNumberId) return;
  const contacts = arr(value.contacts);
  for (const m of arr(value.messages)) {
    const id = str(m.id);
    // Телефона может не быть (docs: wa_id опускается) — тогда id пользователя.
    const from = str(m.from) ?? str(m.from_user_id);
    if (!id || !from) continue;
    const type = str(m.type) ?? "";
    const contact =
      contacts.find((c) => str(c.wa_id) === from || str(c.user_id) === from) ?? contacts[0];
    const files: MetaFile[] = [];
    let body: string | null = null;
    if (type === "text") body = str(rec(m.text).body);
    else if (type in WA_MEDIA) {
      const media = rec(m[type]);
      const kind = WA_MEDIA[type];
      const mediaId = str(media.id);
      body = str(media.caption);
      if (mediaId)
        files.push({
          mediaId,
          url: null,
          kind,
          name: str(media.filename) ?? `${kind}-${id.slice(-8)}.${EXT[kind]}`,
          mime: str(media.mime_type),
          size: null,
        });
    } else if (type === "location") {
      const l = rec(m.location);
      body = `[геопозиция: ${str(l.latitude)}, ${str(l.longitude)}]`;
    } else if (type === "button") body = str(rec(m.button).text);
    else if (type === "interactive") {
      const i = rec(m.interactive);
      body = str(rec(i.button_reply).title) ?? str(rec(i.list_reply).title);
    } else if (type === "reaction") continue;
    else body = `[сообщение: ${type || "неизвестный вид"}]`;
    if (!body && files.length === 0) continue;
    out.push({
      kind: "whatsapp",
      accountExternalId: phoneNumberId,
      chatId: from,
      sender: {
        external_id: from,
        username: null,
        name: str(rec(contact?.profile).name),
        phone: str(m.from) ? `+${from.replace(/\D/g, "")}` : null,
      },
      message: { external_id: id, body, sent_at: iso(m.timestamp) },
      files,
    });
  }
  for (const s of arr(value.statuses)) {
    const id = str(s.id);
    const status = str(s.status);
    if (!id || !status || !["sent", "delivered", "read", "failed"].includes(status)) continue;
    const e = arr(s.errors)[0];
    statuses.push({
      externalId: id,
      status: status as MetaStatus["status"],
      error: e ? [str(e.code), str(e.title) ?? str(e.message)].filter(Boolean).join(": ") : null,
    });
  }
}

function messaging(
  kind: "facebook" | "instagram",
  accountId: string,
  events: Rec[],
  out: MetaIncoming[],
) {
  for (const ev of events) {
    const message = rec(ev.message);
    const mid = str(message.mid);
    const sender = str(rec(ev.sender).id);
    if (!mid || !sender || message.is_echo === true || sender === accountId) continue;
    const files: MetaFile[] = [];
    for (const a of arr(message.attachments)) {
      const url = str(rec(a.payload).url);
      const type = str(a.type) ?? "file";
      const k: MetaFile["kind"] =
        type === "image" || type === "video" || type === "audio" ? type : "file";
      if (url)
        files.push({
          mediaId: null,
          url,
          kind: k,
          name: `${k}-${mid.slice(-8)}.${EXT[k]}`,
          mime: null,
          size: null,
        });
    }
    const body = str(message.text);
    if (!body && files.length === 0) continue;
    out.push({
      kind,
      accountExternalId: accountId,
      chatId: sender,
      sender: { external_id: sender, username: null, name: null, phone: null },
      message: { external_id: mid, body, sent_at: iso(ev.timestamp) },
      files,
    });
  }
}

export function parseMetaWebhook(payload: unknown): {
  messages: MetaIncoming[];
  statuses: MetaStatus[];
  templates: MetaTemplateEvent[];
} {
  const root = rec(payload);
  const object = str(root.object);
  const messages: MetaIncoming[] = [];
  const statuses: MetaStatus[] = [];
  const templates: MetaTemplateEvent[] = [];
  for (const entry of arr(root.entry)) {
    const entryId = str(entry.id);
    if (object === "whatsapp_business_account") {
      for (const c of arr(entry.changes)) {
        if (c.field === "messages") whatsapp(rec(c.value), messages, statuses);
        if (c.field === "message_template_status_update") {
          const v = rec(c.value);
          const metaId = str(v.message_template_id);
          const event = str(v.event);
          // REINSTATED / UNARCHIVED — шаблон снова работает.
          const status = event === "REINSTATED" || event === "UNARCHIVED" ? "APPROVED" : event;
          const reason = str(v.reason);
          if (metaId && status)
            templates.push({
              metaId,
              status,
              reason:
                [
                  reason && reason !== "NONE" ? reason : null,
                  str(rec(v.rejection_info).recommendation),
                ]
                  .filter(Boolean)
                  .join(". ") || null,
            });
        }
      }
    } else if ((object === "page" || object === "instagram") && entryId) {
      const kind = object === "page" ? "facebook" : "instagram";
      messaging(kind, entryId, arr(entry.messaging), messages);
      // Часть установок присылает то же событие в changes[].value.
      messaging(
        kind,
        entryId,
        arr(entry.changes)
          .filter((c) => c.field === "messages")
          .map((c) => rec(c.value)),
        messages,
      );
    }
  }
  return { messages, statuses, templates };
}

const HOUR = 3600_000;

/**
 * Можно ли ещё ответить свободным текстом. WhatsApp — 24 часа после
 * сообщения клиента (дальше только шаблон); Instagram и Facebook — 7 дней
 * (после 24 часов — с меткой «оператор», HUMAN_AGENT); Telegram — всегда.
 */
export function replyWindowOpen(kind: string, lastInboundAt: string | null, now: Date): boolean {
  if (kind !== "whatsapp" && kind !== "instagram" && kind !== "facebook") return true;
  if (!lastInboundAt) return false;
  const age = now.getTime() - new Date(lastInboundAt).getTime();
  return age < (kind === "whatsapp" ? 24 : 7 * 24) * HOUR;
}

/** Instagram и Facebook позже 24 часов: ответ уходит с меткой HUMAN_AGENT. */
export function needsHumanAgentTag(kind: string, lastInboundAt: string | null, now: Date): boolean {
  if (kind !== "instagram" && kind !== "facebook") return false;
  if (!lastInboundAt) return true;
  return now.getTime() - new Date(lastInboundAt).getTime() >= 24 * HOUR;
}
