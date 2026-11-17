/**
 * Клиент Telegram для одного личного аккаунта. Интерфейс — чтобы логику
 * сервиса (вход, пределы, пересылка в админку) проверять тестами с
 * подставным клиентом; настоящий — gram-driver.ts (GramJS, MTProto).
 */
export type TgUser = { id: string; username: string | null; name: string | null; phone: string | null };

export type TgPeer = TgUser & { accessHash: string };

export type TgMessage = {
  id: string;
  /** true — отправлено с этого аккаунта (в том числе с телефона владельца). */
  out: boolean;
  peer: TgPeer;
  text: string | null;
  /** Unix-время, секунды. */
  date: number;
  file: { name: string; mime: string | null; size: number | null; download: () => Promise<Uint8Array | null> } | null;
};

export type LoginCodeResult = "ok" | "password_needed";

export interface TgDriver {
  /** Подключиться с сохранённой сессией; true — аккаунт вошёл. */
  connect(session: string): Promise<boolean>;
  /** Отправить код входа на номер (в приложение Telegram или SMS). */
  sendCode(phone: string): Promise<{ viaApp: boolean }>;
  /** Ввести код. password_needed — у аккаунта облачный пароль. */
  signIn(code: string): Promise<LoginCodeResult>;
  signInPassword(password: string): Promise<void>;
  me(): Promise<TgUser>;
  /** Ключ входа для сохранения на томе. */
  session(): string;
  onMessage(handler: (message: TgMessage) => void): void;
  sendText(peer: { id: string; accessHash: string }, text: string): Promise<string>;
  sendFile(
    peer: { id: string; accessHash: string },
    file: { name: string; bytes: Uint8Array },
    caption: string | null,
  ): Promise<string>;
  /** Найти человека, чтобы написать первым: по номеру или @нику. */
  resolve(target: { phone?: string; username?: string; name?: string }): Promise<TgPeer | null>;
  logout(): Promise<void>;
  disconnect(): Promise<void>;
}

/** Ошибка Telegram с кодом (PHONE_CODE_INVALID, FLOOD_WAIT_30…) — текстом для человека. */
export function tgErrorText(e: unknown): string {
  const raw =
    (e as { errorMessage?: string } | null)?.errorMessage ?? (e instanceof Error ? e.message : String(e));
  const code = raw.toUpperCase();
  const wait = /FLOOD_WAIT_?(\d+)|A WAIT OF (\d+) SECONDS/.exec(code);
  if (wait) {
    const s = Number(wait[1] ?? wait[2]);
    return `Telegram просит подождать ${s >= 120 ? `${Math.ceil(s / 60)} мин` : `${s} с`} — слишком частые действия`;
  }
  if (code.includes("PHONE_NUMBER_INVALID")) return "Telegram не знает такой номер — проверьте его";
  if (code.includes("PHONE_NUMBER_BANNED")) return "Этот номер заблокирован в Telegram";
  if (code.includes("PHONE_CODE_INVALID")) return "Неверный код";
  if (code.includes("PHONE_CODE_EXPIRED")) return "Код устарел — запросите новый";
  if (code.includes("PASSWORD_HASH_INVALID")) return "Неверный облачный пароль";
  if (code.includes("SESSION_PASSWORD_NEEDED")) return "Нужен облачный пароль";
  if (code.includes("AUTH_KEY_UNREGISTERED") || code.includes("SESSION_REVOKED") || code.includes("AUTH_KEY_DUPLICATED"))
    return "Вход в аккаунт сброшен (сеанс завершён в Telegram) — войдите заново";
  if (code.includes("USER_DEACTIVATED")) return "Аккаунт Telegram удалён или заблокирован";
  if (code.includes("PEER_FLOOD"))
    return "Telegram ограничил аккаунт за сообщения незнакомым людям — писать первым пока нельзя";
  if (code.includes("USER_PRIVACY_RESTRICTED") || code.includes("YOU_BLOCKED_USER") || code.includes("USER_IS_BLOCKED"))
    return "Человек запретил писать ему или заблокировал аккаунт";
  if (code.includes("USERNAME_NOT_OCCUPIED") || code.includes("USERNAME_INVALID")) return "Такого @ника в Telegram нет";
  if (code.includes("API_ID_INVALID")) return "Неверные TELEGRAM_API_ID / TELEGRAM_API_HASH у сервиса";
  return `Telegram: ${raw}`;
}

/** Сеанс умер: работать дальше нельзя, нужен новый вход. */
export function isSessionDead(e: unknown): boolean {
  const code = String((e as { errorMessage?: string } | null)?.errorMessage ?? (e as Error | null)?.message ?? "").toUpperCase();
  return ["AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "AUTH_KEY_DUPLICATED", "USER_DEACTIVATED", "SESSION_EXPIRED"].some((c) =>
    code.includes(c),
  );
}
