import {
  createFileRoute,
  Navigate,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AdminShell } from "@/components/admin-shell";
import { StudioBranding } from "@/components/studio-branding";
import { AppShellSkeleton, PageSkeleton } from "@/components/skeletons";
import { hasStaffRole } from "@/lib/roles";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { canOpenPath, firstAllowedUrl } from "@/lib/nav-sections";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }

    // Одной авторизации мало: клиент мобильного приложения — тоже
    // авторизованный пользователь этого же проекта Supabase. В админку
    // пускаем только сотрудников (owner/admin/trainer в user_roles).
    // Сбой самой проверки — исключение: страница ошибки с «Повторить», без
    // выхода из аккаунта. scope local — не трогаем сессии на других устройствах.
    if (!(await hasStaffRole(supabase, data.user.id))) {
      await supabase.auth.signOut({ scope: "local" });
      throw redirect({ to: "/auth" });
    }

    return { user: data.user };
  },
  // Пока проверяется вход (и при ssr: false — в HTML с сервера) — скелетон
  // всего каркаса, а не белый экран.
  pendingComponent: AppShellSkeleton,
  component: AuthenticatedLayout,
});

/**
 * Каркас админки живёт здесь, а не в AdminShell на каждой странице.
 *
 * Иначе боковое меню размонтируется и монтируется заново при каждом переходе:
 * его прокрутка отскакивала наверх, а сама панель на кадр перерисовывалась.
 * В layout-роуте она монтируется один раз, а меняется только содержимое
 * Outlet — AdminShell рисует шапку с заголовком и тело страницы.
 */
function AuthenticatedLayout() {
  return (
    // Меню всегда развёрнуто: кнопку сворачивания убрали, а сохранённое в
    // cookie «свёрнуто» иначе оставило бы меню свёрнутым без пути назад.
    // На мобильном шторка управляется отдельно (openMobile) и работает как раньше.
    <SidebarProvider open>
      <StudioBranding />
      {/* h-dvh, а не h-screen: в мобильном Safari 100vh выше видимой области
          (под адресной строкой), и низ страницы с пагинацией уезжал за экран. */}
      {/*
        С md фон каркаса — цвет меню, а рабочая область лежит поверх него
        скруглённой панелью с тонкой тёмной рамкой сверху, справа и снизу:
        рамка продолжает меню. Слева отступа нет — там само меню. До md меню
        в шторке, рамка только съела бы ширину телефона — панель во весь экран.
      */}
      <div className="flex h-dvh w-full overflow-hidden bg-canvas md:bg-sidebar md:py-1.5 md:pr-1.5">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas md:rounded-xl">
          <AccessGate />
        </div>
      </div>
    </SidebarProvider>
  );
}

/**
 * Разделы, закрытые сотруднику в «Доступах»: страница не открывается, а
 * уводит на первую доступную. Это интерфейс, не защита: данные студии
 * ограничивает RLS (роль в студии), разделы рейки — has_admin_section.
 */
function AccessGate() {
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const studioId = useActiveStudioId();
  const access = useAdminAccess();

  // Пока права грузятся — скелетон страницы, чтобы закрытая страница не мелькнула.
  if (!access) return <PageSkeleton />;
  if (canOpenPath(access, studioId, pathname)) return <Outlet />;

  const fallback = firstAllowedUrl(access, studioId);
  if (fallback && fallback !== pathname) return <Navigate to={fallback} replace />;
  return (
    <AdminShell title="Нет доступа">
      <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
        Нет доступных разделов. Попросите владельца открыть их в «Доступах».
      </div>
    </AdminShell>
  );
}
