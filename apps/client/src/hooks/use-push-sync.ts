import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/i18n";
import { syncPushDevice, usePushPermission } from "@/lib/push";

/**
 * Пуш-уведомления в каркасе приложения (__root.tsx, lib/push.ts):
 *
 * - разрешение есть — подписка телефона в базе на вошедшего и на языке
 *   приложения (при запуске, входе, смене языка, после включения в
 *   настройках телефона, при возвращении в приложение);
 * - пришёл пуш при открытом приложении — лента «Уведомления» обновляется;
 * - нажали на пуш при открытом приложении — переход внутри него
 *   (public/sw.js шлёт push-open вместо новой вкладки; окно отвечает, и
 *   service worker выводит вперёд его, а не вкладку браузера).
 */
export function usePushSync() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const permission = usePushPermission();
  const queryClient = useQueryClient();
  const router = useRouter();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || permission !== "granted") return;
    const sync = () => {
      syncPushDevice(userId, locale).catch(() => {
        // нет сети или базы без миграции — повторим ниже
      });
    };
    sync();
    // Не вышло (нет сети, ключа на сервере ещё нет) — повторим, когда
    // приложение снова откроют; подписанное за сегодня в базу не пишется.
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, locale, permission]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: unknown } | null;
      if (data?.type === "push-received") {
        void queryClient.invalidateQueries({ queryKey: ["push-inbox"] });
      }
      if (data?.type === "push-open" && typeof data.url === "string" && data.url.startsWith("/")) {
        // Ответ service worker: нажатие принято этим окном — его он и выведет
        // вперёд (а не вкладку браузера с инструкцией по установке).
        event.ports[0]?.postMessage("ok");
        void queryClient.invalidateQueries({ queryKey: ["push-inbox"] });
        router.history.push(data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [queryClient, router]);
}
