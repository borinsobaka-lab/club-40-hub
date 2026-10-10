import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isHttpUrl } from "@/lib/format";

/**
 * Бакеты Storage для картинок админки. В таблицах хранится ПУТЬ внутри бакета
 * (или полный URL у старых записей), картинку получаем по нему.
 *
 * public — getPublicUrl (синхронно). signed — подписанная ссылка на час: так
 * исторически сделаны фото тренеров и тренировок. По db/*.sql эти бакеты тоже
 * публичные; если в живой базе это подтвердится — перевести на public и
 * убрать запрос на каждую картинку.
 */
export const STORAGE_BUCKETS = {
  news: { id: "news-media", access: "public" },
  services: { id: "services-media", access: "public" },
  memberships: { id: "memberships-media", access: "public" },
  trainers: { id: "trainer-photos", access: "signed" },
  workouts: { id: "workout-photos", access: "signed" },
  studios: { id: "studio-logos", access: "public" },
} as const;

export type StorageBucket = keyof typeof STORAGE_BUCKETS;

const SIGNED_URL_TTL = 3600;

/** URL картинки по значению из таблицы (путь в бакете или полный URL). */
export function useStorageUrl(bucket: StorageBucket, value: string | null | undefined) {
  const { id, access } = STORAGE_BUCKETS[bucket];
  const isPath = !!value && !isHttpUrl(value);
  const signed = useQuery({
    queryKey: ["storage-url", id, value],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(id)
        .createSignedUrl(value as string, SIGNED_URL_TTL);
      if (error) return null;
      return data?.signedUrl ?? null;
    },
    enabled: isPath && access === "signed",
    // Ссылка живёт час — перезапрашиваем заранее.
    staleTime: (SIGNED_URL_TTL - 600) * 1000,
  });

  if (!value) return null;
  if (!isPath) return value;
  if (access === "signed") return signed.data ?? null;
  return supabase.storage.from(id).getPublicUrl(value).data.publicUrl ?? null;
}

/**
 * Загружает файл в бакет в папку `folder` под случайным именем и возвращает
 * путь — его и сохраняем в таблицу.
 */
export async function uploadToStorage(bucket: StorageBucket, folder: string, file: File) {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKETS[bucket].id).upload(path, file, {
    upsert: false,
    contentType: file.type || (ext === "svg" ? "image/svg+xml" : undefined),
  });
  if (error) throw new Error(error.message);
  return path;
}
