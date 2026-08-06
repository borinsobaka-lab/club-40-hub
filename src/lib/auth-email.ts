// Логика писем авторизации: какое письмо кому. Вынесена из роута
// src/routes/api/auth-email.ts, чтобы её можно было проверять тестом
// (bun test src/lib/auth-email.test.ts).

export type HookPayload = {
  user: {
    id: string;
    email: string;
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

// ---------------------------------------------------------------------------
// Письма. Инлайновые стили и литеральные цвета здесь уместны: это HTML почты,
// токены дизайн-системы приложения на неё не распространяются.
// ---------------------------------------------------------------------------

const wrap = (inner: string) => `
<div style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e4e4e7">
    <div style="font-size:20px;font-weight:900;font-style:italic;letter-spacing:0.04em">
      CLUB <span style="color:#d4be00">40</span>
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

const linkEmail = (title: string, lead: string, url: string, cta: string) =>
  wrap(`
    <h2 style="margin:0;font-size:18px;color:#18181b">${title}</h2>
    <p style="color:#52525b;font-size:14px;line-height:1.5">${lead}</p>
    <div style="margin:24px 0;text-align:center">
      <a href="${url}"
         style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:999px">
        ${cta}
      </a>
    </div>
    <p style="color:#52525b;font-size:13px">Ссылка действует 1 час и работает один раз.</p>`);

export function buildEmail(
  payload: HookPayload,
  fromAdminApp: boolean,
): { subject: string; html: string } {
  const { token, token_hash, redirect_to, email_action_type, site_url } = payload.email_data;
  const supabaseUrl =
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    "";
  const verifyUrl =
    `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(token_hash)}` +
    `&type=${encodeURIComponent(email_action_type)}` +
    `&redirect_to=${encodeURIComponent(redirect_to || site_url)}`;

  switch (email_action_type) {
    case "signup":
      // Саморегистрация есть только в клиентском приложении: в админке
      // shouldCreateUser: false, сотрудников заводит владелец.
      return {
        subject: "Код подтверждения — CLUB 40",
        html: codeEmail("Добро пожаловать в CLUB 40!", "Ваш код подтверждения:", token),
      };
    case "magiclink":
      return fromAdminApp
        ? {
            subject: "Вход в админ-панель CLUB 40",
            html: linkEmail(
              "Вход в админ-панель",
              "Нажмите кнопку, чтобы войти. Никому не пересылайте это письмо.",
              verifyUrl,
              "Войти в админ-панель",
            ),
          }
        : {
            subject: "Код для входа — CLUB 40",
            html: codeEmail("Вход в CLUB 40", "Ваш код для входа в приложение:", token),
          };
    // Восстановление пароля существует только в админке — у клиентов паролей
    // нет, вход только по коду. Ссылка здесь обязательна: новый пароль
    // задаётся на странице.
    case "recovery":
      return {
        subject: "Восстановление доступа — CLUB 40",
        html: linkEmail(
          "Восстановление доступа",
          "Нажмите кнопку, чтобы задать новый пароль.",
          verifyUrl,
          "Задать новый пароль",
        ),
      };
    case "invite":
      return {
        subject: "Приглашение в CLUB 40",
        html: linkEmail(
          "Вас пригласили в CLUB 40",
          "Нажмите кнопку, чтобы принять приглашение и создать аккаунт.",
          verifyUrl,
          "Принять приглашение",
        ),
      };
    case "email_change":
      return {
        subject: "Подтверждение смены почты — CLUB 40",
        html: codeEmail("Смена почты", "Код для подтверждения новой почты:", token),
      };
    default:
      // reauthentication и будущие типы: код — универсальный запасной вариант.
      return {
        subject: "Код подтверждения — CLUB 40",
        html: codeEmail("Подтверждение действия", "Ваш код подтверждения:", token),
      };
  }
}
