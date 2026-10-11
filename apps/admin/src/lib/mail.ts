// Отправка писем с сервера через Resend (RESEND_API_KEY). С 2026-10-11 —
// единственный провайдер: Unisender Go отключён (решение владельца), домен
// base40.fit верифицирован в Resend. Ключ — только runtime-переменная Coolify
// у club40-admin, в бандл не попадает.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const MAIL_FROM_EMAIL = "noreply@base40.fit";
export const MAIL_FROM_NAME = "Base40";

// Сколько ждём ответа провайдера. GoTrue ждёт хук писем ~5 секунд и при
// неудаче повторяет его; если зависший провайдер всё же отправит письмо
// позже, человек получит два кода. Обрываем раньше и отвечаем ошибкой.
const MAIL_TIMEOUT_MS = 4000;

export type MailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type MailResult = { ok: true } | { ok: false; error: string };

type Env = Record<string, string | undefined>;

export function mailProvider(env: Env = process.env): "resend" | null {
  return env.RESEND_API_KEY ? "resend" : null;
}

// Текстовая версия письма: HTML без тегов, ссылки — адресом в скобках.
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      return label && label !== href ? `${label}: ${href}` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendMail(msg: MailMessage, env: Env = process.env): Promise<MailResult> {
  const recipients = (Array.isArray(msg.to) ? msg.to : [msg.to]).filter(Boolean);
  if (recipients.length === 0) return { ok: false, error: "no recipients" };

  const provider = mailProvider(env);
  if (provider === "resend") {
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${MAIL_FROM_NAME} <${MAIL_FROM_EMAIL}>`,
          to: recipients,
          subject: msg.subject,
          html: msg.html,
          text: msg.text ?? htmlToText(msg.html),
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      const error = `Resend ${res.status}: ${await res.text().catch(() => "")}`;
      console.error("[mail]", error);
      return { ok: false, error };
    } catch (e) {
      const error = `Resend fetch failed: ${(e as Error).message}`;
      console.error("[mail]", error);
      return { ok: false, error };
    }
  }

  return { ok: false, error: "mail provider not configured" };
}
