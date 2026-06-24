import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Refresh } from "@solar-icons/react";

import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Вход — CLUB 40" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { signIn, signUp, session, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);


  useEffect(() => {
    if (!loading && session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    if (mode === "signin") {
      const { error } = await signIn(email.trim(), password);
      if (error) setError(error);
    } else {
      if (firstName.trim().length < 1 || lastName.trim().length < 1) {
        setError("Укажите фамилию и имя");
        setBusy(false);
        return;
      }
      const { error } = await signUp(email.trim(), password, firstName.trim(), lastName.trim());
      if (error) setError(error);
      else setInfo("Аккаунт создан. Если включено подтверждение почты — проверьте ящик.");
    }
    setBusy(false);
  };

  return (
    <div className="p-4 pt-10 space-y-6">
      <div className="text-center space-y-1">
        <div className="font-bold tracking-widest text-xl">
          CLUB <span className="text-primary">40</span>
        </div>
        <p className="text-sm text-muted-foreground">Личный кабинет участника</p>
      </div>

      <Card className="p-5">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
          <TabsList className="grid grid-cols-2 w-full mb-4">
            <TabsTrigger value="signin">Вход</TabsTrigger>
            <TabsTrigger value="signup">Регистрация</TabsTrigger>
          </TabsList>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="lastName">Фамилия</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Иванов"
                    autoComplete="family-name"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="firstName">Имя</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Иван"
                    autoComplete="given-name"
                    required
                  />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label htmlFor="email">Почта</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={6}
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}

            <TabsContent value="signin" className="m-0">
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Refresh className="h-4 w-4 animate-spin" weight="BoldDuotone" /> : "Войти"}
              </Button>
            </TabsContent>
            <TabsContent value="signup" className="m-0">
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Refresh className="h-4 w-4 animate-spin" weight="BoldDuotone" /> : "Создать аккаунт"}
              </Button>
            </TabsContent>
          </form>
        </Tabs>
      </Card>
    </div>
  );
}
