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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    loading,
    requestOtp: async (email, opts) => {
      const signup = opts?.signup ?? false;
      const firstName = opts?.firstName?.trim() ?? "";
      const lastName = opts?.lastName?.trim() ?? "";
      const fullName = [lastName, firstName].filter(Boolean).join(" ").trim();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: signup
          ? {
              shouldCreateUser: true,
              data: {
                first_name: firstName,
                last_name: lastName,
                full_name: fullName,
                phone: opts?.phone?.trim() ?? "",
              },
            }
          : { shouldCreateUser: false },
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
