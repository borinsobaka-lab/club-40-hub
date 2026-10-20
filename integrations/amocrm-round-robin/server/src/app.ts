import { randomBytes } from "node:crypto";
import { AmoClient, exchangeCode } from "./amo";
import type { Config } from "./config";
import { verifyDisableSignature, verifyDisposableToken } from "./jwt";
import { Processor } from "./processor";
import type { Account, Store } from "./store";
import { parseWebhook } from "./webhook";

const WEBHOOK_EVENTS = ["add_lead", "status_lead"];

/**
 * Домены аккаунтов amoCRM. Код из OAuth обмениваем только на них: иначе
 * подставленный referer увёл бы секретный ключ интеграции на чужой сервер.
 */
const ACCOUNT_HOST = /^([a-z0-9][a-z0-9-]*)\.(amocrm\.ru|amocrm\.com|kommo\.com)$/;

export function createApp(cfg: Config, store: Store, log: (msg: string) => void = console.log) {
  const processor = new Processor(store, cfg.widgetCode, log);
  const clients = new Map<number, AmoClient>();
  // Вебхуки одного аккаунта обрабатываем по одному, в порядке прихода.
  const queues = new Map<number, Promise<void>>();

  const clientFor = (account: Account) => {
    let c = clients.get(account.id);
    if (!c) {
      c = new AmoClient(account, store, cfg);
      clients.set(account.id, c);
    }
    return c;
  };

  const webhookUrl = (a: Account) => `${cfg.publicUrl}/webhook/${a.webhookSecret}`;

  async function subscribe(account: Account) {
    try {
      await clientFor(account).subscribeWebhook(webhookUrl(account), WEBHOOK_EVENTS);
      store.setWebhookError(account.id, null);
      return null;
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      store.setWebhookError(account.id, msg);
      log(`[${account.id}] подписка на вебхук не удалась: ${msg}`);
      return msg;
    }
  }

  async function oauthCallback(url: URL) {
    if (url.searchParams.get("error")) {
      return html("Доступ не выдан", "Установка отменена в amoCRM.", 400);
    }
    const code = url.searchParams.get("code");
    const referer = (url.searchParams.get("referer") ?? "")
      .toLowerCase()
      .replace(/^https?:\/\//, "");
    const m = ACCOUNT_HOST.exec(referer);
    if (!code || !m) return html("Ошибка", "Нет кода авторизации или адреса аккаунта.", 400);
    const origin = `https://${referer}`;
    const t = await exchangeCode(origin, cfg, code);
    const draft: Account = {
      id: 0,
      subdomain: m[1],
      baseDomain: m[2],
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + t.expires_in,
      webhookSecret: "",
      webhookError: null,
    };
    const info = await new AmoClient(draft, store, cfg).accountInfo();
    const prev = store.getAccount(info.id);
    const account: Account = {
      ...draft,
      id: info.id,
      webhookSecret: prev?.webhookSecret ?? randomBytes(24).toString("hex"),
    };
    store.saveAccount(account);
    clients.delete(account.id);
    processor.forgetSettings(account.id);
    const err = await subscribe(account);
    log(`[${account.id}] интеграция установлена (${referer})`);
    return err
      ? html(
          "Интеграция подключена, но вебхук не создан",
          `amoCRM не дал подписаться на новые сделки: ${err}. Подробности и что делать — в окне настроек виджета.`,
        )
      : html("Готово", "Очередь ответственных подключена. Окно можно закрыть.");
  }

  function webhook(secret: string, body: string) {
    const account = store.getAccountBySecret(secret);
    if (!account) return new Response("unknown", { status: 404 });
    const payload = parseWebhook(body);
    if (payload.accountId != null && payload.accountId !== account.id) {
      return new Response("account mismatch", { status: 403 });
    }
    if (payload.added.length || payload.statusChanged.length) {
      // amoCRM ждёт ответа не дольше 2 секунд — отвечаем сразу, работаем после.
      const prev = queues.get(account.id) ?? Promise.resolve();
      const next = prev
        .then(() => processor.handle(clientFor(account), payload))
        .catch((e) => log(`[${account.id}] ошибка обработки: ${(e as Error).stack ?? e}`));
      queues.set(account.id, next);
    }
    return new Response("ok");
  }

  function disable(url: URL) {
    const accountId = url.searchParams.get("account_id") ?? "";
    const clientUuid =
      url.searchParams.get("client_uuid") ?? url.searchParams.get("client_id") ?? "";
    const sig = url.searchParams.get("signature") ?? "";
    if (
      clientUuid !== cfg.clientId ||
      !verifyDisableSignature(clientUuid, accountId, sig, cfg.clientSecret)
    ) {
      return new Response("bad signature", { status: 403 });
    }
    store.deleteAccount(Number(accountId));
    clients.delete(Number(accountId));
    log(`[${accountId}] интеграция отключена — токены удалены`);
    return new Response("ok");
  }

  /** Окно настроек виджета: подключено ли, кто следующий, последние сделки. */
  async function status(accountId: number) {
    const account = store.getAccount(accountId);
    if (!account) return { connected: false };
    const api = clientFor(account);
    let settingsError: string | null = null;
    let queue: number[] = [];
    let selected: number[] = [];
    try {
      const settings = await processor.queueSettings(api);
      selected = settings.users;
      queue = await processor.queueUsers(api, settings);
    } catch (e) {
      settingsError = String((e as Error).message ?? e);
    }
    return {
      connected: true,
      webhookError: account.webhookError,
      webhookUrl: account.webhookError ? webhookUrl(account) : null,
      settingsError,
      queue,
      inactive: selected.filter((u) => !queue.includes(u)),
      nextUserId: store.peekNext(account.id, queue),
      recent: store.recentAssignments(account.id, 15),
    };
  }

  async function widgetApi(req: Request, path: string) {
    const token = verifyDisposableToken(
      req.headers.get("x-auth-token") ?? "",
      cfg.clientSecret,
      cfg.clientId,
    );
    if (!token) return json({ error: "unauthorized" }, 401);
    if (path === "/api/status" && req.method === "GET") return json(await status(token.account_id));
    if (path === "/api/saved" && req.method === "POST") {
      // onSave виджета срабатывает по кнопке — amoCRM может записать
      // настройки чуть позже ответа, поэтому сбрасываем кэш и сейчас, и
      // через несколько секунд. Настройки здесь не читаем: прочитали бы старые.
      const id = token.account_id;
      processor.forgetSettings(id);
      setTimeout(() => processor.forgetSettings(id), 5000);
      return json({ ok: true });
    }
    if (path === "/api/resubscribe" && req.method === "POST") {
      const account = store.getAccount(token.account_id);
      if (account) await subscribe(account);
      return json(await status(token.account_id));
    }
    return json({ error: "not found" }, 404);
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/health") return new Response("ok");
      if (path === "/oauth/callback" && req.method === "GET") return await oauthCallback(url);
      if (path === "/disable" && req.method === "GET") return disable(url);
      const hook = /^\/webhook\/([a-f0-9]{48})$/.exec(path);
      if (hook && req.method === "POST") return webhook(hook[1], await req.text());
      if (path.startsWith("/api/")) {
        const origin = req.headers.get("origin");
        const cors = corsHeaders(origin);
        const res =
          req.method === "OPTIONS"
            ? new Response(null, { status: 204 })
            : await widgetApi(req, path);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
        return res;
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      log(`${req.method} ${path}: ${(e as Error).stack ?? e}`);
      return path === "/oauth/callback"
        ? html("Ошибка", `Не удалось подключить интеграцию: ${(e as Error).message}`, 500)
        : json({ error: "internal" }, 500);
    }
  }

  return { fetch, processor };
}

/** Виджет работает на странице аккаунта amoCRM — пускаем только оттуда. */
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  const host = origin.replace(/^https:\/\//, "");
  if (!origin.startsWith("https://") || !ACCOUNT_HOST.test(host)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "X-Auth-Token, Content-Type, X-Requested-With",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function html(title: string, text: string, status = 200) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<body style="font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 16px">` +
      `<h2>${esc(title)}</h2><p>${esc(text)}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
