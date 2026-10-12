// Логика писем авторизации: какое письмо кому. Вынесена из роута
// src/routes/api/auth-email.ts, чтобы её можно было проверять тестом
// (bun test src/lib/auth-email.test.ts).

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
  if (!redirectTo) return false;
  try {
    return new URL(redirectTo).host === new URL(adminUrl).host;
  } catch {
    return false;
  }
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

const wrap = (inner: string) => `
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

const codeEmail = (title: string, lead: string, token: string) =>
  wrap(`
    <h2 style="margin:0;font-size:18px;color:#18181b">${title}</h2>
    <p style="color:#52525b;font-size:14px;line-height:1.5">${lead}</p>
    <div style="margin:20px 0;padding:16px;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;text-align:center">
      <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#18181b">${token}</span>
    </div>
    <p style="color:#52525b;font-size:13px">Код действует 1 час.</p>`);

export type OutgoingEmail = { to: string; subject: string; html: string };

const EMAIL_CHANGE_SUBJECT = "Подтверждение смены почты — Base40";

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
export function buildEmails(payload: HookPayload, fromAdminApp: boolean): OutgoingEmail[] {
  const { user, email_data } = payload;
  if (email_data.email_action_type === "email_change") {
    const newEmail = user.new_email || null;
    if (email_data.token_new && newEmail) {
      return [
        {
          to: user.email,
          subject: EMAIL_CHANGE_SUBJECT,
          html: codeEmail(
            "Смена почты",
            "Код для подтверждения смены почты (с текущего адреса):",
            email_data.token,
          ),
        },
        {
          to: newEmail,
          subject: EMAIL_CHANGE_SUBJECT,
          html: codeEmail(
            "Смена почты",
            "Код для подтверждения новой почты:",
            email_data.token_new,
          ),
        },
      ];
    }
    return [{ to: newEmail ?? user.email, ...buildEmail(payload, fromAdminApp) }];
  }
  return [{ to: user.email, ...buildEmail(payload, fromAdminApp) }];
}

export function buildEmail(
  payload: HookPayload,
  fromAdminApp: boolean,
): { subject: string; html: string } {
  const { token, email_action_type } = payload.email_data;

  switch (email_action_type) {
    case "signup":
      // Саморегистрации нет: учётную запись клиента GoTrue создаёт при первом
      // входе в клиентское приложение, и только по карточке клиента с портала
      // (db/migrations/…_client_signin_only.sql). В админке shouldCreateUser:
      // false, сотрудников заводит владелец.
      return {
        subject: "Код подтверждения — Base40",
        html: codeEmail("Добро пожаловать в Base40!", "Ваш код подтверждения:", token),
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
            subject: "Код для входа — Base40",
            html: codeEmail("Вход в Base40", "Ваш код для входа в приложение:", token),
          };
    // Восстановления и приглашений ни одно приложение не запрашивает (паролей
    // нет ни у кого, сотрудников создаёт админка), но /recover у GoTrue
    // публичный — кто угодно может вызвать его на чужую почту. Поэтому и тут
    // код, а не ссылка: в письмах авторизации ссылок авто-входа нет вовсе.
    case "recovery":
      return {
        subject: "Восстановление доступа — Base40",
        html: codeEmail("Восстановление доступа", "Ваш код для восстановления доступа:", token),
      };
    case "invite":
      return {
        subject: "Приглашение в Base40",
        html: codeEmail("Вас пригласили в Base40", "Ваш код для принятия приглашения:", token),
      };
    case "email_change":
      return {
        subject: EMAIL_CHANGE_SUBJECT,
        html: codeEmail("Смена почты", "Код для подтверждения новой почты:", token),
      };
    default:
      // reauthentication и будущие типы: код — универсальный запасной вариант.
      return {
        subject: "Код подтверждения — Base40",
        html: codeEmail("Подтверждение действия", "Ваш код подтверждения:", token),
      };
  }
}
