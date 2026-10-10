import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { hasStaffRole } from "@/lib/roles";

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
      {/* h-dvh, а не h-screen: в мобильном Safari 100vh выше видимой области
          (под адресной строкой), и низ страницы с пагинацией уезжал за экран. */}
      <div className="flex h-dvh w-full overflow-hidden bg-canvas">
        <AppSidebar />
        <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </SidebarProvider>
  );
}
