import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

// Send Email Hook для Supabase Auth: Supabase больше не шлёт письма сам, а
// дёргает этот эндпоинт, и мы отправляем письмо через Resend с
// noreply@base40.fit. Смысл: клиентам и сотрудникам уходят РАЗНЫЕ письма —
// клиенту 4-значный код, сотруднику ссылка авто-входа. Кто есть кто,
// определяется по роли в user_roles (owner/admin/trainer = сотрудник),
// а не по тому, в какое приложение введён email.
//
// Настройка: Supabase Dashboard -> Authentication -> Hooks -> Send Email ->
// HTTPS, URL https://admin.base40.fit/api/auth-email; выданный секрет и ключ
// Resend задать в Coolify (SEND_EMAIL_HOOK_SECRET, RESEND_API_KEY).
// Пока переменные не заданы, роут отвечает 500 и Supabase шлёт письма сам —
// хук в дашборде стоит включать только после задания переменных.

type HookPayload = {
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

async function isStaff(userId: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["owner", "admin", "trainer"])
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error("[auth-email] role lookup failed, treating as client", e);
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

function buildEmail(payload: HookPayload, staff: boolean): { subject: string; html: string } {
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
      // Саморегистрация есть только у клиентов мобильного приложения.
      return {
        subject: "Код подтверждения — CLUB 40",
        html: codeEmail("Добро пожаловать в CLUB 40!", "Ваш код подтверждения:", token),
      };
    case "magiclink":
      return staff
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

export const Route = createFileRoute("/api/auth-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.SEND_EMAIL_HOOK_SECRET;
        const resendKey = process.env.RESEND_API_KEY;
        if (!secret || !resendKey) {
          console.error("[auth-email] SEND_EMAIL_HOOK_SECRET / RESEND_API_KEY не заданы");
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

        const staff = await isStaff(payload.user.id);
        const { subject, html } = buildEmail(payload, staff);

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "CLUB 40 <noreply@base40.fit>",
            to: payload.user.email,
            subject,
            html,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("[auth-email] Resend error", res.status, text);
          // Не-200 заставит Supabase показать ошибку отправки и повторить.
          return new Response("email send failed", { status: 500 });
        }

        return new Response("{}", {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
