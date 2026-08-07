import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

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
    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .in("role", ["owner", "admin", "trainer"])
      .limit(1);

    if (rolesError || !roles?.length) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }

    return { user: data.user };
  },
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
/**
 * shadcn пишет состояние панели в cookie при переключении, но обратно её нигде
 * не читает: без этого меню разворачивалось бы заново на каждой перезагрузке.
 */
function sidebarOpenFromCookie() {
  if (typeof document === "undefined") return true;
  return !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(document.cookie);
}

function AuthenticatedLayout() {
  return (
    <SidebarProvider defaultOpen={sidebarOpenFromCookie()}>
      <div className="flex h-screen w-full overflow-hidden bg-muted/30">
        <AppSidebar />
        <div className="flex h-screen flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </SidebarProvider>
  );
}
