import { useSyncExternalStore } from "react";

import { INSTALLED_DISPLAY_MODES, isInstalledDisplay } from "@/lib/pwa-install";

/**
 * Открыто ли приложение установленным. null — пока неизвестно: на сервере и
 * при гидратации (сервер не знает, вкладка это или приложение), тогда
 * страница рисуется как раньше.
 */
export function useInstalledDisplay(): boolean | null {
  return useSyncExternalStore(subscribeDisplayMode, isInstalledDisplay, () => null);
}

function subscribeDisplayMode(onChange: () => void) {
  const queries = INSTALLED_DISPLAY_MODES.map((mode) =>
    window.matchMedia?.(`(display-mode: ${mode})`),
  ).filter((q): q is MediaQueryList => !!q);
  for (const q of queries) q.addEventListener?.("change", onChange);
  return () => {
    for (const q of queries) q.removeEventListener?.("change", onChange);
  };
}

/**
 * Установка в одно нажатие (Chrome на Android): браузер присылает
 * beforeinstallprompt, когда приложение можно установить, — по нему кнопка
 * «Установить приложение» открывает системное окно установки. Событие
 * приходит рано, ещё до экрана инструкции, поэтому слушаем с загрузки модуля.
 * Нужен service worker с fetch (у пакетного — public/sw.js); без события —
 * только инструкция.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PromptState = { event: BeforeInstallPromptEvent | null; installed: boolean };

let promptState: PromptState = { event: null, installed: false };
const promptListeners = new Set<() => void>();

function setPromptState(next: Partial<PromptState>) {
  promptState = { ...promptState, ...next };
  for (const listener of promptListeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Своя кнопка вместо мини-панели Chrome.
    e.preventDefault();
    setPromptState({ event: e as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    setPromptState({ event: null, installed: true });
  });
}

const SERVER_PROMPT_STATE: PromptState = { event: null, installed: false };

function subscribePrompt(onChange: () => void) {
  promptListeners.add(onChange);
  return () => {
    promptListeners.delete(onChange);
  };
}

export function useInstallPrompt() {
  const state = useSyncExternalStore(
    subscribePrompt,
    () => promptState,
    () => SERVER_PROMPT_STATE,
  );

  const install = async () => {
    const event = state.event;
    if (!event) return;
    // Окно установки открывается одним событием один раз.
    setPromptState({ event: null });
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") setPromptState({ installed: true });
    } catch {
      // окно не открылось — остаётся инструкция
    }
  };

  return { canInstall: !!state.event, installed: state.installed, install };
}
