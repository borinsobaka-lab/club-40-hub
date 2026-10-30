import { useCallback, useSyncExternalStore } from "react";

/**
 * Выбранные точки продажи «Аудиоаналитики» (фильтр «Смен» и «Дашборда»):
 * пусто — все точки. Помнится между заходами (localStorage audio_locations,
 * как последняя база знаний).
 */
const KEY = "audio_locations";
const EMPTY: string[] = [];

let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAudioLocations(): [string[], (ids: string[]) => void] {
  const ids = useSyncExternalStore(subscribe, read, () => EMPTY);
  const set = useCallback((next: string[]) => {
    cache = [...next].sort();
    try {
      window.localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // приватный режим — выбор живёт до перезагрузки
    }
    listeners.forEach((l) => l());
  }, []);
  return [ids, set];
}
