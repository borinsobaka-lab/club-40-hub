import { randomBytes } from "node:crypto";

import { createAnonClient, getSupabaseAdmin } from "@/integrations/supabase/client.server";
import {
  mapPreludeError,
  preludeLocale,
  resolveIdentity,
  type PhoneCandidate,
  type PhoneIdentity,
  type PhoneLoginError,
} from "@/lib/phone-login";

/**
 * Вход в клиентское приложение по телефону — сервер (решение владельца
 * 2026-11-07). Код в SMS шлёт и проверяет Prelude Verify API
 * (https://docs.prelude.so/verify/v2): POST /v2/verification — отправить
 * (повтор на тот же номер в окне проверки — новая попытка той же проверки,
 * status retry), POST /v2/verification/check — проверить. Ключ —
 * PRELUDE_API_TOKEN (runtime-секрет club40-admin, Dashboard Prelude → API
 * Keys). Код — 4 цифры (options.code_size).
 *
 * Сессия — той же учётной записи, что при входе по почте (схема —
 * db/migrations/2026-11-07_zzz_phone_login.sql): у учётной записи есть почта
 * — одноразовый токен ссылки входа (generate_link, письмо не уходит),
 * браузер сам обменивает его на сессию (verifyOtp token_hash, с адреса
 * клиента — у GoTrue предел проверок на адрес); почты нет — вход по
 * разовому паролю здесь же, пароль сразу стирается.
 */

const PRELUDE_URL = "https://api.prelude.dev/v2";
const PRELUDE_TIMEOUT_MS = 10_000;
const CODE_SIZE = 4;

export function hasPrelude() {
  return !!process.env.PRELUDE_API_TOKEN;
}

type PreludeResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code?: string };

