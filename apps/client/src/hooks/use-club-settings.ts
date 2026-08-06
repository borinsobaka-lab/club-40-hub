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

// club_settings — глобальная таблица без studio_id (одна строка на весь клуб):
// фильтровать по студии здесь нечего. Если настройки станут пер-студийными,
// сначала меняется схема (db/club_settings.sql в репозитории админки).
async function fetchSettings(): Promise<ClubSettings> {
  const { data } = await supabase
    .from("club_settings")
    .select("write_url, call_url, feedback_url, cancel_booking_minutes")
    .maybeSingle();
  return data ? { ...DEFAULTS, ...data } : DEFAULTS;
}

export function useClubSettings(): ClubSettings {
  const [s, setS] = useState<ClubSettings>(cached ?? DEFAULTS);
  useEffect(() => {
    if (cached) return;
    if (!inflight) inflight = fetchSettings();
    inflight.then((v) => {
      cached = v;
      setS(v);
    });
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
