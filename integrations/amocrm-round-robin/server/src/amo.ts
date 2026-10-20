import type { Account, Store } from "./store";
import type { Config } from "./config";

/** Ответ amoCRM на обмен кода или refresh token. */
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Поля сделки из GET /api/v4/leads/{id}, которые нужны серверу. */
export interface AmoLead {
  id: number;
  pipeline_id: number;
  status_id: number;
  responsible_user_id: number;
  /** 0 — сделку создала не пользователь (интеграция, форма, робот). */
  created_by: number;
  source_id?: number | null;
}

export class AmoError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`amoCRM ответил ${status}: ${body.slice(0, 300)}`);
  }
}

export function accountOrigin(a: Pick<Account, "subdomain" | "baseDomain">) {
  return `https://${a.subdomain}.${a.baseDomain}`;
}

async function tokenRequest(origin: string, cfg: Config, body: Record<string, string>) {
  const res = await fetch(`${origin}/oauth2/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      ...body,
    }),
  });
  if (!res.ok) throw new AmoError(res.status, await res.text());
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(origin: string, cfg: Config, code: string) {
  return tokenRequest(origin, cfg, { grant_type: "authorization_code", code });
}

/**
 * Клиент API v4 одного аккаунта. Access token живёт сутки — обновляем его
 * заранее; refresh token при каждом обновлении выдаётся новый (старый
 * перестаёт действовать), поэтому сохраняем пару сразу.
 */
export class AmoClient {
  private refreshing: Promise<void> | null = null;

  constructor(
    private account: Account,
    private store: Store,
    private cfg: Config,
  ) {}

  get id() {
    return this.account.id;
  }

  private async ensureToken() {
    if (this.account.expiresAt - 300 > Date.now() / 1000) return;
    // Две сделки в одну секунду не должны обновлять токен дважды: второй
    // запрос со старым refresh token amoCRM отклонит.
    this.refreshing ??= (async () => {
      const t = await tokenRequest(accountOrigin(this.account), this.cfg, {
        grant_type: "refresh_token",
        refresh_token: this.account.refreshToken,
      });
      this.account = {
        ...this.account,
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: Math.floor(Date.now() / 1000) + t.expires_in,
      };
      this.store.saveAccount(this.account);
    })().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.ensureToken();
    const res = await fetch(`${accountOrigin(this.account)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.account.accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) throw new AmoError(res.status, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Сделка из события воронки — проверка, что она есть в этом аккаунте.
   * null — нет такой (204/404). source_id — у сделок из источников
   * (формы, чаты, «Неразобранное»).
   */
  async getLead(leadId: number): Promise<AmoLead | null> {
    try {
      const r = await this.request<AmoLead | undefined>(
        "GET",
        `/api/v4/leads/${leadId}?with=source_id`,
      );
      return r?.id ? r : null;
    } catch (e) {
      if (e instanceof AmoError && e.status === 404) return null;
      throw e;
    }
  }

  setResponsible(leadId: number, userId: number) {
    return this.request("PATCH", `/api/v4/leads/${leadId}`, { responsible_user_id: userId });
  }

  /** Аккаунт, к которому выдан токен (после установки — узнать его id). */
  accountInfo() {
    return this.request<{ id: number; subdomain: string }>("GET", "/api/v4/account");
  }

  private widgetCode: string | null = null;

  /**
   * Код виджета: из AMO_WIDGET_CODE, иначе ищем в списке виджетов аккаунта
   * свой по client_uuid (= ID интеграции) — один раз на запуск сервера.
   */
  async resolveWidgetCode(): Promise<string> {
    if (this.cfg.widgetCode) return this.cfg.widgetCode;
    if (this.widgetCode) return this.widgetCode;
    for (let page = 1; page <= 40; page++) {
      const r = await this.request<{
        _embedded?: { widgets?: { code: string; client_uuid?: string }[] };
        _links?: { next?: unknown };
      }>("GET", `/api/v4/widgets?limit=250&page=${page}`);
      const own = r?._embedded?.widgets?.find((w) => w.client_uuid === this.cfg.clientId);
      if (own) {
        this.widgetCode = own.code;
        return own.code;
      }
      if (!r?._links?.next) break;
    }
    throw new Error("виджет интеграции не найден в аккаунте — загружен ли архив виджета?");
  }

  /** Сохранённые настройки виджета (поле settings отдаётся только токену своей интеграции). */
  async widgetSettings(): Promise<Record<string, unknown>> {
    const code = await this.resolveWidgetCode();
    const r = await this.request<{ settings?: Record<string, unknown> | unknown[] }>(
      "GET",
      `/api/v4/widgets/${encodeURIComponent(code)}`,
    );
    return r?.settings && !Array.isArray(r.settings) ? r.settings : {};
  }

  /**
   * Активные пользователи аккаунта: уволенному сделку не отдаём. Список
   * пользователей API отдаёт только администратору — если интеграцию
   * установил не администратор, null (проверку пропускаем).
   */
  async activeUserIds(): Promise<Set<number> | null> {
    const ids = new Set<number>();
    for (let page = 1; ; page++) {
      const r = await this.request<{
        _embedded?: { users?: { id: number; rights?: { is_active?: boolean } }[] };
        _links?: { next?: unknown };
      }>("GET", `/api/v4/users?limit=250&page=${page}`).catch((e) => {
        if (e instanceof AmoError && e.status === 403) return null;
        throw e;
      });
      if (r === null) return null;
      for (const u of r?._embedded?.users ?? []) {
        if (u.rights?.is_active !== false) ids.add(u.id);
      }
      if (!r?._links?.next) break;
    }
    return ids;
  }
}
