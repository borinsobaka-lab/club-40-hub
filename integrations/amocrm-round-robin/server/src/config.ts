import { join } from "node:path";

/** Настройки сервера — переменные окружения (в Coolify — Environment Variables). */
export interface Config {
  /** Адрес сервера снаружи, без слэша в конце: https://rr.base40.fit */
  publicUrl: string;
  /** «ID интеграции» из amoCRM → Настройки → Интеграции → ваша интеграция → Ключи и доступы. */
  clientId: string;
  /** «Секретный ключ» оттуда же. */
  clientSecret: string;
  /** Ссылка для перенаправления — как указана в интеграции. */
  redirectUri: string;
  /** Код виджета; пусто — сервер найдёт свой виджет в аккаунте по ID интеграции. */
  widgetCode: string;
  /**
   * Ключи amoCRM заданы. Без них сервер всё равно стартует и отдаёт архив
   * виджета (/widget.zip): ключи появляются только после загрузки архива в
   * интеграцию amoCRM.
   */
  configured: boolean;
  /** Папка с файлами виджета (manifest.json, script.js, …). */
  widgetDir: string;
  dbPath: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const get = (name: string) => env[name]?.trim() ?? "";
  const publicUrl = get("PUBLIC_URL").replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/.test(publicUrl)) {
    throw new Error("PUBLIC_URL — адрес сервера вида https://rr.example.com");
  }
  const clientId = get("AMO_CLIENT_ID");
  const clientSecret = get("AMO_CLIENT_SECRET");
  const widgetCode = get("AMO_WIDGET_CODE");
  return {
    publicUrl,
    clientId,
    clientSecret,
    redirectUri: get("AMO_REDIRECT_URI") || `${publicUrl}/oauth/callback`,
    widgetCode,
    configured: Boolean(clientId && clientSecret),
    widgetDir: get("WIDGET_DIR") || join(import.meta.dir, "../../widget"),
    dbPath: get("DB_PATH") || "./data/round-robin.sqlite",
    port: Number(env.PORT) || 3000,
  };
}
