// Отправка писем с сервера — через Resend (RESEND_API_KEY, решение владельца
// 2026-10-11; Unisender Go, подключавшийся раньше, убран). Ключ — только
// runtime-переменная Coolify у club40-admin, в бандл не попадает. Адрес
// отправителя — на домене base40.fit: он подтверждён в Resend, поэтому письма
// уходят на любые адреса (тестовый домен resend.dev слал бы только владельцу
// аккаунта).

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const MAIL_FROM_EMAIL = "noreply@base40.fit";
export const MAIL_FROM_NAME = "Base40";

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

  if (!mailProvider(env)) return { ok: false, error: "mail provider not configured" };

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
        // Текстовая версия рядом с HTML — меньше шансов попасть в спам.
        text: msg.text ?? htmlToText(msg.html),
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    });
    if (res.ok) return { ok: true };
    // Ошибка Resend: {"statusCode":403,"name":"validation_error","message":"..."}.
    const raw = await res.text().catch(() => "");
    let detail = raw;
    try {
      const data = JSON.parse(raw) as { name?: string; message?: string };
      if (data.message) detail = `${data.message}${data.name ? ` (${data.name})` : ""}`;
    } catch {
      // не JSON — оставляем текст как есть
    }
    const error = `Resend ${res.status}: ${detail}`;
    console.error("[mail]", error);
    return { ok: false, error };
  } catch (e) {
    const error = `Resend fetch failed: ${(e as Error).message}`;
    console.error("[mail]", error);
    return { ok: false, error };
  }
}
