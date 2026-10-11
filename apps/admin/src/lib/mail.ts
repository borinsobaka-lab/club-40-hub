// Отправка писем с сервера. Провайдер — Unisender Go, если задан
// UNISENDER_GO_API_KEY; иначе по-старому Resend (RESEND_API_KEY). Запасной
// путь через Resend живёт до переключения ключа и будет удалён отдельным
// шагом. Ключи — только runtime-переменные Coolify, в бандл не попадают.

const UNISENDER_GO_ENDPOINT = "https://go2.unisender.ru/ru/transactional/api/v1/email/send.json";
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

export function mailProvider(env: Env = process.env): "unisender" | "resend" | null {
  if (env.UNISENDER_GO_API_KEY) return "unisender";
  if (env.RESEND_API_KEY) return "resend";
  return null;
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
  if (provider === "unisender") {
    const message: Record<string, unknown> = {
      recipients: recipients.map((email) => ({ email })),
      from_email: MAIL_FROM_EMAIL,
      from_name: MAIL_FROM_NAME,
      subject: msg.subject,
      body: { html: msg.html, plaintext: msg.text ?? htmlToText(msg.html) },
      track_links: 0,
      track_read: 0,
    };
    if (msg.replyTo) message.reply_to = msg.replyTo;
    try {
      const res = await fetch(UNISENDER_GO_ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-KEY": env.UNISENDER_GO_API_KEY!,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
      });
      const raw = await res.text().catch(() => "");
      let data: { status?: string; message?: string; code?: number | string } | null = null;
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
      if (res.ok && data?.status === "success") return { ok: true };
      const error = data
        ? `Unisender Go ${res.status}: ${data.message ?? ""} (code ${data.code ?? "—"})`
        : `Unisender Go ${res.status}: ${raw}`;
      console.error("[mail]", error);
      return { ok: false, error };
    } catch (e) {
      const error = `Unisender Go fetch failed: ${(e as Error).message}`;
      console.error("[mail]", error);
      return { ok: false, error };
    }
  }

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
