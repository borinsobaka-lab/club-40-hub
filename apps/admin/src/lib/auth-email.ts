// Логика писем авторизации: какое письмо кому. Вынесена из роута
// src/routes/api/auth-email.ts, чтобы её можно было проверять тестом
// (bun test src/lib/auth-email.test.ts).

import { MAIL_FROM_EMAIL, MAIL_FROM_NAME, type MailSender } from "./mail";

export type HookPayload = {
  user: {
    id: string;
    email: string;
    // Новый адрес при смене почты (email_change).
    new_email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

// Из какого приложения пришёл запрос. Разбирать redirect_to как URL
// обязательно: сравнение подстрокой пропустило бы, например,
// https://admin.base40.fit.evil.com.
export function isAdminApp(redirectTo: string | undefined): boolean {
  const adminUrl = process.env.ADMIN_APP_URL ?? "https://admin.base40.fit";
  return hostOf(redirectTo) !== null && hostOf(redirectTo) === hostOf(adminUrl);
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// Приложение пакетных клубов (Lady Stretch): новый адрес и прежний
// pack.base40.fit, на котором остались вошедшие клиенты. Через запятую в
// PACKAGES_APP_URLS — если адресов станет больше.
const PACKAGES_APP_URLS = "https://app.lady-stretch.one,https://pack.base40.fit";

export function isPackagesApp(redirectTo: string | undefined): boolean {
  const host = hostOf(redirectTo);
  if (!host) return false;
  return (process.env.PACKAGES_APP_URLS ?? PACKAGES_APP_URLS)
    .split(",")
    .some((url) => hostOf(url.trim()) === host);
}

// ---------------------------------------------------------------------------
// Бренд письма (решение владельца 2026-10-15): клиентам пакетных клубов —
// письма Lady Stretch (розовый #f763fc, серые бокового меню админки) с
// отдельного адреса; админке и подписочному приложению — Base40 как прежде.
// ---------------------------------------------------------------------------

export type EmailBrand = "base40" | "ladyStretch";

export function emailBrand(redirectTo: string | undefined): EmailBrand {
  return !isAdminApp(redirectTo) && isPackagesApp(redirectTo) ? "ladyStretch" : "base40";
}

const BRAND_NAME: Record<EmailBrand, string> = { base40: "Base40", ladyStretch: "Lady Stretch" };

/**
 * Отправитель письма. Lady Stretch — адрес из LADY_STRETCH_MAIL_FROM
 * (noreply@lady-stretch.one, когда домен подтверждён в Resend; AGENT_TASKS.md,
 * Задача 13). Пока переменной нет — прежний noreply@base40.fit под именем
 * Lady Stretch: с неподтверждённого домена Resend не отправит, и клиенты
 * остались бы без кода.
 */
export function emailSender(
  brand: EmailBrand,
  env: Record<string, string | undefined> = process.env,
): MailSender {
  if (brand === "base40") return { email: MAIL_FROM_EMAIL, name: MAIL_FROM_NAME };
  const custom = env.LADY_STRETCH_MAIL_FROM?.trim();
  const email =
    custom && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(custom) ? custom : MAIL_FROM_EMAIL;
  return { email, name: BRAND_NAME.ladyStretch };
}

// Письма входа в КЛИЕНТСКОЕ приложение, которые уходят только члену клуба
// (есть карточка клиента — привязанная или свободная с той же почтой). Новую
// учётную запись без карточки не создаст handle_new_user, но уже
// существующей GoTrue шлёт код как есть — её и останавливает хук
// (db/migrations/2026-10-12_client_account_wipe.sql). Смена почты и
// переподтверждение — у вошедшего клиента, их не трогаем.
const CLIENT_SIGN_IN_ACTIONS = new Set(["magiclink", "signup", "recovery", "invite"]);

export function needsClubMembership(payload: HookPayload, fromAdminApp: boolean): boolean {
  return !fromAdminApp && CLIENT_SIGN_IN_ACTIONS.has(payload.email_data.email_action_type);
}

/** Сообщение для приложения: тот же признак, что у ensure_client_profile. */
export const NOT_A_CLUB_MEMBER = "not_a_club_member";

// ---------------------------------------------------------------------------
// Письма. Инлайновые стили и литеральные цвета здесь уместны: это HTML почты,
// токены дизайн-системы приложения на неё не распространяются.
// ---------------------------------------------------------------------------

const wrapBase40 = (inner: string) => `
<div style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e4e4e7">
    <div style="font-size:20px;font-weight:900;font-style:italic;letter-spacing:0.04em">
      Base<span style="color:#d4be00">40</span>
    </div>
    <div style="margin-top:24px">${inner}</div>
    <p style="margin-top:28px;color:#a1a1aa;font-size:12px;line-height:1.5">
      Если вы не запрашивали это письмо — просто проигнорируйте его.
    </p>
  </div>
</div>`;

const codeBase40 = (title: string, lead: string, token: string) =>
  wrapBase40(`
    <h2 style="margin:0;font-size:18px;color:#18181b">${title}</h2>
    <p style="color:#52525b;font-size:14px;line-height:1.5">${lead}</p>
    <div style="margin:20px 0;padding:16px;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;text-align:center">
      <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#18181b">${token}</span>
    </div>
    <p style="color:#52525b;font-size:13px">Код действует 1 час.</p>`);

// Lady Stretch: светлое письмо (решение владельца 2026-10-15: тёмное —
// «мрачно»). Подложка — светло-серая, карточка белая, шапка карточки —
// розовый бренда #f763fc с белым логотипом, текст и цифры кода — серый
// бокового меню админки #1a2027, код — на бледно-розовой плашке с розовой
// рамкой. Вёрстка таблицами с bgcolor: почтовик, срезавший фон у div
// (Outlook), иначе потерял бы розовую шапку. Логотип — картинка с админки
// (public/email/, белый на розовом), без неё — подпись alt белым на розовом.
const LS_PINK = "#f763fc";
const LS_PINK_SOFT = "#fef0fe";
const LS_INK = "#1a2027";
const LS_PAGE = "#f4f4f6";
const LS_MUTED = "#5f6873";
const LS_FAINT = "#8a929c";
const LS_LOGO_URL = `${process.env.ADMIN_APP_URL ?? "https://admin.base40.fit"}/email/lady-stretch-logo-pink.png`;

const codeLadyStretch = (title: string, lead: string, token: string) => `
<div style="margin:0;padding:0;background:${LS_PAGE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LS_PAGE}" style="background:${LS_PAGE};font-family:Roboto,Arial,Helvetica,sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px">
      <tr><td align="center" bgcolor="${LS_PINK}" style="background:${LS_PINK};border-radius:20px 20px 0 0;padding:22px 16px">
        <img src="${LS_LOGO_URL}" width="140" height="40" alt="Lady Stretch" style="display:block;width:140px;height:40px;border:0;color:#ffffff;font-size:22px;font-weight:600">
      </td></tr>
      <tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:0 0 20px 20px;padding:32px 28px">
        <h2 style="margin:0;font-size:20px;font-weight:600;line-height:1.3;color:${LS_INK}">${title}</h2>
        <p style="margin:12px 0 0;color:${LS_MUTED};font-size:15px;line-height:1.5">${lead}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
          <tr><td align="center" bgcolor="${LS_PINK_SOFT}" style="background:${LS_PINK_SOFT};border:1px solid ${LS_PINK};border-radius:16px;padding:18px 8px">
            <span style="font-size:36px;font-weight:700;letter-spacing:10px;padding-left:10px;color:${LS_INK}">${token}</span>
          </td></tr>
        </table>
        <p style="margin:0;color:${LS_MUTED};font-size:13px;line-height:1.5">Код действует 1 час. Никому его не сообщайте.</p>
      </td></tr>
      <tr><td align="center" style="padding:24px 8px 0;color:${LS_FAINT};font-size:12px;line-height:1.5">
        Если вы не запрашивали это письмо — просто проигнорируйте его.<br>
        <span style="color:${LS_PINK}">&#9679;</span>&nbsp; Lady Stretch Tbilisi
      </td></tr>
    </table>
  </td></tr>
</table>
</div>`;

const CODE_EMAIL: Record<EmailBrand, (title: string, lead: string, token: string) => string> = {
  base40: codeBase40,
  ladyStretch: codeLadyStretch,
};

export type OutgoingEmail = { to: string; subject: string; html: string };

const emailChangeSubject = (brand: EmailBrand) =>
  `Подтверждение смены почты — ${BRAND_NAME[brand]}`;

/**
 * Все письма, которые нужно отправить по одному вызову хука.
 *
 * Обычно это одно письмо на user.email. Исключение — смена почты: код нужен
 * НОВОМУ адресу (user.new_email), а при включённой Secure Email Change —
 * обоим: текущему адресу token, новому token_new (см. документацию Supabase
 * Send Email Hook; имена token_hash/token_hash_new там перепутаны намеренно,
 * на суффикс _new не полагаемся). Раньше код уходил только на старый адрес,
 * и подтвердить новую почту было нечем.
 */
export function buildEmails(
  payload: HookPayload,
  fromAdminApp: boolean,
  brand: EmailBrand = "base40",
): OutgoingEmail[] {
  const { user, email_data } = payload;
  const b: EmailBrand = fromAdminApp ? "base40" : brand;
  const codeEmail = CODE_EMAIL[b];
  if (email_data.email_action_type === "email_change") {
    const newEmail = user.new_email || null;
    if (email_data.token_new && newEmail) {
      return [
        {
          to: user.email,
          subject: emailChangeSubject(b),
          html: codeEmail(
            "Смена почты",
            "Код для подтверждения смены почты (с текущего адреса):",
            email_data.token,
          ),
        },
        {
          to: newEmail,
          subject: emailChangeSubject(b),
          html: codeEmail(
            "Смена почты",
            "Код для подтверждения новой почты:",
            email_data.token_new,
          ),
        },
      ];
    }
    return [{ to: newEmail ?? user.email, ...buildEmail(payload, fromAdminApp, brand) }];
  }
  return [{ to: user.email, ...buildEmail(payload, fromAdminApp, brand) }];
}

export function buildEmail(
  payload: HookPayload,
  fromAdminApp: boolean,
  brand: EmailBrand = "base40",
): { subject: string; html: string } {
  const { token, email_action_type } = payload.email_data;
  // Админка — всегда Base40, какой бы бренд ни передали.
  const b: EmailBrand = fromAdminApp ? "base40" : brand;
  const name = BRAND_NAME[b];
  const codeEmail = CODE_EMAIL[b];

  switch (email_action_type) {
    case "signup":
      // Саморегистрации нет: учётную запись клиента GoTrue создаёт при первом
      // входе в клиентское приложение, и только по карточке клиента с портала
      // (db/migrations/…_client_signin_only.sql). В админке shouldCreateUser:
      // false, сотрудников заводит владелец.
      return {
        subject: `Код подтверждения — ${name}`,
        html: codeEmail(`Добро пожаловать в ${name}!`, "Ваш код подтверждения:", token),
      };
    // Вход — всегда код, в обоих приложениях. Ссылки авто-входа в письме
    // нет: её можно переслать или открыть превью почтовика, а код вводится
    // только вручную на странице входа. Приложение меняет лишь текст.
    case "magiclink":
      return fromAdminApp
        ? {
            subject: "Код для входа в админ-панель Base40",
            html: codeEmail(
              "Вход в админ-панель",
              "Введите этот код на странице входа в админ-панель. Никому его не сообщайте.",
              token,
            ),
          }
        : {
            subject: `Код для входа — ${name}`,
            html: codeEmail(`Вход в ${name}`, "Ваш код для входа в приложение:", token),
          };
    // Восстановления и приглашений ни одно приложение не запрашивает (паролей
    // нет ни у кого, сотрудников создаёт админка), но /recover у GoTrue
    // публичный — кто угодно может вызвать его на чужую почту. Поэтому и тут
    // код, а не ссылка: в письмах авторизации ссылок авто-входа нет вовсе.
    case "recovery":
      return {
        subject: `Восстановление доступа — ${name}`,
        html: codeEmail("Восстановление доступа", "Ваш код для восстановления доступа:", token),
      };
    case "invite":
      return {
        subject: `Приглашение в ${name}`,
        html: codeEmail(`Вас пригласили в ${name}`, "Ваш код для принятия приглашения:", token),
      };
    case "email_change":
      return {
        subject: emailChangeSubject(b),
        html: codeEmail("Смена почты", "Код для подтверждения новой почты:", token),
      };
    default:
      // reauthentication и будущие типы: код — универсальный запасной вариант.
      return {
        subject: `Код подтверждения — ${name}`,
        html: codeEmail("Подтверждение действия", "Ваш код подтверждения:", token),
      };
  }
}
