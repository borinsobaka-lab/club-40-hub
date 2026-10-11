import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { APP_FORMAT } from "@/lib/app-format";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /**
   * Отправляет код входа на почту (письмо уходит с noreply@base40.fit через
   * хук писем админки). Регистрации в приложении нет: войти может только тот,
   * чья почта есть в карточке клиента на портале. При первом входе GoTrue
   * создаёт учётную запись, а триггер handle_new_user привязывает её к
   * карточке или отказывает, если карточки нет
   * (db/migrations/…_client_signin_only.sql).
   */
  requestOtp: (email: string) => Promise<{ error: string | null }>;
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
    requestOtp: async (email) => {
      // emailRedirectTo задаём явно, хотя вход идёт по коду: по хосту в нём
      // обработчик писем (admin: /api/auth-email) отличает клиентское
      // приложение от админки. Без этого Supabase подставит Site URL
      // (= админка), и клиенту уйдёт письмо админки.
      const emailRedirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // Учётную запись создаём при первом входе — но только для почты из
          // карточки клиента (проверяет триггер в базе, не фронтенд).
          shouldCreateUser: true,
          emailRedirectTo,
          // Формат приложения: если карточки с этой почтой есть в студиях
          // обоих форматов, триггер привяжет карточку студии этого формата.
          data: { app_format: APP_FORMAT },
        },
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
