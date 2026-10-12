import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-input";
import { Input } from "@/components/ui/input";
import { Refresh } from "@solar-icons/react";

import { useAuth } from "@/hooks/use-auth";
import { CLUB, IS_PACKAGES } from "@/lib/terms";
import { takeSignInRefused } from "@/lib/sign-in-refused";
import { DarkFrame } from "@/formats/packages/dark-frame";
import packagesLogo from "@/assets/packages-logo.svg";
import loginEmailArt from "@/assets/login-email.webp";
import loginCodeArt from "@/assets/login-code.webp";

function formatCooldown(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s} сек`;
}

const NOT_A_MEMBER = IS_PACKAGES
  ? "Эта почта не найдена среди клиентов студии. Обратитесь к администратору студии."
  : "Эта почта не найдена среди членов клуба. Обратитесь к администратору клуба.";

function humanizeAuthError(message: string): string {
  const m = message.toLowerCase();
  // Учётная запись создаётся при первом входе, но только для почты из
  // карточки клиента на портале — иначе триггер handle_new_user отказывает
  // (db/migrations/…_client_signin_only.sql), и GoTrue отвечает
  // «Database error saving new user». Учётная запись уже есть, а карточки
  // нет — хук писем не шлёт код (not_a_club_member).
  if (
    m.includes("not_a_club_member") ||
    m.includes("database error saving new user") ||
    m.includes("signups not allowed") ||
    m.includes("otp_disabled")
  ) {
    return NOT_A_MEMBER;
  }
  // Проверка формата email — раньше общего «invalid»: сообщение Supabase
  // «Unable to validate email address: invalid format» тоже содержит
  // «invalid», и клиенту с опечаткой в почте показывалось «неверный код».
  if (m.includes("invalid format") || m.includes("valid email")) {
    return "Проверьте формат email.";
  }
  if (m.includes("expired") || m.includes("invalid")) {
    return "Неверный или устаревший код. Запросите новый.";
  }
  if (m.includes("rate limit") || m.includes("after ")) {
    return "Слишком часто. Подождите минуту и попробуйте ещё раз.";
  }
  return "Не удалось отправить код: " + message;
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
    meta: [{ title: "Вход — Base40" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { requestOtp, verifyOtp, session, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(emptyOtp);
  const [busy, setBusy] = useState(false);
  const [otpFocused, setOtpFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [cooldown, setCooldown] = useState(0);
  // На какой адрес ушёл последний код: «Изменить данные» → «Получить код» с
  // тем же адресом не должен обходить паузу между отправками.
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

  // Вошёл, но карточки клиента нет — приложение вышло само (use-client-studio).
  useEffect(() => {
    if (takeSignInRefused()) setError(NOT_A_MEMBER);
  }, []);

  // Обратный отсчёт до следующей возможной отправки кода.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Укажите email");
      return;
    }
    if (cooldown > 0 && sentTo === email.trim()) {
      // Код на этот адрес уже отправлен и пауза не истекла — возвращаем к
      // вводу кода вместо повторной отправки.
      setStep("otp");
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
      return;
    }
    setBusy(true);
    const { error: sendError } = await requestOtp(email.trim());
    setBusy(false);
    if (sendError) {
      setError(humanizeAuthError(sendError));
      return;
    }
    setSentTo(email.trim());
    setOtp(emptyOtp());
    setStep("otp");
    setCooldown(RESEND_COOLDOWN_SEC);
    setTimeout(() => otpRefs.current[0]?.focus(), 50);
  };

  const resendCode = async () => {
    if (busy || cooldown > 0) return;
    setError(null);
    setBusy(true);
    const { error: sendError } = await requestOtp(email.trim());
    setBusy(false);
    if (sendError) {
      setError(humanizeAuthError(sendError));
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
    if (verifyError) setError(humanizeAuthError(verifyError));
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

  const subtitle =
    step === "otp"
      ? `Введите код, отправленный на ${email}`
      : `Войдите по почте, которую вы указали в ${CLUB.prep}`;

  const emailInput = (
    <FloatingLabelInput
      label="Email"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      autoComplete="email"
      required
    />
  );

  // Пакетное: одно невидимое поле на весь код поверх ячеек. С отдельным полем
  // на цифру фокус прыгал после каждой цифры, Android заново поднимал
  // клавиатуру, и экран моргал. Ячейки только показывают цифры.
  const otpValue = otp.join("");
  const otpSingle = (
    <div className="relative mx-auto flex w-max gap-2">
      <input
        ref={(el) => {
          otpRefs.current[0] = el;
        }}
        value={otpValue}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
          setOtp(Array.from({ length: OTP_LENGTH }, (_, i) => digits[i] ?? ""));
        }}
        onFocus={() => setOtpFocused(true)}
        onBlur={() => setOtpFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        aria-label="Код из письма"
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent opacity-0 outline-none"
      />
      {otp.map((d, i) => {
        const current =
          otpFocused &&
          (i === otpValue.length || (otpValue.length === OTP_LENGTH && i === OTP_LENGTH - 1));
        return (
          <div
            key={i}
            aria-hidden="true"
            className={`flex h-14 w-11 items-center justify-center rounded-xl border bg-card text-xl font-bold ${
              current ? "border-primary ring-2 ring-primary" : "border-border"
            }`}
          >
            {d}
          </div>
        );
      })}
    </div>
  );

  const otpInputs = (
    <div className="flex justify-center gap-2">
      {otp.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            otpRefs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          // Первая ячейка принимает автоподстановку кода целиком
          // (one-time-code): maxLength=1 обрезал бы её до одной цифры
          // ещё до onChange. Разбор по ячейкам делает setOtpDigit.
          maxLength={i === 0 ? OTP_LENGTH : 1}
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
  );

  const otpLinks = (
    <>
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
        Изменить почту
      </button>
    </>
  );

  const errorText = error && <p className="text-sm text-destructive text-center">{error}</p>;

  const spinner = <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />;

  // Пакетное приложение — в оформлении разделов (тёмная шапка с огоньками и
  // белая панель), как онбординг; подписочное — как было.
  if (IS_PACKAGES) {
    return (
      <DarkFrame
        tall
        top={<img src={packagesLogo} alt="Логотип студии" className="mx-6 mt-4 h-auto w-[150px]" />}
        art={step === "otp" ? loginCodeArt : loginEmailArt}
        header={
          <div className="px-6 pt-2 pb-10">
            <h1 className="text-3xl font-semibold leading-tight">Добро пожаловать</h1>
            <p className="mt-2 text-sm text-white/70">{subtitle}</p>
          </div>
        }
        footer={
          step === "form" ? (
            <Button
              type="submit"
              form="auth-email-form"
              disabled={busy}
              className="h-12 w-full text-base font-semibold"
            >
              {busy ? spinner : "Получить код"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={submitOtp}
              disabled={busy}
              className="h-12 w-full text-base font-semibold"
            >
              {busy ? spinner : "Подтвердить"}
            </Button>
          )
        }
      >
        {step === "form" ? (
          // pb — запас под рамку и подсветку фокуса: прокрутка панели срезала
          // нижний край поля.
          <form id="auth-email-form" onSubmit={requestCode} className="space-y-3 px-4 pt-6 pb-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Введите ваш email"
              aria-label="Email"
              autoComplete="email"
              inputMode="email"
              required
              className="h-14 text-base"
            />
            {errorText}
          </form>
        ) : (
          <div className="space-y-4 px-4 pt-6 pb-2">
            {otpSingle}
            {errorText}
            {otpLinks}
          </div>
        )}
      </DarkFrame>
    );
  }

  return (
    <div className="relative min-h-[100dvh] bg-background overflow-hidden">
      {/* Top brand glow */}
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[420px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in srgb, var(--primary) 28%, transparent), color-mix(in srgb, var(--primary) 8%, transparent) 55%, transparent 75%)",
        }}
      />

      <div className="relative flex flex-col min-h-[100dvh] px-6 pt-16 pb-8">
        {/* Brand */}
        <div className="flex flex-col items-center mb-10">
          <div className="text-2xl font-black tracking-widest">
            Base<span className="text-primary">40</span>
          </div>
        </div>

        {/* Heading */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold leading-tight">Добро пожаловать</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {step === "form" ? (
          <form onSubmit={requestCode} className="space-y-3 max-w-sm w-full mx-auto">
            {emailInput}

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
            {otpInputs}

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

            {otpLinks}
          </div>
        )}
      </div>
    </div>
  );
}
