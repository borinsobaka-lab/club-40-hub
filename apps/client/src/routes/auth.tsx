import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-input";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Refresh } from "@solar-icons/react";

import { useAuth } from "@/hooks/use-auth";
import { APP_BRAND, IS_PACKAGES } from "@/lib/terms";
import { takeSignInRefused } from "@/lib/sign-in-refused";
import { cancelHomeConfetti, queueHomeConfetti } from "@/lib/confetti";
import { DarkFrame } from "@/formats/packages/dark-frame";
import { StudioContactButtons } from "@/formats/packages/studio-contacts";
import packagesLogo from "@/assets/packages-logo.svg";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PrivacyConsent } from "@/components/privacy-consent";
import { recordPrivacyConsent } from "@/lib/privacy-consent";
import { isValidPhone } from "@/lib/phone";
import {
  PHONE_CODE_LENGTH,
  requestPhoneCode,
  verifyPhoneCode,
  type PhoneLoginError,
} from "@/lib/phone-login";
import { cn } from "@/lib/utils";
import { fetchSignInClosed } from "@/lib/app-install";
import { PRIVACY_POLICY_INFO } from "@/lib/legal";
import { getTranslator, useT, type Translator } from "@/i18n";
import loginEmailArt from "@/assets/login-email.webp";
import loginCodeArt from "@/assets/login-code.webp";

function formatCooldown(sec: number, t: Translator) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : t("{s} сек", { s });
}

function notAMember(t: Translator) {
  return IS_PACKAGES
    ? t("Эта почта не найдена среди клиентов студии. Обратитесь к администратору студии.")
    : t("Эта почта не найдена среди членов клуба. Обратитесь к администратору клуба.");
}

function phoneNotAMember(t: Translator) {
  return IS_PACKAGES
    ? t("Этот номер не найден среди клиентов студии. Обратитесь к администратору студии.")
    : t("Этот номер не найден среди членов клуба. Обратитесь к администратору клуба.");
}

/** Ошибка входа по телефону (коды — сервер админки, /api/phone-login). */
function phoneErrorText(error: PhoneLoginError, t: Translator): string {
  switch (error) {
    case "invalid_phone":
      return t("Проверьте номер телефона.");
    case "not_a_club_member":
      return phoneNotAMember(t);
    case "ambiguous_phone":
      return IS_PACKAGES
        ? t(
            "Этот номер указан у нескольких клиентов. Войдите по почте или обратитесь к администратору студии.",
          )
        : t(
            "Этот номер указан у нескольких клиентов. Войдите по почте или обратитесь к администратору клуба.",
          );
    case "staff_use_email":
      return t("У сотрудников вход только по почте. Войдите по почте.");
    case "sign_in_closed":
      return t("Вход в приложение пока закрыт.");
    case "too_many_requests":
      return t("Слишком часто. Подождите минуту и попробуйте ещё раз.");
    case "blocked":
      return t("Не удалось отправить SMS на этот номер. Войдите по почте.");
    case "invalid_code":
      return t("Неверный код. Проверьте и попробуйте ещё раз.");
    case "expired_code":
      return t("Код устарел. Запросите новый.");
    case "network":
      return t("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
    default:
      return t("Не удалось войти по номеру. Попробуйте позже или войдите по почте.");
  }
}

/** Почта не найдена среди клиентов (учётную запись не создали / код не шлют). */
function isNotAMemberError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("not_a_club_member") ||
    m.includes("database error saving new user") ||
    m.includes("signups not allowed") ||
    m.includes("otp_disabled")
  );
}

function humanizeAuthError(message: string, t: Translator): string {
  const m = message.toLowerCase();
  // Учётная запись создаётся при первом входе, но только для почты из
  // карточки клиента на портале — иначе триггер handle_new_user отказывает
  // (db/migrations/…_client_signin_only.sql), и GoTrue отвечает
  // «Database error saving new user». Учётная запись уже есть, а карточки
  // нет — хук писем не шлёт код (not_a_club_member).
  if (isNotAMemberError(message)) return notAMember(t);
  // Проверка формата email — раньше общего «invalid»: сообщение Supabase
  // «Unable to validate email address: invalid format» тоже содержит
  // «invalid», и клиенту с опечаткой в почте показывалось «неверный код».
  if (m.includes("invalid format") || m.includes("valid email")) {
    return t("Проверьте формат email.");
  }
  if (m.includes("expired") || m.includes("invalid")) {
    return t("Неверный или устаревший код. Запросите новый.");
  }
  if (m.includes("rate limit") || m.includes("after ")) {
    return t("Слишком часто. Подождите минуту и попробуйте ещё раз.");
  }
  return t("Не удалось отправить код: {message}", { message });
}

