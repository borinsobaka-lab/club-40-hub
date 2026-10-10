import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requestStaffLoginLink } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

type Step = "credentials" | "sent";

/**
 * Вход только по ссылке на почту: паролей у сотрудников нет (db/staff_accounts.sql
 * их стирает), поэтому доступ = доступ к рабочей почте. Ссылку отправляет
 * сервер и только сотрудникам — см. requestStaffLoginLink.
 */
function AuthPage() {
  const navigate = useNavigate();
  const requestLink = useServerFn(requestStaffLoginLink);
  const [email, setEmail] = useState("");
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

  const sendLink = async () => {
    setLoading(true);
    try {
      await requestLink({
        data: { email: email.trim(), redirectTo: `${window.location.origin}/` },
      });
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim().includes("@")) {
      toast.error("Укажите рабочую почту");
      return;
    }
    if (await sendLink()) setStep("sent");
  };

  const resend = async () => {
    if (await sendLink()) toast.success("Ссылка отправлена ещё раз");
  };

  // Белая карточка лежит на канве, как и всё в админке.
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Base40</CardTitle>
          <CardDescription>
            {step === "credentials"
              ? "Вход для сотрудников клуба — по ссылке на рабочую почту"
              : "Проверьте почту и перейдите по ссылке для входа"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form noValidate onSubmit={signIn} className="space-y-4">
              <FormField label="Электронная почта">
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FormField>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="animate-spin" />}
                Получить ссылку для входа
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Доступ — только для сотрудников, добавленных владельцем клуба в «Доступах».
              </p>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Если <span className="font-medium text-foreground">{email}</span> — почта
                сотрудника, мы отправили на неё ссылку для входа. Ссылка действует 1 час и работает
                один раз.
              </p>
              <div className="flex items-center justify-between">
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs text-muted-foreground"
                  onClick={() => setStep("credentials")}
                >
                  Назад
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs text-muted-foreground"
                  onClick={resend}
                  disabled={loading}
                >
                  Отправить ссылку ещё раз
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
