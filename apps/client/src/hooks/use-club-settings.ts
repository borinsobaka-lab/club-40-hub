import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useViewedStudioId } from "@/hooks/use-viewed-studio";

export type ClubSettings = {
  write_url: string | null;
  call_url: string | null;
  feedback_url: string | null;
  cancel_booking_minutes: number;
};

const DEFAULTS: ClubSettings = {
  write_url: null,
  call_url: null,
  feedback_url: null,
  cancel_booking_minutes: 180,
};

// Кэш на модуль по студии: настройки меняются редко, а читают их главная и
// расписание.
const cached = new Map<string, ClubSettings>();
const inflight = new Map<string, Promise<ClubSettings>>();

// «Контакты и правила» — у каждой студии свои: studio_app_settings
// (db/migrations/2026-10-11_zzzzzzzzzz_app_content_by_studio.sql, правятся в
// админке). Строки нет (новая студия) — значения по умолчанию. Клиент без
// карточки (студия неизвестна) — прежний общий синглтон club_settings.
// Ошибку пробрасываем: раньше сбой запроса превращался в DEFAULTS и
// кэшировался до перезагрузки страницы (без быстрых действий и с чужим
// дедлайном отмены), а отклонённый промис оставался в inflight навсегда.
async function fetchSettings(studioId: string | null): Promise<ClubSettings> {
  const columns = "write_url, call_url, feedback_url, cancel_booking_minutes";
  const { data, error } = studioId
    ? await supabase
        .from("studio_app_settings")
        .select(columns)
        .eq("studio_id", studioId)
        .maybeSingle()
    : await supabase.from("club_settings").select(columns).eq("id", true).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULTS, ...data } : DEFAULTS;
}

/**
 * which: "viewed" — смотримая студия (переключатель пакетного приложения:
 * кнопки главной), "home" — своя студия клиента (срок отмены его записей).
 */
export function useClubSettings(which: "viewed" | "home" = "viewed"): ClubSettings {
  const viewed = useViewedStudioId();
  const studioReady = viewed.studioReady;
  const studioId = which === "home" ? viewed.homeStudioId : viewed.studioId;
  const key = studioId ?? "";
  const [s, setS] = useState<ClubSettings>(() => cached.get(key) ?? DEFAULTS);
  useEffect(() => {
    if (!studioReady) return;
    const hit = cached.get(key);
    if (hit) {
      setS(hit);
      return;
    }
    let cancelled = false;
    let current = inflight.get(key);
    if (!current) {
      current = fetchSettings(studioId);
      inflight.set(key, current);
    }
    const promise = current;
    promise
      .then((v) => {
        cached.set(key, v);
        if (!cancelled) setS(v);
      })
      .catch(() => {
        // Остаёмся на DEFAULTS; следующее монтирование попробует снова.
      })
      .finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
    return () => {
      cancelled = true;
    };
  }, [studioReady, studioId, key]);
  return s;
}

export function formatCancelDeadline(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}ч ${m}мин`;
  if (h) return `${h}ч`;
  return `${m}мин`;
}