// Длина кода из письма. Supabase не даёт настраивать Email OTP Length —
// всегда 6 цифр, поэтому значение зашито здесь одной константой. Код из SMS
// (вход по телефону) — PHONE_CODE_LENGTH, 4 цифры.
const OTP_LENGTH = 6;
// Пауза между отправками кода. Supabase со своей стороны тоже ограничивает
// частоту, но без своей паузы пользователь жмёт кнопку и получает сухую
// ошибку — здесь кнопка просто заблокирована с обратным отсчётом.
const RESEND_COOLDOWN_SEC = 60;
const emptyOtp = (n = OTP_LENGTH) => Array<string>(n).fill("");

/** Способ входа (решение владельца 2026-11-07): по умолчанию почта, второй — телефон. */
type SignInMethod = "email" | "phone";

export const Route = createFileRoute("/auth")({
  head: ({ match }) => {
    const t = getTranslator(match.context.locale);
    return { meta: [{ title: t("Вход — {brand}", { brand: APP_BRAND }) }] };
  },
  component: AuthPage,
});

function AuthPage() {
  const t = useT();
  const { requestOtp, verifyOtp, session, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"form" | "otp">("form");
  const [method, setMethod] = useState<SignInMethod>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const isPhone = method === "phone";
  // Длина кода: письмо — 6 цифр, SMS — 4.
  const codeLength = isPhone ? PHONE_CODE_LENGTH : OTP_LENGTH;
  // Куда ушёл код: почта или номер (с пометкой способа — пауза у каждого своя).
  const target = isPhone ? `phone:${phone.trim()}` : `email:${email.trim()}`;
  const [otp, setOtp] = useState(() => emptyOtp());
  const [busy, setBusy] = useState(false);
  const [otpFocused, setOtpFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Почта не найдена — под сообщением кнопки связи со студией (пакетное).
  const [notMember, setNotMember] = useState(false);
  // Согласие с политикой (Lady Stretch): без галочки код не запрашивается.
  const [consent, setConsent] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [cooldown, setCooldown] = useState(0);
  // На какой адрес ушёл последний код: «Изменить данные» → «Получить код» с
  // тем же адресом не должен обходить паузу между отправками.
  const [sentTo, setSentTo] = useState<string | null>(null);
  // «Вход закрыт» из админки (app_install_settings.sign_in_closed, решение
  // владельца 2026-10-14): приложение ставят до переноса базы клиентов —
  // вместо почты и согласия текст, когда откроем вход. Код, уже введённый
  // до закрытия (шаг otp), доводим до конца.
  // Значение со страницы — только первое: страница могла прийти устаревшей
  // (кэш сервера, копия service worker'а в установленном приложении), поэтому
  // флаг сразу перепроверяется в базе, при возвращении в приложение и, пока
  // вход закрыт, раз в 60–90 секунд — открыли вход, и форма появится сама.
  // Разброс — чтобы в минуту открытия клиенты, ждущие на этом экране, не
  // запросили коды все в одну секунду (лимиты писем, 2026-10-16).
  const ssrSignInClosed = useLoaderData({ from: "__root__" })?.signInClosed === true;
  const { data: signInClosedLive } = useQuery({
    queryKey: ["sign-in-closed"],
    queryFn: fetchSignInClosed,
    initialData: ssrSignInClosed,
    initialDataUpdatedAt: 0,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (q) => (q.state.data ? 60_000 + Math.random() * 30_000 : false),
    meta: { persist: false },
  });
  const signInClosed = signInClosedLive === true && step === "form";

  useEffect(() => {
    if (!loading && session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

  // Вошёл, но карточки клиента нет — приложение вышло само (use-client-studio).
  useEffect(() => {
    if (takeSignInRefused()) setError(notAMember(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- флаг читается один раз
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
    setNotMember(false);
    if (isPhone ? !isValidPhone(phone) : !email.trim()) {
      setError(isPhone ? t("Укажите номер телефона полностью") : t("Укажите email"));
      return;
    }
    if (PRIVACY_POLICY_INFO && !consent) {
      setConsentMissing(true);
      setError(t("Чтобы продолжить, примите политику конфиденциальности"));
      return;
    }
    if (cooldown > 0 && sentTo === target) {
      // Код на этот адрес уже отправлен и пауза не истекла — возвращаем к
      // вводу кода вместо повторной отправки.
      setStep("otp");
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
      return;
    }
    setBusy(true);
    if (isPhone) {
      const { error: phoneError } = await requestPhoneCode(phone);
      setBusy(false);
      if (phoneError) {
        setError(phoneErrorText(phoneError, t));
        setNotMember(phoneError === "not_a_club_member" || phoneError === "ambiguous_phone");
        return;
      }
    } else {
      const { error: sendError } = await requestOtp(email.trim());
      setBusy(false);
      if (sendError) {
        setError(humanizeAuthError(sendError, t));
        setNotMember(isNotAMemberError(sendError));
        return;
      }
    }
    setSentTo(target);
    setOtp(emptyOtp(codeLength));
    setStep("otp");
    setCooldown(RESEND_COOLDOWN_SEC);
    setTimeout(() => otpRefs.current[0]?.focus(), 50);
  };

  const resendCode = async () => {
    if (busy || cooldown > 0) return;
    setError(null);
    setBusy(true);
    if (isPhone) {
      const { error: phoneError } = await requestPhoneCode(phone);
      setBusy(false);
      if (phoneError) {
        setError(phoneErrorText(phoneError, t));
        return;
      }
    } else {
      const { error: sendError } = await requestOtp(email.trim());
      setBusy(false);
      if (sendError) {
        setError(humanizeAuthError(sendError, t));
        return;
      }
    }
    setOtp(emptyOtp(codeLength));
    setCooldown(RESEND_COOLDOWN_SEC);
    otpRefs.current[0]?.focus();
  };

  const submitOtp = async () => {
    if (otp.some((d) => d === "")) {
      setError(t("Введите {n}-значный код", { n: codeLength }));
      return;
    }
    setError(null);
    setBusy(true);
    // Успешная проверка создаёт сессию — редирект сработает через useEffect выше.
    // Салют на главной ставим заранее: сессия появляется ещё до ответа verifyOtp.
    queueHomeConfetti();
    const verifyError = isPhone
      ? await verifyPhoneCode(phone, otp.join("")).then((r) =>
          r.error ? phoneErrorText(r.error, t) : null,
        )
      : await verifyOtp(email.trim(), otp.join("")).then((r) =>
          r.error ? humanizeAuthError(r.error, t) : null,
        );
    if (verifyError) {
      cancelHomeConfetti();
      setError(verifyError);
    } else if (PRIVACY_POLICY_INFO && consent) {
      recordPrivacyConsent();
    }
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
    if (d && i < codeLength - 1) otpRefs.current[i + 1]?.focus();
  };

  const fillOtpFrom = (start: number, digits: string) => {
    setOtp((prev) => {
      const next = [...prev];
      for (let k = 0; k < digits.length && start + k < codeLength; k++) {
        next[start + k] = digits[k];
      }
      return next;
    });
    const last = Math.min(start + digits.length, codeLength) - 1;
    otpRefs.current[last]?.focus();
  };

  // Вставка кода целиком: в письме код бывает скопирован с пробелами или
  // вместе с текстом («Ваш код: 123 456») — берём только цифры. maxLength у
  // поля обрезал бы такую вставку до onChange, поэтому разбор — здесь.
  const pasteOtp = (start: number, text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, codeLength);
    if (!digits) return false;
    if (digits.length === codeLength) {
      setOtp(digits.split(""));
      otpRefs.current[IS_PACKAGES ? 0 : codeLength - 1]?.focus();
    } else {
      fillOtpFrom(IS_PACKAGES ? otp.join("").length : start, digits);
    }
    return true;
  };

  // Кнопка «Вставить код»: на iPhone долгое нажатие на ячейки кода не всегда
  // открывает меню «Вставить», а кнопка читает буфер обмена сама (iOS
  // показывает системное «Вставить» — одно нажатие).
  const [canReadClipboard, setCanReadClipboard] = useState(false);
  useEffect(() => {
    setCanReadClipboard(typeof navigator !== "undefined" && !!navigator.clipboard?.readText);
  }, []);
  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!pasteOtp(0, text)) {
        setError(
          isPhone
            ? t("В буфере обмена нет кода. Скопируйте код из SMS.")
            : t("В буфере обмена нет кода. Скопируйте код из письма."),
        );
      } else {
        setError(null);
      }
    } catch {
      // Отказ в доступе к буферу — молча: остаётся ввести код вручную.
    }
  };

  const subtitle = signInClosed
    ? null
    : step === "otp"
      ? isPhone
        ? t("Введите код из SMS, отправленного на {phone}", { phone })
        : t("Введите код, отправленный на {email}", { email })
      : isPhone
        ? IS_PACKAGES
          ? t("Войдите по номеру телефона, который вы указали в студии")
          : t("Войдите по номеру телефона, который вы указали в клубе")
        : IS_PACKAGES
          ? t("Войдите по почте, которую вы указали в студии")
          : t("Войдите по почте, которую вы указали в клубе");

  // Почта / Телефон — над полем (решение владельца 2026-11-07: по умолчанию
  // почта). Смена способа стирает ошибку; введённое в каждом поле остаётся.
  const methodSwitch = (
    <div role="tablist" aria-label={t("Способ входа")} className="flex rounded-full bg-field p-1">
      {(["email", "phone"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={method === m}
          onClick={() => {
            setMethod(m);
            setError(null);
            setNotMember(false);
          }}
          className={cn(
            "h-10 flex-1 rounded-full text-sm font-medium transition-colors",
            method === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {m === "email" ? t("Почта") : t("Телефон")}
        </button>
      ))}
    </div>
  );

  const phoneField = (
    <PhoneInput value={phone} onChange={setPhone} id="phone" aria-label={t("Номер телефона")} />
  );

  const emailInput = (
    <FloatingLabelInput
      label={t("Email")}
      id="email"
      name="email"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      autoComplete="email"
      inputMode="email"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
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
          const digits = e.target.value.replace(/\D/g, "").slice(0, codeLength);
          setOtp(Array.from({ length: codeLength }, (_, i) => digits[i] ?? ""));
        }}
        onPaste={(e) => {
          if (pasteOtp(0, e.clipboardData.getData("text"))) e.preventDefault();
        }}
        onFocus={() => setOtpFocused(true)}
        onBlur={() => setOtpFocused(false)}
        name="one-time-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={isPhone ? t("Код из SMS") : t("Код из письма")}
        // Поле невидимо, но НЕ opacity-0: iOS Safari не показывает у
        // полностью прозрачного поля ни меню «Вставить», ни подсказку кода
        // над клавиатурой («Из Почты»). Прозрачны только текст, фон и курсор
        // (так же делает библиотека input-otp).
        style={{ WebkitTextFillColor: "transparent" }}
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent"
      />
      {otp.map((d, i) => {
        const current =
          otpFocused &&
          (i === otpValue.length || (otpValue.length === codeLength && i === codeLength - 1));
        return (
          <div
            key={i}
            aria-hidden="true"
            className={`flex h-14 w-11 items-center justify-center rounded-xl text-xl font-bold transition-colors ${
              current ? "bg-field-focus" : "bg-field"
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
          name={i === 0 ? "one-time-code" : undefined}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          // Первая ячейка принимает автоподстановку кода целиком
          // (one-time-code): maxLength=1 обрезал бы её до одной цифры
          // ещё до onChange. Разбор по ячейкам делает setOtpDigit.
          maxLength={i === 0 ? codeLength : 1}
          value={d}
          onChange={(e) => setOtpDigit(i, e.target.value)}
          onPaste={(e) => {
            if (pasteOtp(i, e.clipboardData.getData("text"))) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !otp[i] && i > 0) {
              otpRefs.current[i - 1]?.focus();
            }
          }}
          className="h-14 w-11 rounded-xl bg-field text-center text-xl font-bold outline-none transition-colors focus:bg-field-focus"
        />
      ))}
    </div>
  );

  const otpLinks = (
    <>
      {canReadClipboard && (
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={busy}
          className="w-full text-center text-sm font-medium text-foreground disabled:opacity-50"
        >
          {t("Вставить код из буфера")}
        </button>
      )}
      <button
        type="button"
        onClick={resendCode}
        disabled={busy || cooldown > 0}
        className="w-full text-center text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {cooldown > 0
          ? t("Отправить код ещё раз можно через {time}", {
              time: formatCooldown(cooldown, t),
            })
          : t("Отправить код ещё раз")}
      </button>

      <button
        type="button"
        onClick={() => {
          setStep("form");
          setError(null);
        }}
        className="w-full text-center text-sm text-muted-foreground"
      >
        {isPhone ? t("Изменить номер") : t("Изменить почту")}
      </button>
    </>
  );

  const errorText = error && <p className="text-sm text-destructive text-center">{error}</p>;

  const closedText = t(
    "Спасибо за скачивание нового мобильного приложения. Вход в приложение мы откроем утром, 18 октября.",
  );

  const spinner = <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />;

  // Пакетное приложение — в оформлении разделов (тёмная шапка с огоньками и
  // белая панель), как онбординг; подписочное — как было.
  if (IS_PACKAGES) {
    return (
      <DarkFrame
        tall
        top={
          // Язык — справа от логотипа: его выбирают при первом открытии.
          <div className="mx-6 mt-4 flex items-center justify-between gap-3">
            <img src={packagesLogo} alt={t("Логотип студии")} className="h-auto w-[150px]" />
            <LanguageSwitcher />
          </div>
        }
        art={step === "otp" ? loginCodeArt : loginEmailArt}
        header={
          <div className="px-6 pt-2 pb-10">
            <h1 className="text-3xl font-semibold leading-tight">{t("Добро пожаловать")}</h1>
            {subtitle && <p className="mt-2 text-sm text-white/70">{subtitle}</p>}
          </div>
        }
        footer={
          signInClosed ? null : step === "form" ? (
            <Button type="submit" form="auth-email-form" disabled={busy} className="w-full">
              {busy ? spinner : t("Получить код")}
            </Button>
          ) : (
            <Button type="button" onClick={submitOtp} disabled={busy} className="w-full">
              {busy ? spinner : t("Подтвердить")}
            </Button>
          )
        }
      >
        {signInClosed ? (
          <p className="px-4 pt-6 pb-2 text-center text-base font-medium leading-relaxed">
            {closedText}
          </p>
        ) : step === "form" ? (
          // pb — запас снизу: прокрутка панели срезала нижний край поля.
          <form id="auth-email-form" onSubmit={requestCode} className="space-y-3 px-4 pt-6 pb-2">
            {/* name/id и autocomplete=email — телефон предлагает свою почту;
                без автозаглавной и автозамены — iOS иначе портит адрес. */}
            {methodSwitch}
            {isPhone ? (
              phoneField
            ) : (
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("Введите ваш email")}
                aria-label={t("Email")}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                required
              />
            )}
            <PrivacyConsent
              checked={consent}
              onCheckedChange={(v) => {
                setConsent(v);
                if (v && consentMissing) {
                  setConsentMissing(false);
                  setError(null);
                }
              }}
              invalid={consentMissing}
            />
            {errorText}
            {/* Почта или номер не найдены — сразу способы связаться со студией. */}
            {error && notMember && <StudioContactButtons />}
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
        {/* Логотип по центру, язык — сверху справа (не наезжает на логотип на узком экране). */}
        <LanguageSwitcher tone="light" className="absolute right-4 top-4" />
        <div className="flex flex-col items-center mb-10">
          <div className="text-2xl font-black tracking-widest">
            Base<span className="text-primary">40</span>
          </div>
        </div>

        {/* Heading */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold leading-tight">{t("Добро пожаловать")}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        {signInClosed ? (
          <p className="max-w-sm w-full mx-auto text-center text-base font-medium leading-relaxed">
            {closedText}
          </p>
        ) : step === "form" ? (
          <form onSubmit={requestCode} className="space-y-3 max-w-sm w-full mx-auto">
            {methodSwitch}
            {isPhone ? phoneField : emailInput}

            {error && <p className="text-sm text-destructive text-center">{error}</p>}

            <Button type="submit" disabled={busy} className="mt-2 w-full">
              {busy ? (
                <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
              ) : (
                t("Получить код")
              )}
            </Button>
          </form>
        ) : (
          <div className="space-y-4 max-w-sm w-full mx-auto">
            {otpInputs}

            {error && <p className="text-sm text-destructive text-center">{error}</p>}

            <Button type="button" onClick={submitOtp} disabled={busy} className="w-full">
              {busy ? (
                <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
              ) : (
                t("Подтвердить")
              )}
            </Button>

            {otpLinks}
          </div>
        )}
      </div>
    </div>
  );
}
