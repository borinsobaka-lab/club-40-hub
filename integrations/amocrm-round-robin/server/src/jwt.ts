import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Одноразовый токен amoCRM (заголовок X-Auth-Token от self.$authorizedAjax
 * виджета): JWT HS256, подписан секретным ключом интеграции. По нему сервер
 * знает, из какого аккаунта и от какого пользователя пришёл запрос.
 */
export interface DisposableToken {
  account_id: number;
  user_id: number;
  client_uuid: string;
  exp: number;
  nbf?: number;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function verifyDisposableToken(
  token: string,
  secret: string,
  clientId: string,
  now = Date.now() / 1000,
): DisposableToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString());
    if (h.alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
    const got = Buffer.from(signature, "base64url");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    const p = JSON.parse(Buffer.from(payload, "base64url").toString()) as DisposableToken;
    if (typeof p.exp !== "number" || p.exp < now) return null;
    if (typeof p.nbf === "number" && p.nbf > now + 60) return null;
    if (p.client_uuid !== clientId || !Number.isInteger(p.account_id)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Для тестов: подписать токен так же, как amoCRM. */
export function signToken(payload: object, secret: string) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

/** Подпись хука отключения интеграции: HMAC-SHA256("{client_uuid}|{account_id}"). */
export function verifyDisableSignature(
  clientUuid: string,
  accountId: string,
  signature: string,
  secret: string,
) {
  const expected = createHmac("sha256", secret).update(`${clientUuid}|${accountId}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
