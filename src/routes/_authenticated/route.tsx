import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

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
  component: () => <Outlet />,
});
