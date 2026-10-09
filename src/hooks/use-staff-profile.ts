import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type StaffProfile = {
  id: string;
  email: string | null;
  fullName: string | null;
  /** Как подписывать действия сотрудника: ФИО, иначе почта. */
  displayName: string;
};

/**
 * Текущий сотрудник (кто продаёт, кто закрыл отзыв и т. п.). Профиль
 * загружается один раз и кэшируется на всю сессию вкладки.
 */
export function useStaffProfile() {
  return useQuery({
    queryKey: ["staff-profile"],
    queryFn: async (): Promise<StaffProfile | null> => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .maybeSingle();
      const fullName = (prof?.full_name as string | null | undefined) || null;
      const email = (prof?.email as string | null | undefined) || user.email || null;
      return { id: user.id, email, fullName, displayName: fullName || email || "" };
    },
    staleTime: Infinity,
  });
}
