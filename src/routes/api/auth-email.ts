import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

import { buildEmails, isAdminApp, type HookPayload } from "@/lib/auth-email";
import { mailProvider, sendMail } from "@/lib/mail";

// Send Email Hook для Supabase Auth: Supabase больше не шлёт письма сам, а
// дёргает этот эндпоинт, и мы отправляем письмо с noreply@base40.fit через
// Unisender Go (если задан UNISENDER_GO_API_KEY), иначе по-старому через
// Resend — см. src/lib/mail.ts.
//
// РАЗДЕЛЕНИЕ ИДЁТ ПО ПРИЛОЖЕНИЮ, А НЕ ПО ЧЕЛОВЕКУ. Админка и клиентское
// приложение — разные сущности: один и тот же человек может быть и
// администратором, и клиентом. Если он вошёл в клиентское приложение, он
// клиент и получает 4-значный код; письма админки в клиентском приложении
// появляться не должны никогда.
//
// Признак приложения — хост в email_data.redirect_to (его явно задают оба
// приложения через emailRedirectTo). Совпал с ADMIN_APP_URL -> письмо
// админки; во всех остальных случаях, включая нераспознанный redirect_to,
// отправляется клиентское письмо с кодом. Такой перекос безопасен: ссылка
// авто-входа — полноценный доступ, и слать её «на всякий случай» нельзя,
// а лишний код максимум неудобен.
//
// Настройка: Supabase Dashboard -> Authentication -> Hooks -> Send Email ->
// HTTPS, URL https://admin.base40.fit/api/auth-email; выданный секрет и ключ
// почты задать в Coolify (SEND_EMAIL_HOOK_SECRET, UNISENDER_GO_API_KEY или
// RESEND_API_KEY).
// Пока переменные не заданы, роут отвечает 500 и Supabase шлёт письма сам —
// хук в дашборде стоит включать только после задания переменных.

// Подпись standardized-webhooks: HMAC-SHA256(base64secret, "{id}.{ts}.{body}").
function verifySignature(secretRaw: string, id: string, ts: string, sig: string, body: string) {
  const secretB64 = secretRaw.replace(/^v1,/, "").replace(/^whsec_/, "");
  const mac = createHmac("sha256", Buffer.from(secretB64, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  // Заголовок может содержать несколько подписей: "v1,<sig1> v1,<sig2>".
  return sig.split(" ").some((part) => {
    const candidate = part.replace(/^v1,/, "");
    const a = Buffer.from(mac);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export const Route = createFileRoute("/api/auth-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.SEND_EMAIL_HOOK_SECRET;
        if (!secret || !mailProvider()) {
          console.error(
            "[auth-email] SEND_EMAIL_HOOK_SECRET / UNISENDER_GO_API_KEY (или RESEND_API_KEY) не заданы",
          );
          return new Response("hook not configured", { status: 500 });
        }

        const body = await request.text();
        const id = request.headers.get("webhook-id") ?? "";
        const ts = request.headers.get("webhook-timestamp") ?? "";
        const sig = request.headers.get("webhook-signature") ?? "";
        if (!id || !ts || !sig || !verifySignature(secret, id, ts, sig, body)) {
          return new Response("invalid signature", { status: 401 });
        }
        // Защита от повтора: подписи старше 5 минут не принимаем.
        if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
          return new Response("stale timestamp", { status: 401 });
        }

        let payload: HookPayload;
        try {
          payload = JSON.parse(body) as HookPayload;
        } catch {
          return new Response("bad payload", { status: 400 });
        }
        if (!payload?.user?.email || !payload?.email_data?.email_action_type) {
          return new Response("bad payload", { status: 400 });
        }

        const fromAdminApp = isAdminApp(payload.email_data.redirect_to);

        for (const email of buildEmails(payload, fromAdminApp)) {
          const sent = await sendMail(email);
          if (!sent.ok) {
            console.error("[auth-email] письмо не отправлено:", sent.error);
            // Не-200 заставит Supabase показать ошибку отправки и повторить.
            return new Response("email send failed", { status: 500 });
          }
        }

        return new Response("{}", {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
