/**
 * Файлы статей базы знаний — закрытый бакет kb-media (только наш Storage,
 * внешних хранилищ и CDN нет — решение владельца 2026-10-24).
 *
 * В документе статьи файл хранится ссылкой `kbfile:<путь в бакете>`, а не
 * адресом: адрес подписанный и живёт час. Показать — resolveKbFileUrl
 * (подписанная ссылка, кэш до истечения). Путь — {база}/{статья}/{файл}:
 * по первой папке Storage проверяет доступ к базе.
 */
import { supabase } from "@/integrations/supabase/client";

export const KB_BUCKET = "kb-media";
export const KB_FILE_PREFIX = "kbfile:";
/** Лимит бакета — 50 МБ на файл (маленький лимит на видео — решение владельца). */
export const KB_MAX_FILE_BYTES = 50 * 1024 * 1024;

const SIGNED_TTL_S = 60 * 60;
const cache = new Map<string, { url: string; expires: number }>();

export function isKbFile(url: string | null | undefined): boolean {
  return !!url && url.startsWith(KB_FILE_PREFIX);
}

export function kbFilePath(url: string): string {
  return url.slice(KB_FILE_PREFIX.length);
}

/** Размер файла по-человечески: «12,4 МБ». */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "").replace(".", ",")} МБ`;
}

/** Имя файла в бакете: латиница и цифры, расширение — как у исходного. */
function storageName(file: File): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]?.toLowerCase() ?? "bin";
  return `${crypto.randomUUID()}.${ext}`;
}

export class KbFileTooLarge extends Error {}

/** Загрузить файл статьи; вернуть ссылку для документа (`kbfile:…`). */
export async function uploadKbFile(baseId: string, nodeId: string, file: File): Promise<string> {
  if (file.size > KB_MAX_FILE_BYTES) {
    throw new KbFileTooLarge(
      `Файл «${file.name}» — ${formatFileSize(file.size)}, а можно до ${formatFileSize(KB_MAX_FILE_BYTES)}. Сожмите его или разделите.`,
    );
  }
  const path = `${baseId}/${nodeId}/${storageName(file)}`;
  const { error } = await supabase.storage.from(KB_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return `${KB_FILE_PREFIX}${path}`;
}

/** Адрес для показа: у своих файлов — подписанная ссылка на час. */
export async function resolveKbFileUrl(url: string): Promise<string> {
  if (!isKbFile(url)) return url;
  const path = kbFilePath(url);
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase.storage
    .from(KB_BUCKET)
    .createSignedUrl(path, SIGNED_TTL_S);
  if (error || !data) throw new Error(error?.message ?? "Файл недоступен");
  cache.set(path, { url: data.signedUrl, expires: Date.now() + SIGNED_TTL_S * 1000 });
  return data.signedUrl;
}
