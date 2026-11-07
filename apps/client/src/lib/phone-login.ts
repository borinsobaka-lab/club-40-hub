import { supabase } from "@/integrations/supabase/client";
import { APP_FORMAT } from "@/lib/app-format";
import { APP_VERSION } from "@/lib/app-version";
import { readDocumentLocale } from "@/i18n/locales";

/**
 * Вход по номеру телефона (решение владельца 2026-11-07): второй способ
 * рядом с почтой. Код в SMS (4 цифры) шлёт и проверяет Prelude — через
 * сервер админки (`apps/admin/src/routes/api/phone-login.ts`): ключ Prelude и
 * сервис-ключ Supabase есть только там. Пускает он, как и вход по почте,
 * только члена клуба — номер должен быть в карточке клиента. После проверки
 * сервер отдаёт одноразовый токен входа (браузер меняет его на сессию —
 * `verifyOtp`) или сразу сессию (учётная запись без почты) — дальше путь
 * клиента тот же, что после кода из письма.
 */

/** Длина кода из SMS (Prelude, options.code_size на сервере). */
export const PHONE_CODE_LENGTH = 4;

/** Адрес API входа — сервер админки; дев-сервер — VITE_AUTH_API_URL. */
const AUTH_API_URL =
  (import.meta.env.VITE_AUTH_API_URL as string | undefined) ?? "https://admin.base40.fit";

export type PhoneLoginError =
  | "bad_request"
  | "invalid_phone"
  | "not_a_club_member"
  | "ambiguous_phone"
  | "staff_use_email"
  | "sign_in_closed"
  | "too_many_requests"
  | "blocked"
  | "invalid_code"
  | "expired_code"
  | "not_configured"
  | "server_error"
  | "network";

function deviceId(): string | null {
  try {
    return window.localStorage.getItem("base40.deviceId");
  } catch {
    return null;
  }
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${AUTH_API_URL}/api/phone-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, format: APP_FORMAT, locale: readDocumentLocale() }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && typeof data.error !== "string") return { error: "server_error" };
    return data;
  } catch {
    return { error: "network" };
  }
}

const errorOf = (data: Record<string, unknown>): PhoneLoginError | null =>
  typeof data.error === "string" ? (data.error as PhoneLoginError) : null;

/** Отправить код в SMS. */
export async function requestPhoneCode(phone: string): Promise<{ error: PhoneLoginError | null }> {
  const data = await call({
    action: "send",
    phone,
    deviceId: deviceId(),
    appVersion: APP_VERSION,
  });
  return { error: data.ok ? null : (errorOf(data) ?? "server_error") };
}

/** Проверить код и войти (сессия появляется в supabase-js, как после кода из письма). */
export async function verifyPhoneCode(
  phone: string,
  code: string,
): Promise<{ error: PhoneLoginError | null }> {
  const data = await call({ action: "verify", phone, code });
  if (!data.ok) return { error: errorOf(data) ?? "server_error" };
  if (typeof data.token_hash === "string") {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: "magiclink",
    });
    return { error: error ? "server_error" : null };
  }
  if (typeof data.access_token === "string" && typeof data.refresh_token === "string") {
    const { error } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    return { error: error ? "server_error" : null };
  }
  return { error: "server_error" };
}
