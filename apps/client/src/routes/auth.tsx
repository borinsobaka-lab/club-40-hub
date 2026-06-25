import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-input";
import { Refresh, Eye, EyeClosed } from "@solar-icons/react";

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
  const [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
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
      if (phone.trim().length < 5) {
        setError("Укажите номер телефона");
        setBusy(false);
        return;
      }
      const { error } = await signUp(email.trim(), password, firstName.trim(), lastName.trim(), phone.trim());
      if (error) setError(error);
      else setInfo("Аккаунт создан. Если включено подтверждение почты — проверьте ящик.");
    }
    setBusy(false);
  };

  const isSignup = mode === "signup";

  return (
    <div className="relative min-h-[100dvh] bg-background overflow-hidden">
      {/* Top brand glow */}
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[420px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,229,0,0.28), rgba(255,229,0,0.08) 55%, transparent 75%)",
        }}
      />

      <div className="relative flex flex-col min-h-[100dvh] px-6 pt-16 pb-8">
        {/* Brand */}
        <div className="flex flex-col items-center mb-10">
          <div className="text-2xl font-black italic tracking-widest">
            CLUB <span className="text-[#FFE500]">40</span>
          </div>
        </div>

        {/* Heading */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black italic uppercase leading-tight">
            {isSignup ? "Привет!" : "С возвращением"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isSignup ? "Создайте аккаунт, чтобы начать" : "Войдите в личный кабинет"}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="space-y-3 max-w-sm w-full mx-auto">
          {isSignup && (
            <>
              <FloatingLabelInput
                label="Фамилия"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
              />
              <FloatingLabelInput
                label="Имя"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
              />
              <FloatingLabelInput
                label="Телефон"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                required
              />
            </>
          )}
          <FloatingLabelInput
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <div className="relative">
            <FloatingLabelInput
              label="Пароль"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={6}
              required
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center text-muted-foreground"
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showPassword ? (
                <EyeClosed className="h-5 w-5" weight="BoldDuotone" />
              ) : (
                <Eye className="h-5 w-5" weight="BoldDuotone" />
              )}
            </button>
          </div>

          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          {info && <p className="text-sm text-muted-foreground text-center">{info}</p>}

          <Button
            type="submit"
            className="w-full h-14 rounded-full text-base font-bold mt-2"
            disabled={busy}
          >
            {busy ? (
              <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
            ) : isSignup ? (
              "Зарегистрироваться"
            ) : (
              "Войти"
            )}
          </Button>
        </form>

        {/* Divider */}
        <div className="max-w-sm w-full mx-auto my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">или войти через</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Social */}
        <div className="max-w-sm w-full mx-auto">
          <button
            type="button"
            disabled
            className="w-full h-14 rounded-full border border-border bg-card flex items-center justify-center gap-3 text-sm font-semibold opacity-70"
          >
            <GoogleGlyph className="h-5 w-5" />
            Google
          </button>
        </div>

        {/* Mode switch */}
        <div className="mt-auto pt-8 text-center text-sm text-muted-foreground">
          {isSignup ? "Уже есть аккаунт?" : "Нет аккаунта?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(isSignup ? "signin" : "signup");
              setError(null);
              setInfo(null);
            }}
            className="text-foreground font-bold"
          >
            {isSignup ? "Войти" : "Зарегистрироваться"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1A6.2 6.2 0 1 1 12 5.8c1.78 0 2.97.76 3.65 1.4l2.5-2.4C16.6 3.4 14.5 2.5 12 2.5a9.5 9.5 0 1 0 0 19c5.48 0 9.1-3.85 9.1-9.27 0-.62-.07-1.1-.16-1.53H12z"
      />
      <path
        fill="#4285F4"
        d="M21.1 12.23c0-.62-.07-1.1-.16-1.53H12v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1v.001c3.62 0 6.66-2.16 8.05-5.04.7-1.42 1.05-3.03 1.05-4.43z"
        opacity=".0"
      />
    </svg>
  );
}
