import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

type Step = "credentials" | "otp";

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const sendCode = async (forEmail: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: forEmail,
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Step 1: validate password
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }
    // Password correct — drop the session and require an email OTP as 2FA
    await supabase.auth.signOut();
    try {
      await sendCode(email);
      setStep("otp");
      toast.success("Мы отправили код подтверждения на вашу почту");
    } catch (err) {
      toast.error((err as Error).message);
    }
    setLoading(false);
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Вход выполнен");
  };

  const resend = async () => {
    setLoading(true);
    try {
      await sendCode(email);
      toast.success("Новый код отправлен");
    } catch (err) {
      toast.error((err as Error).message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">CLUB 40</CardTitle>
          <CardDescription>
            {step === "credentials"
              ? "Вход для сотрудников клуба"
              : "Введите код подтверждения, отправленный на вашу почту"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form onSubmit={signIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="si-email">Электронная почта</Label>
                <Input id="si-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="si-password">Пароль</Label>
                <Input id="si-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
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
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="si-code">Код из письма</Label>
                <Input
                  id="si-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-значный код"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || code.trim().length < 4}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Подтвердить
              </Button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setStep("credentials");
                    setCode("");
                  }}
                >
                  Назад
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={resend}
                  disabled={loading}
                >
                  Отправить код ещё раз
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
