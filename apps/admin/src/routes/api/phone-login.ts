import { createFileRoute } from "@tanstack/react-router";

import { hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import {
  appFormat,
  isAllowedOrigin,
  normalizeCode,
  normalizePhone,
  type PhoneLoginError,
} from "@/lib/phone-login";
import { hasPrelude, sendPhoneCode, verifyPhoneCode } from "@/lib/phone-login.server";

// Вход в клиентское приложение по номеру телефона (решение владельца
// 2026-11-07): приложение (app.base40.fit, app.lady-stretch.one) зовёт этот
// роут из браузера — ключ Prelude и сервис-ключ Supabase есть только здесь.
// POST { action: "send", phone, format, locale, deviceId?, appVersion? } →
// { ok } | { error }; POST { action: "verify", phone, code, format, locale } →
// { ok, token_hash } (браузер меняет на сессию через verifyOtp) или
// { ok, access_token, refresh_token } (учётная запись без почты). Логика —
// lib/phone-login.server.ts. Доп. адреса приложений (дев-сервер) —
// PHONE_LOGIN_ORIGINS через запятую.

const MAX_BODY_BYTES = 4 * 1024;

function corsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin, process.env.PHONE_LOGIN_ORIGINS)) return {};
  return {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function reply(origin: string | null, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(origin), "Cache-Control": "no-store" },
  });
}

function fail(origin: string | null, error: PhoneLoginError) {
  const status =
    error === "bad_request" || error === "invalid_phone"
      ? 400
      : error === "too_many_requests"
        ? 429
        : error === "not_configured" || error === "server_error"
          ? 503
          : 403;
  return reply(origin, { error }, status);
}

/** Адрес клиента: первый в X-Forwarded-For (прокси Coolify), иначе X-Real-IP. */
function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim();
  return ip && ip.length <= 45 ? ip : null;
}

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

export const Route = createFileRoute("/api/phone-login")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) }),

      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (!isAllowedOrigin(origin, process.env.PHONE_LOGIN_ORIGINS)) {
          return new Response("forbidden origin", { status: 403 });
        }
        if (!hasSupabaseAdmin() || !hasPrelude()) return fail(origin, "not_configured");

        const text = await request.text();
        if (text.length > MAX_BODY_BYTES) return fail(origin, "bad_request");
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          return fail(origin, "bad_request");
        }
        const phone = normalizePhone(body.phone);
        if (!phone) return fail(origin, "invalid_phone");
        const format = appFormat(body.format);
        const req = { ip: clientIp(request), userAgent: request.headers.get("user-agent") };

        if (body.action === "send") {
          const res = await sendPhoneCode({
            phone,
            format,
            locale: body.locale,
            deviceId: str(body.deviceId, 100),
            appVersion: str(body.appVersion, 20),
            req,
          });
          return res.ok ? reply(origin, { ok: true }) : fail(origin, res.error);
        }
        if (body.action === "verify") {
          const code = normalizeCode(body.code);
          if (!code) return fail(origin, "invalid_code");
          const res = await verifyPhoneCode({ phone, code, format, locale: body.locale, req });
          return res.ok
            ? reply(
                origin,
                res.session.kind === "token_hash"
                  ? { ok: true, token_hash: res.session.token_hash }
                  : {
                      ok: true,
                      access_token: res.session.access_token,
                      refresh_token: res.session.refresh_token,
                    },
              )
            : fail(origin, res.error);
        }
        return fail(origin, "bad_request");
      },
    },
  },
});
