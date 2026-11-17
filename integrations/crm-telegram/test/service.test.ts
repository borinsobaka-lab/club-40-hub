import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Accounts, type Outbound } from "../src/accounts";
import { configProblems, loadConfig, type Config } from "../src/config";
import { tgErrorText, type TgDriver, type TgMessage, type TgPeer } from "../src/driver";
import { makeForwarder } from "../src/forward";
import { makeHandler } from "../src/server";
import { Store } from "../src/store";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const ANNA: TgPeer = { id: "777", accessHash: "999", username: "anna", name: "Анна", phone: "+995555123456" };

/** Подставной клиент Telegram: помнит, что отправили, и умеет «присылать» сообщения. */
class FakeDriver implements TgDriver {
  authorized = false;
  password: string | null = null;
  handler: ((m: TgMessage) => void) | null = null;
  sent: { peer: string; hash: string; text: string; file?: string }[] = [];
  fail: unknown = null;
  disconnected = false;
  async connect(session: string) {
    this.authorized = session === "saved-session";
    return this.authorized;
  }
  async sendCode(phone: string) {
    if (phone === "+10000000000") throw { errorMessage: "PHONE_NUMBER_INVALID" };
    return { viaApp: true };
  }
  async signIn(code: string) {
    if (code !== "12345") throw { errorMessage: "PHONE_CODE_INVALID" };
    if (this.password) return "password_needed" as const;
    this.authorized = true;
    return "ok" as const;
  }
  async signInPassword(password: string) {
    if (password !== this.password) throw { errorMessage: "PASSWORD_HASH_INVALID" };
    this.authorized = true;
  }
  async me() {
    return { id: "42", username: "owner", name: "Владелец", phone: "+995500000000" };
  }
  session() {
    return "saved-session";
  }
  onMessage(handler: (m: TgMessage) => void) {
    this.handler = handler;
  }
  async sendText(peer: { id: string; accessHash: string }, text: string) {
    if (this.fail) throw this.fail;
    this.sent.push({ peer: peer.id, hash: peer.accessHash, text });
    return "501";
  }
  async sendFile(peer: { id: string; accessHash: string }, file: { name: string }, caption: string | null) {
    this.sent.push({ peer: peer.id, hash: peer.accessHash, text: caption ?? "", file: file.name });
    return "502";
  }
  async resolve(target: { phone?: string; username?: string }) {
    if (target.username === "anna" || target.phone === "+995555123456") return ANNA;
    if (target.username?.startsWith("u")) return { ...ANNA, id: target.username, username: target.username };
    return null;
  }
  async logout() {
    this.authorized = false;
  }
  async disconnect() {
    this.disconnected = true;
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(opts: { perDay?: number; dir?: string } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "crm-tg-"));
  if (!opts.dir) dirs.push(dir);
  const cfg: Config = { ...loadConfig({ CRM_TG_SECRET: SECRET, TELEGRAM_API_ID: "1", TELEGRAM_API_HASH: "h", DATA_DIR: dir }), newChatsPerDay: opts.perDay ?? 20 };
  const drivers: FakeDriver[] = [];
  const out: Outbound[] = [];
  let now = 1_700_000_000_000;
  const accounts = new Accounts(
    cfg,
    new Store(dir),
    () => {
      const d = new FakeDriver();
      drivers.push(d);
      return d;
    },
    async (p) => void out.push(p),
    () => now,
  );
  const handler = makeHandler(cfg, accounts);
  const call = async (method: string, path: string, body?: unknown, secret = SECRET) => {
    const res = await handler(
      new Request(`http://x${path}`, {
        method,
        headers: { Authorization: `Bearer ${secret}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const login = async () => {
    await call("POST", `/accounts/${ID}/login`, { phone: "+995 500 00 00 00" });
    await call("POST", `/accounts/${ID}/code`, { code: "12345" });
  };
  return { cfg, dir, accounts, drivers, out, call, login, tick: (ms: number) => (now += ms) };
}

describe("сервис личного Telegram", () => {
  test("настройки: чего не хватает", () => {
    expect(configProblems(loadConfig({}))).toEqual(["TELEGRAM_API_ID / TELEGRAM_API_HASH", "CRM_TG_SECRET (не короче 24 знаков)"]);
    expect(configProblems(loadConfig({ TELEGRAM_API_ID: "1", TELEGRAM_API_HASH: "h", CRM_TG_SECRET: SECRET }))).toEqual([]);
    expect(loadConfig({ ADMIN_URL: "https://a.example/" }).adminUrl).toBe("https://a.example/api/crm/tg-user");
  });

  test("без секрета — 403, чужой путь — 404, /health открыт", async () => {
    const { call } = setup();
    expect((await call("GET", `/accounts/${ID}`, undefined, "wrong".repeat(8))).status).toBe(403);
    expect((await call("GET", "/accounts/not-a-uuid")).status).toBe(404);
    expect((await call("GET", "/health", undefined, "")).body).toEqual({ ok: true, missing: [] });
  });

  test("вход: номер → код; неверный код; сессия сохраняется на том", async () => {
    const { call, dir } = setup();
    expect((await call("GET", `/accounts/${ID}`)).body.state).toBe("offline");
    expect((await call("POST", `/accounts/${ID}/login`, { phone: "+1 000 000 0000" })).body.error).toContain("не знает такой номер");
    expect((await call("POST", `/accounts/${ID}/code`, { code: "12345" })).body.error).toBe("Сначала запросите код");
    expect((await call("POST", `/accounts/${ID}/login`, { phone: "+995 500 00 00 00" })).body).toEqual({ via_app: true });
    expect((await call("POST", `/accounts/${ID}/code`, { code: "000" })).body.error).toBe("Неверный код");
    const done = await call("POST", `/accounts/${ID}/code`, { code: "1 2 3 4 5" });
    expect(done.body.state).toBe("online");
    expect(done.body.user).toMatchObject({ id: "42", username: "owner", phone: "+995500000000" });
    const saved = JSON.parse(readFileSync(join(dir, "accounts.json"), "utf8"));
    expect(saved[ID].session).toBe("saved-session");
    // Сессию сервис наружу не отдаёт.
    expect(JSON.stringify((await call("GET", `/accounts/${ID}`)).body)).not.toContain("saved-session");
  });

  test("вход с облачным паролем", async () => {
    const { call, accounts, drivers } = setup();
    await call("POST", `/accounts/${ID}/login`, { phone: "+995500000000" });
    drivers[0].password = "секрет";
    expect((await call("POST", `/accounts/${ID}/code`, { code: "12345" })).body.state).toBe("awaiting_password");
    expect((await call("POST", `/accounts/${ID}/password`, { password: "нет" })).body.error).toBe("Неверный облачный пароль");
    expect((await call("POST", `/accounts/${ID}/password`, { password: "секрет" })).body.state).toBe("online");
    expect(accounts.status(ID).state).toBe("online");
  });

  test("входящее и отправленное с телефона уходят в админку; адрес собеседника запоминается", async () => {
    const { login, drivers, out, call } = setup();
    await login();
    const d = drivers[0];
    d.handler!({ id: "10", out: false, peer: ANNA, text: "Привет", date: 1_700_000_000, file: null });
    d.handler!({
      id: "11",
      out: true,
      peer: ANNA,
      text: null,
      date: 1_700_000_100,
      file: { name: "чек.pdf", mime: "application/pdf", size: 3, download: async () => new Uint8Array([1, 2, 3]) },
    });
    d.handler!({ id: "12", out: false, peer: ANNA, text: null, date: 1, file: { name: "big.mp4", mime: null, size: 9e9, download: async () => null } });
    await new Promise((r) => setTimeout(r, 10));
    expect(out.length).toBe(3);
    expect(out[0]).toMatchObject({
      type: "message",
      account_id: ID,
      direction: "in",
      chat_id: "777",
      peer: { external_id: "777", username: "anna", name: "Анна", phone: "+995555123456" },
      message: { external_id: "10", body: "Привет", sent_at: new Date(1_700_000_000_000).toISOString() },
      file: null,
    });
    const byId = (id: string) => out.find((o) => o.type === "message" && o.message.external_id === id);
    expect(byId("11")).toMatchObject({ direction: "out", file: { name: "чек.pdf", mime: "application/pdf" } });
    expect(byId("12")).toMatchObject({ file: null, file_skipped: "big.mp4" });

    // Ответ из CRM — тому же человеку, с запомненным адресом.
    const form = new FormData();
    form.set("chat_id", "777");
    form.set("text", "Здравствуйте!");
    expect((await call("POST", `/accounts/${ID}/send`, form)).body).toEqual({ message_id: "501" });
    expect(d.sent[0]).toEqual({ peer: "777", hash: "999", text: "Здравствуйте!" });
    const withFile = new FormData();
    withFile.set("chat_id", "777");
    withFile.set("text", "прайс");
    withFile.set("file", new File([new Uint8Array([1])], "price.pdf"));
    expect((await call("POST", `/accounts/${ID}/send`, withFile)).body).toEqual({ message_id: "502" });
    expect(d.sent[1]).toMatchObject({ file: "price.pdf", text: "прайс" });
    // Эхо своего сообщения (Telegram присылает отправленное из CRM событием)
    // в админку не уходит; написанное с телефона — уходит.
    const before = out.length;
    d.handler!({ id: "501", out: true, peer: ANNA, text: "Здравствуйте!", date: 2, file: null });
    d.handler!({ id: "600", out: true, peer: ANNA, text: "с телефона", date: 3, file: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(out.slice(before).map((o) => (o.type === "message" ? o.message.external_id : ""))).toEqual(["600"]);
    // Незнакомому по одному id написать нельзя.
    const unknown = new FormData();
    unknown.set("chat_id", "555");
    unknown.set("text", "x");
    expect((await call("POST", `/accounts/${ID}/send`, unknown)).body.error).toContain("не знает этого собеседника");
  });

  test("написать первым: по номеру и нику, суточный предел новых чатов", async () => {
    const { login, call, tick } = setup({ perDay: 2 });
    expect((await call("POST", `/accounts/${ID}/resolve`, { username: "anna" })).status).toBe(409);
    await login();
    expect((await call("POST", `/accounts/${ID}/resolve`, {})).body.error).toBe("Укажите номер или @ник");
    expect((await call("POST", `/accounts/${ID}/resolve`, { phone: "+995 000" })).status).toBe(404);
    const found = await call("POST", `/accounts/${ID}/resolve`, { phone: "+995 555 12-34-56", name: "Анна" });
    expect(found.body).toEqual({ chat_id: "777", username: "anna", name: "Анна", phone: "+995555123456" });
    // Знакомый собеседник предел не тратит.
    await call("POST", `/accounts/${ID}/resolve`, { username: "anna" });
    expect((await call("GET", `/accounts/${ID}`)).body.starts_left).toBe(1);
    expect((await call("POST", `/accounts/${ID}/resolve`, { username: "u1" })).status).toBe(200);
    const blocked = await call("POST", `/accounts/${ID}/resolve`, { username: "u2" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain("заблокирует аккаунт");
    tick(25 * 3600_000);
    expect((await call("POST", `/accounts/${ID}/resolve`, { username: "u2" })).status).toBe(200);
  });

  test("перезапуск: аккаунт подключается сам; сброшенный вход — ошибка и сигнал админке", async () => {
    const first = setup();
    await first.login();
    const second = setup({ dir: first.dir });
    await second.accounts.boot();
    expect(second.accounts.status(ID).state).toBe("online");
    expect(second.drivers[0].handler).not.toBeNull();

    // Telegram сбросил сеанс: отправка падает, аккаунт — в ошибке, админка узнаёт.
    second.drivers[0].handler!({ id: "1", out: false, peer: ANNA, text: "x", date: 1, file: null });
    second.drivers[0].fail = { errorMessage: "AUTH_KEY_UNREGISTERED" };
    const form = new FormData();
    form.set("chat_id", "777");
    form.set("text", "x");
    const res = await second.call("POST", `/accounts/${ID}/send`, form);
    expect(res.body.error).toContain("войдите заново");
    expect(second.accounts.status(ID).state).toBe("error");
    expect(second.out.at(-1)).toMatchObject({ type: "status", state: "error" });
    // Выход стирает сессию.
    await second.call("DELETE", `/accounts/${ID}`);
    expect(JSON.parse(readFileSync(join(first.dir, "accounts.json"), "utf8"))).toEqual({});
  });

  test("пересылка в админку: секрет, вложение, повтор на 5xx, без повтора на 4xx", async () => {
    const calls: { auth: string | null; meta: Record<string, unknown>; file: string | null }[] = [];
    let status = 500;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      calls.push({
        auth: new Headers(init.headers).get("authorization"),
        meta: JSON.parse(String(form.get("meta"))),
        file: form.get("file") instanceof File ? (form.get("file") as File).name : null,
      });
      const res = new Response("", { status });
      status = 200;
      return res;
    }) as unknown as typeof fetch;
    const realTimeout = globalThis.setTimeout;
    // Паузы между повторами в тесте не ждём.
    globalThis.setTimeout = ((fn: () => void) => realTimeout(fn, 0)) as unknown as typeof setTimeout;
    try {
      const forward = makeForwarder(loadConfig({ CRM_TG_SECRET: SECRET }), fakeFetch);
      await forward({
        type: "message",
        account_id: ID,
        direction: "in",
        chat_id: "777",
        peer: { external_id: "777", username: null, name: null, phone: null },
        message: { external_id: "1", body: "x", sent_at: "2026-01-01T00:00:00.000Z" },
        file: { name: "a.jpg", mime: "image/jpeg", bytes: new Uint8Array([1]) },
        file_skipped: null,
      });
      expect(calls.length).toBe(2);
      expect(calls[0].auth).toBe(`Bearer ${SECRET}`);
      expect(calls[0].file).toBe("a.jpg");
      expect(calls[0].meta).toMatchObject({ type: "message", chat_id: "777" });
      expect("file" in calls[0].meta).toBe(false);
      status = 403;
      await expect(forward({ type: "status", account_id: ID, state: "error", note: "x" })).rejects.toThrow("403");
      expect(calls.length).toBe(3);
    } finally {
      globalThis.setTimeout = realTimeout;
    }
  });

  test("ошибки Telegram — по-русски", () => {
    expect(tgErrorText({ errorMessage: "FLOOD_WAIT_30" })).toContain("30 с");
    expect(tgErrorText(new Error("A wait of 600 seconds is required"))).toContain("10 мин");
    expect(tgErrorText({ errorMessage: "PEER_FLOOD" })).toContain("ограничил аккаунт");
    expect(tgErrorText({ errorMessage: "USER_PRIVACY_RESTRICTED" })).toContain("запретил");
    expect(tgErrorText({ errorMessage: "SOMETHING_NEW" })).toBe("Telegram: SOMETHING_NEW");
  });
});
