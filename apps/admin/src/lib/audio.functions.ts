import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Адрес сервиса «Аудиоаналитики» (services/audio-analytics) — переменная
 * окружения сервера админки AUDIO_API_URL (например, https://audio.base40.fit).
 * Браузер ходит в сервис сам (аудио смены, загрузка сборок, состояние) со своим
 * токеном Supabase; сервис сам проверяет права. Не задан — null: разделы
 * работают по базе, а плеер, загрузка и состояние сервиса показывают пояснение.
 */
export const getAudioServiceConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const raw = process.env.AUDIO_API_URL?.trim() ?? "";
    const url = /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : null;
    return { url };
  });
