import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-input";
import { Refresh } from "@solar-icons/react";

import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Регистрация — CLUB 40" }],
  }),
  component: AuthPage,
});

// Deterministic placeholder password — OTP code is the real (mock) factor in the UI.
const derivedPassword = (email: string) => `club40::${email.trim().toLowerCase()}`;

function AuthPage() {
  const { signIn, signUp, session, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

  const isSignup = mode === "signup";

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isSignup) {
      if (firstName.trim().length < 1 || lastName.trim().length < 1) {
        setError("Укажите фамилию и имя");
        return;
      }
      if (phone.trim().length < 5) {
        setError("Укажите номер телефона");
        return;
      }
    }
    if (!email.trim()) {
      setError("Укажите email");
      return;
    }
    setOtp(["", "", "", ""]);
    setStep("otp");
    setTimeout(() => otpRefs.current[0]?.focus(), 50);
  };

  const submitOtp = async () => {
    if (otp.some((d) => d === "")) {
      setError("Введите 4-значный код");
      return;
    }
    setError(null);
    setBusy(true);
    const pwd = derivedPassword(email);
    if (isSignup) {
      const { error: e1 } = await signUp(
        email.trim(),
        pwd,
        firstName.trim(),
        lastName.trim(),
        phone.trim(),
      );
      if (e1 && !/registered|exists/i.test(e1)) {
        setError(e1);
        setBusy(false);
        return;
      }
    }
    const { error: e2 } = await signIn(email.trim(), pwd);
    if (e2) setError(e2);
    setBusy(false);
  };

  const setOtpDigit = (i: number, val: string) => {
    const d = val.replace(/\D/g, "").slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[i] = d;
      return next;
    });
    if (d && i < 3) otpRefs.current[i + 1]?.focus();
  };

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
            Добро пожаловать
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === "otp"
              ? `Введите код, отправленный на ${email}`
              : isSignup
                ? "Зарегистрируйтесь для старта"
                : "Войдите в аккаунт"}
          </p>
        </div>

        {step === "form" ? (
          <form onSubmit={requestCode} className="space-y-3 max-w-sm w-full mx-auto">
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

            {error && <p className="text-sm text-destructive text-center">{error}</p>}

            <Button
              type="submit"
              className="w-full h-14 rounded-full text-base font-bold mt-2"
            >
              Получить код
            </Button>
          </form>
        ) : (
          <div className="space-y-4 max-w-sm w-full mx-auto">
            <div className="flex justify-center gap-3">
              {otp.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => setOtpDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !otp[i] && i > 0) {
                      otpRefs.current[i - 1]?.focus();
                    }
                  }}
                  className="h-16 w-14 text-center text-2xl font-bold rounded-2xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ))}
            </div>

            {error && <p className="text-sm text-destructive text-center">{error}</p>}

            <Button
              type="button"
              onClick={submitOtp}
              disabled={busy}
              className="w-full h-14 rounded-full text-base font-bold"
            >
              {busy ? (
                <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
              ) : (
                "Подтвердить"
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                setStep("form");
                setError(null);
              }}
              className="w-full text-center text-sm text-muted-foreground"
            >
              Изменить данные
            </button>
          </div>
        )}

        {/* Mode switch */}
        {step === "form" && (
          <div className="mt-auto pt-8 text-center text-sm text-muted-foreground">
            {isSignup ? "Уже есть аккаунт?" : "Нет аккаунта?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(isSignup ? "signin" : "signup");
                setError(null);
              }}
              className="text-foreground font-bold"
            >
              {isSignup ? "Войти" : "Зарегистрироваться"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