async function prelude(path: string, body: unknown): Promise<PreludeResult> {
  try {
    const res = await fetch(`${PRELUDE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PRELUDE_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PRELUDE_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data };
    const code = typeof data.code === "string" ? data.code : undefined;
    console.error(
      `[phone-login] Prelude ${path}: ${res.status} ${code ?? ""} ${data.message ?? ""}`,
    );
    return { ok: false, status: res.status, code };
  } catch (e) {
    console.error(`[phone-login] Prelude ${path}:`, (e as Error).message);
    return { ok: false, status: 0 };
  }
}

export type RequestInfo = { ip: string | null; userAgent: string | null };

type Fail = { ok: false; error: PhoneLoginError };

async function signInClosed(format: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from("app_install_settings")
    .select("*")
    .eq("format", format)
    .maybeSingle();
  return (data as { sign_in_closed?: boolean } | null)?.sign_in_closed === true;
}

/** Человек за номером или ошибка. */
async function identityFor(
  phone: string,
  format: string,
): Promise<{ ok: true; identity: PhoneIdentity } | Fail> {
  const { data, error } = await getSupabaseAdmin().rpc("phone_login_lookup", {
    p_phone: phone,
    p_format: format,
  });
  if (error) {
    console.error("[phone-login] lookup:", error.message);
    return { ok: false, error: "server_error" };
  }
  const identity = resolveIdentity((data ?? []) as PhoneCandidate[]);
  if (identity === "not_found") return { ok: false, error: "not_a_club_member" };
  if (identity === "ambiguous") return { ok: false, error: "ambiguous_phone" };
  return { ok: true, identity };
}

async function throttle(phone: string, ip: string | null, kind: "send" | "check") {
  const { data, error } = await getSupabaseAdmin().rpc("phone_login_throttle", {
    p_phone: phone,
    p_ip: ip,
    p_kind: kind,
  });
  if (error) {
    console.error("[phone-login] throttle:", error.message);
    return "server_error" as const;
  }
  return data ? ("too_many_requests" as const) : null;
}

/** Отправить код: номер должен быть в карточке клиента клуба формата приложения. */
export async function sendPhoneCode(args: {
  phone: string;
  format: "packages" | "subscription";
  locale: unknown;
  deviceId: string | null;
  appVersion: string | null;
  req: RequestInfo;
}): Promise<{ ok: true } | Fail> {
  if (!hasPrelude()) return { ok: false, error: "not_configured" };
  if (await signInClosed(args.format)) return { ok: false, error: "sign_in_closed" };
  const who = await identityFor(args.phone, args.format);
  if (!who.ok) return who;
  const limited = await throttle(args.phone, args.req.ip, "send");
  if (limited) return { ok: false, error: limited };

  const locale = preludeLocale(args.locale);
  const res = await prelude("/verification", {
    target: { type: "phone_number", value: args.phone },
    signals: {
      ...(args.req.ip ? { ip: args.req.ip } : {}),
      ...(args.req.userAgent ? { user_agent: args.req.userAgent.slice(0, 500) } : {}),
      ...(args.deviceId ? { device_id: args.deviceId.slice(0, 100) } : {}),
      ...(args.appVersion ? { app_version: args.appVersion.slice(0, 20) } : {}),
      device_platform: "web",
    },
    options: { code_size: CODE_SIZE, ...(locale ? { locale } : {}) },
  });
  if (!res.ok) {
    if (res.status === 429) return { ok: false, error: "too_many_requests" };
    return { ok: false, error: res.status === 0 ? "server_error" : mapPreludeError(res.code) };
  }
  const status = res.data.status;
  if (status === "blocked") {
    console.warn(`[phone-login] Prelude blocked: ${res.data.reason ?? ""}`);
    return {
      ok: false,
      error: res.data.reason === "repeated_attempts" ? "too_many_requests" : "blocked",
    };
  }
  // success — новое окно проверки, retry — новая попытка в том же окне;
  // challenged / shadow_blocked включаются только через поддержку Prelude.
  return { ok: true };
}

export type PhoneSession =
  | { kind: "token_hash"; token_hash: string }
  | { kind: "session"; access_token: string; refresh_token: string };

/** Проверить код и выдать вход. */
export async function verifyPhoneCode(args: {
  phone: string;
  code: string;
  format: "packages" | "subscription";
  locale: unknown;
  req: RequestInfo;
}): Promise<{ ok: true; session: PhoneSession } | Fail> {
  if (!hasPrelude()) return { ok: false, error: "not_configured" };
  const limited = await throttle(args.phone, args.req.ip, "check");
  if (limited) return { ok: false, error: limited };
  const who = await identityFor(args.phone, args.format);
  if (!who.ok) return who;

  const res = await prelude("/verification/check", {
    target: { type: "phone_number", value: args.phone },
    code: args.code,
  });
  if (!res.ok) {
    if (res.status === 429) return { ok: false, error: "too_many_requests" };
    return { ok: false, error: res.status === 0 ? "server_error" : mapPreludeError(res.code) };
  }
  if (res.data.status === "expired_or_not_found") return { ok: false, error: "expired_code" };
  if (res.data.status !== "success") return { ok: false, error: "invalid_code" };

  try {
    return { ok: true, session: await sessionFor(who.identity, args) };
  } catch (e) {
    if (e instanceof StaffAccount) return { ok: false, error: "staff_use_email" };
    console.error("[phone-login] session:", (e as Error).message);
    return { ok: false, error: "server_error" };
  }
}

/** Учётная запись сотрудника — по телефону не входим (phone_login_is_staff). */
class StaffAccount extends Error {}

/** Учётная запись (найти или создать) и вход в неё. */
async function sessionFor(
  identity: PhoneIdentity,
  args: { phone: string; format: string; locale: unknown },
): Promise<PhoneSession> {
  const admin = getSupabaseAdmin();
  const meta = {
    app_format: args.format,
    ...(typeof args.locale === "string" ? { locale: args.locale } : {}),
  };
  const link = async (clientId: string, userId: string) => {
    const { data, error } = await admin.rpc("phone_login_link_client", {
      p_client: clientId,
      p_user: userId,
    });
    if (error) throw new Error(`link: ${error.message}`);
    if (data !== true) throw new Error("link: карточка уже привязана к другой учётной записи");
  };
  const accountBy = async (email: string | null, phone: string | null) => {
    const { data, error } = await admin.rpc("phone_login_account", {
      p_email: email,
      p_phone: phone,
    });
    if (error) throw new Error(`account: ${error.message}`);
    return (data as string | null) ?? null;
  };

  let userId: string;
  let email: string | null;
  if (identity.kind === "account") {
    userId = identity.userId;
    email = identity.email;
    // Карточка с почтой, а учётная запись без неё (входили по телефону,
    // почту в карточку дописали позже) — дописываем: тогда войти можно и
    // по почте. Почта занята другой учётной записью — входим по паролю.
    const { data } = await admin.auth.admin.getUserById(userId);
    const accountEmail = data.user?.email ?? null;
    if (!accountEmail && email) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      });
      if (error) email = null;
    } else {
      email = accountEmail;
    }
  } else if (identity.kind === "email") {
    email = identity.email;
    const existing = await accountBy(email, null);
    if (existing) {
      userId = existing;
      await link(identity.clientIds[0], userId);
    } else {
      // handle_new_user привяжет карточку с этой почтой (как при входе по почте).
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: meta,
      });
      if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
      userId = data.user.id;
    }
  } else {
    email = null;
    const existing = await accountBy(null, args.phone);
    if (existing) {
      userId = existing;
      await link(identity.clientId, userId);
    } else {
      // handle_new_user привяжет карточку из app_metadata (задаёт только сервер).
      const { data, error } = await admin.auth.admin.createUser({
        phone: args.phone,
        phone_confirm: true,
        user_metadata: meta,
        app_metadata: { phone_login_client: identity.clientId },
      });
      if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
      userId = data.user.id;
    }
  }

  // Сотрудник: сессия по SMS открыла бы и админку — только по почте.
  const { data: staff, error: staffError } = await admin.rpc("phone_login_is_staff", {
    p_user: userId,
  });
  if (staffError) throw new Error(`staff: ${staffError.message}`);
  if (staff === true) throw new StaffAccount();

  if (email) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) throw new Error(`generateLink: ${error?.message}`);
    return { kind: "token_hash", token_hash: tokenHash };
  }

  // Без почты: телефон учётной записи (нет — этот номер) и разовый пароль.
  const { data: u } = await admin.auth.admin.getUserById(userId);
  let phone = u.user?.phone ? `+${u.user.phone.replace(/\D/g, "")}` : null;
  const password = randomBytes(32).toString("base64url");
  const { error: upd } = await admin.auth.admin.updateUserById(userId, {
    password,
    ...(phone ? {} : { phone: args.phone, phone_confirm: true }),
  });
  if (upd) throw new Error(`password: ${upd.message}`);
  phone ??= args.phone;
  try {
    const { data, error } = await createAnonClient().auth.signInWithPassword({ phone, password });
    if (error || !data.session) throw new Error(`signIn: ${error?.message}`);
    return {
      kind: "session",
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    };
  } finally {
    const { error } = await admin.rpc("phone_login_clear_password", { p_user: userId });
    if (error) console.error("[phone-login] clear password:", error.message);
  }
}
