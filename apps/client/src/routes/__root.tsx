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
import { cn } from "@/lib/utils";

import appCss from "../styles.css?url";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { title: "CLUB 40" },
      { name: "description", content: "Клиентское приложение CLUB 40 — расписание, бронирование и результаты тренировок." },
      { name: "theme-color", content: "#0a0a0a" },
      { property: "og:title", content: "CLUB 40" },
      { property: "og:description", content: "Клиентское приложение CLUB 40 — расписание, бронирование и результаты тренировок." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "CLUB 40" },
      { name: "twitter:description", content: "Клиентское приложение CLUB 40 — расписание, бронирование и результаты тренировок." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700;900&family=Google+Sans+Text:wght@400;500;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
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

function resetPageScrollPosition() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  document.querySelectorAll<HTMLElement>("[data-page-scroll]").forEach((element) => {
    element.scrollTop = 0;
    element.scrollLeft = 0;
  });
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

function useInternalNavigationScrollReset() {
  useEffect(() => {
    const handleNavigationStart = (event: MouseEvent | PointerEvent | TouchEvent) => {
      if (
        event.defaultPrevented ||
        ("button" in event && event.button !== 0) ||
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
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      resetPageScrollPosition();
    };

    document.addEventListener("pointerdown", handleNavigationStart, true);
    document.addEventListener("touchstart", handleNavigationStart, true);
    document.addEventListener("click", handleNavigationStart, true);
    return () => {
      document.removeEventListener("pointerdown", handleNavigationStart, true);
      document.removeEventListener("touchstart", handleNavigationStart, true);
      document.removeEventListener("click", handleNavigationStart, true);
    };
  }, []);
}

function AppShell() {
  const { session, user, loading } = useAuth();
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
      const { supabase: sb } = await import("@/integrations/supabase/client");
      const { data } = await (sb as any)
        .from("member_profiles")
        .select("onboarding_completed_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
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

  const LoadingOverlay = () => (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Refresh className="h-6 w-6 text-muted-foreground animate-spin" weight="BoldDuotone" />
    </div>
  );

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

