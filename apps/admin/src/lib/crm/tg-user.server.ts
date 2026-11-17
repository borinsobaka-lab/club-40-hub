/**
 * Клиент сервиса личных аккаунтов Telegram (integrations/crm-telegram): он
 * держит соединение с Telegram (MTProto) и вход в аккаунт, админка зовёт его
 * по HTTP. Адрес и общий секрет — переменные CRM_TG_URL и CRM_TG_SECRET
 * (секрет тот же, что CRM_TG_SECRET у сервиса).
 */
import { timingSafeEqual } from "node:crypto";

const TIMEOUT_MS = 60_000;

export const tgUserConfigured = () =>
  !!process.env.CRM_TG_URL && (process.env.CRM_TG_SECRET ?? "").length >= 24;

/** Запрос от сервиса к админке подписан тем же секретом. */
export function tgUserSecretValid(header: string | null): boolean {
  const secret = process.env.CRM_TG_SECRET ?? "";
  const got = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return secret.length >= 24 && got.length === want.length && timingSafeEqual(got, want);
}

export type TgUserStatus = {
  state: "offline" | "awaiting_code" | "awaiting_password" | "online" | "error";
  user: { id: string; username: string | null; name: string | null; phone: string | null } | null;
  note: string | null;
  starts_left?: number;
};

async function call<T>(
  method: string,
  path: string,
  body?: Record<string, unknown> | FormData,
): Promise<T> {
  if (!tgUserConfigured())
    throw new Error(
      "Сервис личного Telegram не подключён: задайте CRM_TG_URL и CRM_TG_SECRET у админки",
    );
  let res: Response;
  try {
    res = await fetch(`${process.env.CRM_TG_URL!.replace(/\/+$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.CRM_TG_SECRET}`,
        ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Сервис личного Telegram не отвечает");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? `Сервис личного Telegram ответил ${res.status}`);
  return json as T;
}

export const tgUserStatus = (accountId: string) =>
  call<TgUserStatus>("GET", `/accounts/${accountId}`);
export const tgUserLoginStart = (accountId: string, phone: string) =>
  call<{ via_app: boolean }>("POST", `/accounts/${accountId}/login`, { phone });
export const tgUserLoginCode = (accountId: string, code: string) =>
  call<TgUserStatus>("POST", `/accounts/${accountId}/code`, { code });
export const tgUserLoginPassword = (accountId: string, password: string) =>
  call<TgUserStatus>("POST", `/accounts/${accountId}/password`, { password });
export const tgUserLogout = (accountId: string) =>
  call<{ ok: true }>("DELETE", `/accounts/${accountId}`);

export async function tgUserSend(
  accountId: string,
  chatId: string,
  text: string,
  file: File | null,
): Promise<string> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("text", text);
  if (file) form.set("file", file, file.name);
  return (await call<{ message_id: string }>("POST", `/accounts/${accountId}/send`, form))
    .message_id;
}

/** Найти человека по номеру или @нику, чтобы написать первым. */
export const tgUserResolve = (
  accountId: string,
  target: { phone?: string; username?: string; name?: string },
) =>
  call<{ chat_id: string; username: string | null; name: string | null; phone: string | null }>(
    "POST",
    `/accounts/${accountId}/resolve`,
    target,
  );
