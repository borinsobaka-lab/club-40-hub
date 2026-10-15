import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Страница не найдена</h2>
        <p className="mt-2 text-sm text-muted-foreground">Такой страницы нет или она переехала.</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Страница не загрузилась
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Что-то пошло не так. Попробуйте ещё раз или вернитесь на главную.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Повторить
          </Button>
          <Button variant="outline" asChild>
            <a href="/">На главную</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // interactive-widget: Chrome на Android при открытой клавиатуре ужимает
      // страницу, и шторка диалога с кнопками встаёт над клавиатурой, а не под ней.
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, interactive-widget=resizes-content",
      },
      { title: "Base40 — Админ-панель" },
      { name: "description", content: "Админ-панель фитнес-клуба Base40." },
      { property: "og:title", content: "Base40 — Админ-панель" },
      { property: "og:description", content: "Админ-панель фитнес-клуба Base40." },
      { property: "og:type", content: "website" },
      // Цвет плашки иконки — им же браузеры красят интерфейс на мобильных.
      { name: "theme-color", content: "#1B1C1F" },
      // Установка на телефон и ноутбук (PWA): манифест + public/sw.js. Для
      // iPhone — свои мета-теги: Safari берёт имя и иконку отсюда, а не из манифеста.
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Base40" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Фирменная «A». png 32/180 — вкладка и HiDPI, ico — фолбэк (часть
      // браузеров дёргает /favicon.ico напрямую, минуя разметку). ?v= —
      // сбросить закэшированную браузерами прежнюю иконку.
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png?v=2" },
      { rel: "icon", type: "image/png", sizes: "180x180", href: "/apple-touch-icon.png?v=2" },
      { rel: "icon", href: "/favicon.ico?v=2", sizes: "any" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=2" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Service worker — только в прод-сборке: в дев-режиме он перехватывал бы
  // переходы и мешал HMR. Сбой регистрации не ломает админку, лишь отключает
  // установку как приложения.
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("[pwa] service worker не зарегистрирован", error);
    });
  }, []);

  // Сменился вошедший человек (выход, вход, другой сотрудник) — кэш запросов
  // целиком в мусор. Иначе «Выход» оставлял пустой список клубов: меню ещё
  // на экране перезапрашивает студии уже без сессии, получает [] и держит
  // его (staleTime: Infinity) — после входа клубов нет до перезагрузки.
  // Сверяем id, а не событие: SIGNED_IN приходит и при возврате во вкладку.
  useEffect(() => {
    let userId: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (userId !== undefined && next !== userId) queryClient.clear();
      userId = next;
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
