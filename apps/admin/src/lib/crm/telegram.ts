/**
 * Telegram-бот как канал CRM — разбор входящего обновления Bot API без сети
 * (тест — telegram.test.ts). Берём только личные сообщения людей: группы,
 * каналы, сообщения ботов и правки пропускаем.
 */
export type IncomingFile = {
  fileId: string;
  kind: "image" | "video" | "audio" | "file";
  name: string;
  mime: string | null;
  size: number | null;
};

export type IncomingMessage = {
  chatId: string;
  sender: {
    external_id: string;
    username: string | null;
    name: string | null;
    phone: string | null;
  };
  message: { external_id: string; body: string | null; sent_at: string };
  files: IncomingFile[];
};

type TgFile = { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
type TgMessage = {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number; type?: string };
  from?: {
    id?: number;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  photo?: TgFile[];
  document?: TgFile;
  video?: TgFile;
  video_note?: TgFile;
  voice?: TgFile;
  audio?: TgFile;
  sticker?: TgFile & { emoji?: string };
  contact?: { phone_number?: string; user_id?: number };
  location?: { latitude?: number; longitude?: number };
};

const EXT: Record<IncomingFile["kind"], string> = {
  image: "jpg",
  video: "mp4",
  audio: "ogg",
  file: "bin",
};

function file(kind: IncomingFile["kind"], f: TgFile | undefined, id: number): IncomingFile[] {
  if (!f?.file_id) return [];
  return [
    {
      fileId: f.file_id,
      kind,
      name: f.file_name?.trim() || `${kind}-${id}.${EXT[kind]}`,
      mime: f.mime_type ?? null,
      size: typeof f.file_size === "number" ? f.file_size : null,
    },
  ];
}

export function parseTelegramUpdate(update: unknown): IncomingMessage | null {
  const m = (update as { message?: TgMessage } | null)?.message;
  if (!m || typeof m.message_id !== "number") return null;
  if (m.chat?.type !== "private" || typeof m.chat.id !== "number") return null;
  if (!m.from || m.from.is_bot || typeof m.from.id !== "number") return null;

  const id = m.message_id;
  // Фото приходит набором размеров — берём самый большой (последний).
  const files = [
    ...file("image", m.photo?.[m.photo.length - 1], id),
    ...file("video", m.video ?? m.video_note, id),
    ...file("audio", m.voice ?? m.audio, id),
    ...file("file", m.document, id),
  ];
  const parts = [m.text ?? m.caption ?? ""];
  if (m.sticker) parts.push(`[стикер ${m.sticker.emoji ?? ""}]`.replace(" ]", "]"));
  if (m.contact?.phone_number) parts.push(`[контакт: ${m.contact.phone_number}]`);
  if (m.location && typeof m.location.latitude === "number")
    parts.push(`[геопозиция: ${m.location.latitude}, ${m.location.longitude}]`);
  const body = parts.filter(Boolean).join("\n").trim() || null;
  if (!body && files.length === 0) return null;

  const name = [m.from.first_name, m.from.last_name].filter(Boolean).join(" ").trim() || null;
  // Телефон — только если человек поделился СВОИМ контактом.
  const phone =
    m.contact?.phone_number && m.contact.user_id === m.from.id
      ? `+${m.contact.phone_number.replace(/\D/g, "")}`
      : null;
  return {
    chatId: String(m.chat.id),
    sender: { external_id: String(m.from.id), username: m.from.username ?? null, name, phone },
    message: {
      external_id: String(id),
      body,
      sent_at: new Date((m.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    },
    files,
  };
}

/** Токен бота от @BotFather: «123456:AA…». */
export function isBotToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim());
}

/** Имя файла для бакета: без путей и странных символов. */
export function safeFileName(name: string): string {
  const clean = name
    .replace(/[/\\]/g, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(-120);
  return clean || "file";
}

/** Вид вложения по MIME-типу (исходящий файл). */
export function attachmentKind(mime: string | null | undefined): IncomingFile["kind"] {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  return "file";
}
