/**
 * Тёмная тема раздела «База знаний» (решение владельца 2026-10-25): кнопка
 * справа от поиска в шапке базы красит шапку и страницу (не меню слева —
 * оно и так тёмное). Выбор — в localStorage этого браузера; на сервере и до
 * гидратации — светлая.
 */
import { useCallback, useSyncExternalStore } from "react";

const KEY = "kb_theme";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "dark";
  } catch {
    return false;
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Другая вкладка переключила — и эта следом.
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useKbDarkTheme(): [boolean, () => void] {
  const dark = useSyncExternalStore(subscribe, read, () => false);
  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(KEY, read() ? "light" : "dark");
    } catch {
      // приватный режим — тема не запомнится
    }
    listeners.forEach((fn) => fn());
  }, []);
  return [dark, toggle];
}
