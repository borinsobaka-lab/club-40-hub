import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Refresh, SolarProvider } from "@solar-icons/react";
import { BottomNav } from "@/components/bottom-nav";
import { resetPageScrollPosition } from "@/lib/page-scroll";

import appCss from "../styles.css?url";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useClientStudio, type Studio } from "@/hooks/use-studios";
import { APP_FORMAT, FORMAT_APP_URL } from "@/lib/app-format";
import { DEFAULT_APP_INSTALL, fetchAppInstall } from "@/lib/app-install";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Страница не найдена</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Запрошенная страница не существует или была перемещена.
        </p>
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
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Страница не загрузилась
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Что-то пошло не так. Попробуйте обновить или вернуться на главную.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Попробовать снова
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            На главную
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Иконка и подпись приложения из админки (src/lib/app-install.ts) — для
  // фавикона и установки на рабочий стол. Грузятся при серверном рендере;
  // переходы внутри приложения их не перезапрашивают.
  loader: () => fetchAppInstall(),
  staleTime: Infinity,
  head: ({ loaderData }) => {
    const app = loaderData ?? DEFAULT_APP_INSTALL;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
        { title: "Base40" },
        {
          name: "description",
          content:
            "Клиентское приложение Base40 — расписание, бронирование и результаты тренировок.",
        },
        { name: "theme-color", content: "#0a0a0a" },
        // Подпись под значком: Android берёт её из манифеста, iOS — отсюда.
        { name: "application-name", content: app.name },
        { name: "apple-mobile-web-app-title", content: app.name },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
        { property: "og:title", content: "Base40" },
        {
          property: "og:description",
          content:
            "Клиентское приложение Base40 — расписание, бронирование и результаты тренировок.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: "Base40" },
        {
          name: "twitter:description",
          content:
            "Клиентское приложение Base40 — расписание, бронирование и результаты тренировок.",
        },
      ],
      links: [
        // Шрифт (Roboto) самохостится и подключён в styles.css. Обращений к
        // Google Fonts нет намеренно: «Google Sans» там публично не раздаётся,
        // так что прежние preconnect и stylesheet уходили впустую на каждой
        // загрузке — и утекали на сторонний домен.
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "icon", type: "image/png", sizes: "32x32", href: app.icons.favicon32 },
        // /favicon.ico (Base40) — только без своей иконки: иначе часть браузеров
        // предпочла бы его.
        ...(app.custom ? [] : [{ rel: "icon", href: "/favicon.ico", sizes: "any" }]),
        { rel: "apple-touch-icon", href: app.icons.appleTouch },
        { rel: "manifest", href: "/manifest.webmanifest" },
      ],
    };
  },
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

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SolarProvider value={{ weight: "BoldDuotone" }}>
          <AppShell />
          <Toaster />
        </SolarProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Refresh className="h-6 w-6 text-muted-foreground animate-spin" weight="BoldDuotone" />
    </div>
  );
}

function useRouteScrollReset(scrollKey: string) {
  useLayoutEffect(() => {
    resetPageScrollPosition();
    const frameId = window.requestAnimationFrame(resetPageScrollPosition);
    const timeoutId = window.setTimeout(resetPageScrollPosition, 50);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [scrollKey]);
}

// Только click: pointerdown/touchstart срабатывают и в начале жеста прокрутки,
// так что палец, поставленный на ссылку («Перейти в профиль», «Забронировать»),
// чтобы пролистать страницу, сбрасывал прокрутку наверх. Click приходит лишь
// при настоящем нажатии и (capture на document) раньше навигации роутера.
function useInternalNavigationScrollReset() {
  useEffect(() => {
    const handleNavigationStart = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;

      const url = new URL(link.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;

      resetPageScrollPosition();
    };

    document.addEventListener("click", handleNavigationStart, true);
    return () => {
      document.removeEventListener("click", handleNavigationStart, true);
    };
  }, []);
}

/**
 * Клиент студии другого формата: у каждого формата своё приложение
 * (src/lib/app-format.ts), здесь его расписание и абонементы не работают.
 */
function OtherAppScreen({ studio }: { studio: Studio }) {
  const { signOut } = useAuth();
  const url = FORMAT_APP_URL[studio.format];
  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">Ваша студия — в другом приложении</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Студия «{studio.name}» работает в приложении {url.replace(/^https?:\/\//, "")}. Войдите
          там с той же почтой.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <a
            href={url}
            className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground"
          >
            Открыть приложение студии
          </a>
          <button
            type="button"
            onClick={() => signOut()}
            className="h-12 text-sm text-muted-foreground"
          >
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const { session, user, loading } = useAuth();
  const studio = useClientStudio();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onAuthRoute = pathname === "/auth";
  const onOnboardingRoute = pathname === "/onboarding";
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useRouteScrollReset(pathname);
  useInternalNavigationScrollReset();

  useEffect(() => {
    if (loading) return;
    if (!session && !onAuthRoute) navigate({ to: "/auth", replace: true });
    if (session && onAuthRoute) navigate({ to: "/", replace: true });
  }, [loading, session, onAuthRoute, navigate]);

  // Reset when user changes / signs out
  useEffect(() => {
    if (!user) setOnboardingChecked(false);
  }, [user]);

  // Onboarding gate: if logged in and member_profiles.onboarding_completed_at IS NULL → /onboarding
  useEffect(() => {
    if (loading || !user) return;
    if (onAuthRoute) return;
    if (onOnboardingRoute) {
      setOnboardingChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("member_profiles")
        .select("onboarding_completed_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      // Ошибку запроса нельзя трактовать как «анкета не заполнена»: иначе
      // разовый сбой сети уводит уже прошедшего онбординг клиента в опросник,
      // а его завершение перезаписывает анкету пустыми ответами.
      if (error) {
        setOnboardingChecked(true);
        return;
      }
      if (!data || !data.onboarding_completed_at) {
        navigate({ to: "/onboarding", replace: true });
      } else {
        setOnboardingChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, onAuthRoute, onOnboardingRoute, navigate]);

  if (onAuthRoute) {
    return (
      <div className="min-h-screen bg-background text-foreground flex justify-center">
        <div className="w-full max-w-md flex flex-col min-h-screen relative">
          <main className="flex-1 relative">
            <Outlet />
            {loading && <LoadingOverlay />}
          </main>
        </div>
      </div>
    );
  }

  // Студия известна и другого формата — дальше не пускаем (ни в анкету, ни в
  // разделы). Пока студия грузится или база без форматов — работаем как обычно.
  if (session && studio && studio.format !== APP_FORMAT) {
    return <OtherAppScreen studio={studio} />;
  }

  if (onOnboardingRoute) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground flex justify-center">
        <div className="w-full max-w-md flex flex-col min-h-[100dvh] relative">
          <Outlet />
          {loading && <LoadingOverlay />}
        </div>
      </div>
    );
  }

  const showAppLoading = loading || (!!session && !onboardingChecked);

  return (
    <div className="h-[100dvh] overflow-hidden bg-muted/60 text-foreground flex justify-center">
      <div className="w-full max-w-md flex h-full min-h-0 flex-col relative bg-muted/60 overflow-hidden">
        <main key={pathname} className="flex-1 min-h-0 overflow-hidden relative">
          {!showAppLoading && <Outlet />}
          {showAppLoading && <LoadingOverlay />}
        </main>

        {!showAppLoading && <BottomNav />}
      </div>
    </div>
  );
}
