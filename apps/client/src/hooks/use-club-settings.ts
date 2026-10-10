import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

let cached: ClubSettings | null = null;
let inflight: Promise<ClubSettings> | null = null;

// club_settings — глобальный синглтон (одна строка, id = true), обе стороны
// читают/пишут его без привязки к студии. В живой БД колонка studio_id уже
// существует (в db/club_settings.sql её нет — дрейф схемы), но пока настройки
// не станут пер-студийными осознанно, фильтровать здесь нечего.
// Ошибку пробрасываем: раньше сбой запроса превращался в DEFAULTS и
// кэшировался до перезагрузки страницы (без быстрых действий и с чужим
// дедлайном отмены), а отклонённый промис оставался в inflight навсегда.
async function fetchSettings(): Promise<ClubSettings> {
  const { data, error } = await supabase
    .from("club_settings")
    .select("write_url, call_url, feedback_url, cancel_booking_minutes")
    .maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULTS, ...data } : DEFAULTS;
}

export function useClubSettings(): ClubSettings {
  const [s, setS] = useState<ClubSettings>(cached ?? DEFAULTS);
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    if (!inflight) inflight = fetchSettings();
    const current = inflight;
    current
      .then((v) => {
        cached = v;
        if (!cancelled) setS(v);
      })
      .catch(() => {
        // Остаёмся на DEFAULTS; следующее монтирование попробует снова.
      })
      .finally(() => {
        if (inflight === current) inflight = null;
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return s;
}

export function formatCancelDeadline(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}ч ${m}мин`;
  if (h) return `${h}ч`;
  return `${m}мин`;
}
