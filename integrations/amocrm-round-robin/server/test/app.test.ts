import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { signToken } from "../src/jwt";
import { Store } from "../src/store";

const cfg: Config = {
  publicUrl: "https://rr.example.com",
  clientId: "11111111-2222-3333-4444-555555555555",
  clientSecret: "secret",
  redirectUri: "https://rr.example.com/oauth/callback",
  widgetCode: "",
  configured: true,
  widgetDir: new URL("../../widget", import.meta.url).pathname,
  dbPath: ":memory:",
  port: 0,
};

/** Подделка amoCRM: отвечает на те запросы, что делает сервер. */
const amo = {
  patches: [] as [number, number][],
  webhooks: [] as unknown[],
  settings: { rr_config: '{"users":[10,20],"skip_manual":false}' } as Record<string, unknown>,
  webhookStatus: 201,
};
const realFetch = globalThis.fetch;

beforeEach(() => {
  amo.patches = [];
  amo.webhooks = [];
  amo.webhookStatus = 201;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.host).toBe("base40.amocrm.ru");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const p = url.pathname;
    if (p === "/oauth2/access_token") {
      expect(body.client_secret).toBe("secret");
      return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 86400 });
    }
    if (p === "/api/v4/account") return Response.json({ id: 777, subdomain: "base40" });
    if (p === "/api/v4/webhooks") {
      amo.webhooks.push(body);
      return new Response(amo.webhookStatus === 201 ? "{}" : "forbidden", {
        status: amo.webhookStatus,
      });
    }
    if (p === "/api/v4/widgets") {
      const page = Number(url.searchParams.get("page"));
      return Response.json(
        page === 1
          ? { _embedded: { widgets: [{ code: "other", client_uuid: "x" }] }, _links: { next: {} } }
          : { _embedded: { widgets: [{ code: "rrwidget", client_uuid: cfg.clientId }] } },
      );
    }
    if (p === "/api/v4/widgets/rrwidget")
      return Response.json({ code: "rrwidget", settings: amo.settings });
    if (p.startsWith("/api/v4/users")) {
      return Response.json({
        _embedded: {
          users: [
            { id: 10, rights: { is_active: true } },
            { id: 20, rights: { is_active: true } },
          ],
        },
      });
    }
    const m = /^\/api\/v4\/leads\/(\d+)$/.exec(p);
    if (m && method === "PATCH") {
      amo.patches.push([Number(m[1]), body.responsible_user_id]);
      return Response.json({ id: Number(m[1]) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const req = (path: string, init?: RequestInit) =>
  new Request(`https://rr.example.com${path}`, init);
const tick = () => new Promise((r) => setTimeout(r, 20));
const authToken = (accountId = 777) => {
  const now = Math.floor(Date.now() / 1000);
  return signToken(
    {
      account_id: accountId,
      user_id: 10,
      client_uuid: cfg.clientId,
      iat: now,
      nbf: now,
      exp: now + 600,
    },
    cfg.clientSecret,
  );
};

async function install(app: ReturnType<typeof createApp>, store: Store) {
  const res = await app.fetch(
    req("/oauth/callback?code=abc&referer=base40.amocrm.ru&from_widget=1"),
  );
  expect(res.status).toBe(200);
  return store.getAccount(777)!;
}

test("установка, вебхук, очередь, окно виджета, отключение", async () => {
  const store = new Store(":memory:");
  const app = createApp(cfg, store, () => {});
  const account = await install(app, store);
  expect(account.subdomain).toBe("base40");
  expect(amo.webhooks).toEqual([
    {
      destination: `https://rr.example.com/webhook/${account.webhookSecret}`,
      settings: ["add_lead", "status_lead"],
    },
  ]);

  const hook = (id: number) =>
    app.fetch(
      req(`/webhook/${account.webhookSecret}`, {
        method: "POST",
        body: `leads[add][0][id]=${id}&leads[add][0][created_user_id]=0&account[id]=777`,
      }),
    );
  for (const id of [1, 2, 3]) expect((await hook(id)).status).toBe(200);
  await tick();
  expect(amo.patches).toEqual([
    [1, 10],
    [2, 20],
    [3, 10],
  ]);

  // Окно виджета
  const st = await app.fetch(
    req("/api/status", {
      headers: { "X-Auth-Token": authToken(), Origin: "https://base40.amocrm.ru" },
    }),
  );
  expect(st.headers.get("access-control-allow-origin")).toBe("https://base40.amocrm.ru");
  const body = (await st.json()) as { connected: boolean; nextUserId: number; recent: unknown[] };
  expect(body.connected).toBe(true);
  expect(body.nextUserId).toBe(20);
  expect(body.recent).toHaveLength(3);

  // Без токена и с чужого сайта — нет
  expect((await app.fetch(req("/api/status"))).status).toBe(401);
  const evil = await app.fetch(
    req("/api/status", { headers: { "X-Auth-Token": authToken(), Origin: "https://evil.com" } }),
  );
  expect(evil.headers.get("access-control-allow-origin")).toBeNull();

  // Чужой секрет в адресе вебхука
  const wrong = await app.fetch(req(`/webhook/${"0".repeat(48)}`, { method: "POST", body: "" }));
  expect(wrong.status).toBe(404);

  // Отключение интеграции
  const sig = createHmac("sha256", cfg.clientSecret).update(`${cfg.clientId}|777`).digest("hex");
  expect(
    (await app.fetch(req(`/disable?account_id=777&client_uuid=${cfg.clientId}&signature=bad`)))
      .status,
  ).toBe(403);
  expect(
    (await app.fetch(req(`/disable?account_id=777&client_uuid=${cfg.clientId}&signature=${sig}`)))
      .status,
  ).toBe(200);
  expect(store.getAccount(777)).toBeNull();
  expect((await hook(4)).status).toBe(404);
});

test("referer не amoCRM — код не обмениваем", async () => {
  const store = new Store(":memory:");
  const app = createApp(cfg, store, () => {});
  const res = await app.fetch(req("/oauth/callback?code=abc&referer=evil.com"));
  expect(res.status).toBe(400);
});

test("тариф без вебхуков API — ошибка видна в окне виджета", async () => {
  amo.webhookStatus = 403;
  const store = new Store(":memory:");
  const app = createApp(cfg, store, () => {});
  const account = await install(app, store);
  expect(account.webhookError).toContain("403");
  const st = (await (
    await app.fetch(req("/api/status", { headers: { "X-Auth-Token": authToken() } }))
  ).json()) as { webhookError: string; webhookUrl: string };
  expect(st.webhookUrl).toBe(`https://rr.example.com/webhook/${account.webhookSecret}`);
});

test("без ключей amoCRM: архив виджета отдаётся, остальное — 503", async () => {
  const store = new Store(":memory:");
  const app = createApp(
    { ...cfg, clientId: "", clientSecret: "", widgetCode: "", configured: false },
    store,
    () => {},
  );
  const zip = await app.fetch(req("/widget.zip"));
  expect(zip.status).toBe(200);
  expect(zip.headers.get("content-type")).toBe("application/zip");
  expect((await app.fetch(req("/health"))).status).toBe(200);
  expect((await app.fetch(req("/logo.png"))).headers.get("content-type")).toBe("image/png");
  expect(await (await app.fetch(req("/"))).text()).toContain("ещё не заданы");
  expect((await app.fetch(req("/oauth/callback?code=a&referer=base40.amocrm.ru"))).status).toBe(
    503,
  );
});
