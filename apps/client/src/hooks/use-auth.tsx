import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /**
   * Отправляет код входа на почту (письмо уходит с noreply@base40.fit через
   * SMTP, настроенный в Supabase). При signup=true создаёт пользователя с
   * метаданными — их читает триггер handle_new_user (db/auth_trigger.sql
   * в репозитории админки).
   */
  requestOtp: (
    email: string,
    opts?: {
      signup?: boolean;
      firstName?: string;
      lastName?: string;
      phone?: string;
    },
  ) => Promise<{ error: string | null }>;
  /** Проверяет код из письма. Успех = сессия появляется через onAuthStateChange. */
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

// supabase-js при каждом возврате вкладки в фокус (и при обновлении токена)
// перечитывает сессию из storage и шлёт SIGNED_IN с НОВЫМ объектом user. Все
// эффекты страниц зависят от `user`, поэтому без стабилизации каждое
// переключение приложений перезагружало расписание/абонементы со скелетоном,
// затирало несохранённую анкету онбординга и форму профиля. Сохраняем прежние
// объекты, пока по существу ничего не поменялось.
function sameSession(a: Session | null, b: Session | null) {
  return a?.access_token === b?.access_token && a?.user?.id === b?.user?.id;
}
function sameUser(a: User | null, b: User | null) {
  return a?.id === b?.id && a?.updated_at === b?.updated_at;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apply = (s: Session | null) => {
      setSession((prev) => (sameSession(prev, s) ? prev : s));
      const nextUser = s?.user ?? null;
      setUser((prev) => (sameUser(prev, nextUser) ? prev : nextUser));
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => apply(s));
    supabase.auth.getSession().then(({ data }) => {
      apply(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    session,
    user,
    loading,
    requestOtp: async (email, opts) => {
      const signup = opts?.signup ?? false;
      const firstName = opts?.firstName?.trim() ?? "";
      const lastName = opts?.lastName?.trim() ?? "";
      const fullName = [lastName, firstName].filter(Boolean).join(" ").trim();
      // emailRedirectTo задаём явно, хотя вход идёт по коду: по хосту в нём
      // обработчик писем (admin: /api/auth-email) отличает клиентское
      // приложение от админки и шлёт код, а не ссылку авто-входа. Без этого
      // Supabase подставит Site URL (= админка), и клиенту уйдёт письмо
      // админки.
      const emailRedirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: signup
          ? {
              shouldCreateUser: true,
              emailRedirectTo,
              data: {
                first_name: firstName,
                last_name: lastName,
                full_name: fullName,
                phone: opts?.phone?.trim() ?? "",
              },
            }
          : { shouldCreateUser: false, emailRedirectTo },
      });
      return { error: error?.message ?? null };
    },
    verifyOtp: async (email, token) => {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      return { error: error?.message ?? null };
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
