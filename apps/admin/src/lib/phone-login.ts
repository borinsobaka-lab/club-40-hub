/**
 * Вход в клиентское приложение по номеру телефона (решение владельца
 * 2026-11-07) — чистая логика без сети (тест рядом). Сервер —
 * `routes/api/phone-login.ts` и `lib/phone-login.server.ts`, схема —
 * `db/migrations/2026-11-07_zzz_phone_login.sql`.
 */

/** Ответ API приложению: ok или код ошибки (переводит приложение). */
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
  | "server_error";

/** Номер в E.164 («+995591099719») из того, что прислало приложение, или null. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  // Грузинский мобильный без кода страны (5XX XX XX XX).
  if (!trimmed.startsWith("+") && !trimmed.startsWith("00") && /^5\d{8}$/.test(digits)) {
    digits = `995${digits}`;
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return `+${digits}`;
}

/** Код из SMS: только цифры, 4–8. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\D/g, "");
  return code.length >= 4 && code.length <= 8 ? code : null;
}

/** Строка `phone_login_lookup`: карточка клиента с этим номером и её учётная запись. */
export type PhoneCandidate = {
  client_id: string;
  studio_id: string;
  user_id: string | null;
  /** Почта карточки (в нижнем регистре). */
  email: string | null;
  account_email: string | null;
  account_phone: string | null;
};

/** Кого пускаем: одна учётная запись (или одна будущая) на все карточки с номером. */
export type PhoneIdentity =
  | { kind: "account"; userId: string; email: string | null; clientIds: string[] }
  | { kind: "email"; email: string; clientIds: string[] }
  | { kind: "phone_only"; clientId: string };

/**
 * Человек за номером. Карточки одного человека в разных клубах (одна учётная
 * запись или одна почта) — один человек; разные люди на одном номере (мама и
 * дочь) — ambiguous: пусть войдут по почте. Карточки без почты и без учётной
 * записи — только если такая одна и других нет.
 */
export function resolveIdentity(rows: PhoneCandidate[]): PhoneIdentity | "not_found" | "ambiguous" {
  if (rows.length === 0) return "not_found";
  const users = new Set(rows.flatMap((r) => (r.user_id ? [r.user_id] : [])));
  const emailsUnlinked = new Set(rows.flatMap((r) => (!r.user_id && r.email ? [r.email] : [])));
  const bare = rows.filter((r) => !r.user_id && !r.email);

  if (users.size > 1) return "ambiguous";
  if (users.size === 1) {
    const [userId] = users;
    const linked = rows.find((r) => r.user_id === userId)!;
    const accountEmail = linked.account_email?.toLowerCase() ?? null;
    // Свободные карточки с почтой этой учётной записи — тот же человек.
    if (bare.length > 0) return "ambiguous";
    for (const e of emailsUnlinked) if (e !== accountEmail) return "ambiguous";
    return {
      kind: "account",
      userId,
      email: linked.account_email ?? linked.email,
      clientIds: rows.map((r) => r.client_id),
    };
  }
  if (emailsUnlinked.size > 1) return "ambiguous";
  if (emailsUnlinked.size === 1) {
    if (bare.length > 0) return "ambiguous";
    const [email] = emailsUnlinked;
    return { kind: "email", email, clientIds: rows.map((r) => r.client_id) };
  }
  if (bare.length > 1) return "ambiguous";
  return { kind: "phone_only", clientId: bare[0].client_id };
}

/**
 * Язык SMS у Prelude Verify (BCP-47). Грузинского в списке Verify нет
 * (docs.prelude.so/verify/v2/documentation/content) — без locale Prelude
 * выбирает язык по стране номера, иначе английский.
 */
export function preludeLocale(locale: unknown): string | undefined {
  return locale === "ru" ? "ru" : locale === "en" ? "en" : undefined;
}

/** Код ошибки Prelude (тело 4xx: {code, message, type}) → ошибка для приложения. */
export function mapPreludeError(code: string | undefined): PhoneLoginError {
  switch (code) {
    case "invalid_phone_number":
    case "invalid_line_type":
    case "unassigned_phone_number":
    case "unsupported_country":
      return "invalid_phone";
    case "too_many_attempts":
    case "premature_retry":
    case "too_many_checks":
    case "rate_limited":
      return "too_many_requests";
    case "missing_api_key":
    case "invalid_api_key":
    case "invalid_bearer_token":
      return "not_configured";
    default:
      return "server_error";
  }
}

/** Откуда разрешено звать API (CORS): клиентские приложения и доп. адреса из окружения. */
export const DEFAULT_PHONE_LOGIN_ORIGINS = [
  "https://app.base40.fit",
  "https://app.lady-stretch.one",
  "https://pack.base40.fit",
];

export function isAllowedOrigin(origin: string | null, extra = ""): boolean {
  if (!origin) return false;
  const list = [
    ...DEFAULT_PHONE_LOGIN_ORIGINS,
    ...extra
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  return list.some((o) => o.replace(/\/+$/, "") === origin);
}

/** Формат приложения из запроса: packages или subscription (по умолчанию). */
export function appFormat(raw: unknown): "packages" | "subscription" {
  return raw === "packages" ? "packages" : "subscription";
}
