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
  /** Код виджета (там же, после загрузки архива). */
  widgetCode: string;
  dbPath: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const need = (name: string) => {
    const v = env[name]?.trim();
    if (!v) throw new Error(`Не задана переменная окружения ${name}`);
    return v;
  };
  const publicUrl = need("PUBLIC_URL").replace(/\/+$/, "");
  return {
    publicUrl,
    clientId: need("AMO_CLIENT_ID"),
    clientSecret: need("AMO_CLIENT_SECRET"),
    redirectUri: env.AMO_REDIRECT_URI?.trim() || `${publicUrl}/oauth/callback`,
    widgetCode: need("AMO_WIDGET_CODE"),
    dbPath: env.DB_PATH?.trim() || "./data/round-robin.sqlite",
    port: Number(env.PORT) || 3000,
  };
}
