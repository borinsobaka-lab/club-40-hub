/** Настройки сервиса из переменных окружения (Coolify). */
export type Config = {
  port: number;
  /** api_id и api_hash приложения с my.telegram.org. */
  apiId: number;
  apiHash: string;
  /** Общий секрет с админкой: им подписаны запросы в обе стороны. */
  secret: string;
  /** Куда отдавать сообщения: https://admin.base40.fit/api/crm/tg-user. */
  adminUrl: string;
  /** Папка тома: сессии аккаунтов и адреса собеседников. */
  dataDir: string;
  /** Сколько новых чатов в сутки можно начать с одного аккаунта. */
  newChatsPerDay: number;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    apiId: Number(env.TELEGRAM_API_ID ?? 0),
    apiHash: env.TELEGRAM_API_HASH ?? "",
    secret: env.CRM_TG_SECRET ?? "",
    adminUrl: (env.ADMIN_URL ?? "https://admin.base40.fit").replace(/\/+$/, "") + "/api/crm/tg-user",
    dataDir: env.DATA_DIR ?? "/data",
    newChatsPerDay: Number(env.NEW_CHATS_PER_DAY ?? 20),
  };
}

/** Чего не хватает для работы (пусто — всё задано). */
export function configProblems(c: Config): string[] {
  const out: string[] = [];
  if (!c.apiId || !c.apiHash) out.push("TELEGRAM_API_ID / TELEGRAM_API_HASH");
  if (c.secret.length < 24) out.push("CRM_TG_SECRET (не короче 24 знаков)");
  return out;
}
