import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

type Step = "credentials" | "sent";

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [loading, setLoading] = useState(false);
  // Пока идёт проверка пароля, signInWithPassword уже создаёт сессию и шлёт
  // SIGNED_IN. Без этого флага подписка ниже сразу уводила на «/» — в обход
  // проверки роли и письма-подтверждения, а следующий signOut выбивал
  // сессию уже из-под открытой админки.
  const passwordCheckRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !passwordCheckRef.current) navigate({ to: "/" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s && !passwordCheckRef.current) navigate({ to: "/" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const sendMagicLink = async (forEmail: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: forEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    if (error) throw error;
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    passwordCheckRef.current = true;
    try {
      await checkPasswordAndSendLink();
    } finally {
      passwordCheckRef.current = false;
      setLoading(false);
    }
  };

  const checkPasswordAndSendLink = async () => {
    // Step 1: validate password
    const { data: signInData, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      toast.error(error.message);
      return;
    }

    // Step 2: убедиться, что это сотрудник. Клиенты живут в том же проекте
    // Supabase, и часть старых клиентских аккаунтов имеет пароль — без этой
    // проверки клиент получил бы письмо со ссылкой в админку.
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", signInData.user?.id ?? "")
      .in("role", ["owner", "admin", "trainer"])
      .limit(1);
    if (!roles?.length) {
      await supabase.auth.signOut();
      toast.error("Эта учётная запись не имеет доступа к админ-панели");
      return;
    }

    // Пароль верный и это сотрудник — сбрасываем сессию и требуем ссылку как 2FA
    await supabase.auth.signOut();
    try {
      await sendMagicLink(email);
      setStep("sent");
      toast.success("Мы отправили ссылку для входа на вашу почту");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const resend = async () => {
    setLoading(true);
    try {
      await sendMagicLink(email);
      toast.success("Ссылка отправлена ещё раз");
    } catch (err) {
      toast.error((err as Error).message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Base40</CardTitle>
          <CardDescription>
            {step === "credentials"
              ? "Вход для сотрудников клуба"
              : "Проверьте почту и перейдите по ссылке для входа"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form onSubmit={signIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="si-email">Электронная почта</Label>
                <Input
                  id="si-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="si-password">Пароль</Label>
                <Input
                  id="si-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Войти
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Доступ возможен только по учётной записи, созданной владельцем клуба.
              </p>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Мы отправили письмо на <span className="font-medium text-foreground">{email}</span>.
                Перейдите по ссылке из письма, чтобы завершить вход.
              </p>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setStep("credentials")}
                >
                  Назад
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={resend}
                  disabled={loading}
                >
                  Отправить ссылку ещё раз
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
