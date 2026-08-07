import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-input";
import { Refresh } from "@solar-icons/react";

import { useAuth } from "@/hooks/use-auth";

function formatCooldown(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s} сек`;
}

function humanizeAuthError(message: string, isSignup: boolean): string {
  const m = message.toLowerCase();
  if (m.includes("signups not allowed") || m.includes("otp_disabled")) {
    return "Аккаунт с этой почтой не найден. Зарегистрируйтесь.";
  }
  if (m.includes("already registered") || m.includes("already exists")) {
    return "Эта почта уже зарегистрирована. Войдите по коду.";
  }
  if (m.includes("expired") || m.includes("invalid")) {
    return "Неверный или устаревший код. Запросите новый.";
  }
  if (m.includes("rate limit") || m.includes("after ")) {
    return "Слишком часто. Подождите минуту и попробуйте ещё раз.";
  }
  if (m.includes("invalid format") || m.includes("valid email")) {
    return "Проверьте формат email.";
  }
  return isSignup ? "Не удалось отправить код: " + message : message;
}

// Длина кода из письма. Supabase не даёт настраивать Email OTP Length —
// всегда 6 цифр, поэтому значение зашито здесь одной константой.
const OTP_LENGTH = 6;
// Пауза между отправками кода. Supabase со своей стороны тоже ограничивает
// частоту, но без своей паузы пользователь жмёт кнопку и получает сухую
// ошибку — здесь кнопка просто заблокирована с обратным отсчётом.
const RESEND_COOLDOWN_SEC = 60;
const emptyOtp = () => Array<string>(OTP_LENGTH).fill("");

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Регистрация — CLUB 40" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { requestOtp, verifyOtp, session, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(emptyOtp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

  // Обратный отсчёт до следующей возможной отправки кода.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

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
    setBusy(true);
    const { error: sendError } = await requestOtp(email.trim(), {
      signup: isSignup,
      firstName,
      lastName,
      phone,
    });
    setBusy(false);
    if (sendError) {
      setError(humanizeAuthError(sendError, isSignup));
      return;
    }
    setOtp(emptyOtp());
    setStep("otp");
    setCooldown(RESEND_COOLDOWN_SEC);
    setTimeout(() => otpRefs.current[0]?.focus(), 50);
  };

  const resendCode = async () => {
    if (busy || cooldown > 0) return;
    setError(null);
    setBusy(true);
    const { error: sendError } = await requestOtp(email.trim(), {
      signup: isSignup,
      firstName,
      lastName,
      phone,
    });
    setBusy(false);
    if (sendError) {
      setError(humanizeAuthError(sendError, isSignup));
      return;
    }
    setOtp(emptyOtp());
    setCooldown(RESEND_COOLDOWN_SEC);
    otpRefs.current[0]?.focus();
  };

  const submitOtp = async () => {
    if (otp.some((d) => d === "")) {
      setError(`Введите ${OTP_LENGTH}-значный код`);
      return;
    }
    setError(null);
    setBusy(true);
    // Успешная проверка создаёт сессию — редирект сработает через useEffect выше.
    const { error: verifyError } = await verifyOtp(email.trim(), otp.join(""));
    if (verifyError) setError(humanizeAuthError(verifyError, isSignup));
    setBusy(false);
  };

  const setOtpDigit = (i: number, val: string) => {
    const digits = val.replace(/\D/g, "");
    // Вставка кода целиком (из письма) или автоподстановка из SMS/почты:
    // раскладываем цифры по ячейкам, начиная с текущей.
    if (digits.length > 1) {
      fillOtpFrom(i, digits);
      return;
    }
    const d = digits.slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[i] = d;
      return next;
    });
    if (d && i < OTP_LENGTH - 1) otpRefs.current[i + 1]?.focus();
  };

  const fillOtpFrom = (start: number, digits: string) => {
    setOtp((prev) => {
      const next = [...prev];
      for (let k = 0; k < digits.length && start + k < OTP_LENGTH; k++) {
        next[start + k] = digits[k];
      }
      return next;
    });
    const last = Math.min(start + digits.length, OTP_LENGTH) - 1;
    otpRefs.current[last]?.focus();
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
          <div className="text-2xl font-black tracking-widest">
            CLUB <span className="text-primary">40</span>
          </div>
        </div>

        {/* Heading */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black uppercase leading-tight">Добро пожаловать</h1>
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
              disabled={busy}
              className="w-full h-14 rounded-full text-base font-bold mt-2"
            >
              {busy ? (
                <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
              ) : (
                "Получить код"
              )}
            </Button>
          </form>
        ) : (
          <div className="space-y-4 max-w-sm w-full mx-auto">
            <div className="flex justify-center gap-2">
              {otp.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  value={d}
                  onChange={(e) => setOtpDigit(i, e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
                    if (!pasted) return;
                    e.preventDefault();
                    fillOtpFrom(i, pasted);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !otp[i] && i > 0) {
                      otpRefs.current[i - 1]?.focus();
                    }
                  }}
                  className="h-14 w-11 text-center text-xl font-bold rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary"
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
              onClick={resendCode}
              disabled={busy || cooldown > 0}
              className="w-full text-center text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cooldown > 0
                ? `Отправить код ещё раз можно через ${formatCooldown(cooldown)}`
                : "Отправить код ещё раз"}
            </button>

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
