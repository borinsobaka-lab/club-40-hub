import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

/**
 * Вход по телефону — сервер без сети: база (PostgREST), GoTrue и Prelude —
 * подставные ответы в форматах supabase-js и docs.prelude.so. Проверяет, что
 * уходит в Prelude, кого пускаем и как выдаётся вход.
 */

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let lookup: unknown[] = [];
let preludeCheck: { status: number; body: unknown } = { status: 200, body: { status: "success" } };
let preludeSend: { status: number; body: unknown } = {
  status: 200,
  body: { id: "vrf_1", status: "success", method: "message" },
};
let accountId: string | null = null;
let throttleReason: string | null = null;
let staffAccount = false;

const user = (id: string, email: string | null, phone = "") => ({
  id,
  aud: "authenticated",
  email,
  phone,
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-11-07T00:00:00Z",
});

const realFetch = globalThis.fetch;
let mod: typeof import("./phone-login.server");

beforeAll(async () => {
  process.env.VITE_SUPABASE_URL = "https://sb.test";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "anon";
  process.env.APP_SUPABASE_SERVICE_KEY = "service";
  process.env.PRELUDE_API_TOKEN = "prelude-key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const raw = init?.body ? String(init.body) : null;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method, url, body });
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://api.prelude.dev/v2/verification/check"))
      return json(preludeCheck.body, preludeCheck.status);
    if (url.startsWith("https://api.prelude.dev/v2/verification"))
      return json(preludeSend.body, preludeSend.status);
    if (url.includes("/rest/v1/app_install_settings")) return json({ format: "packages" });
    if (url.endsWith("/rpc/phone_login_lookup")) return json(lookup);
    if (url.endsWith("/rpc/phone_login_throttle")) return json(throttleReason);
    if (url.endsWith("/rpc/phone_login_account")) return json(accountId);
    if (url.endsWith("/rpc/phone_login_link_client")) return json(true);
    if (url.endsWith("/rpc/phone_login_clear_password")) return json(null);
    if (url.endsWith("/rpc/phone_login_is_staff")) return json(staffAccount);
    if (url.endsWith("/auth/v1/admin/users") && method === "POST")
      return json(
        user(
          "00000000-0000-4000-8000-0000000000b2",
          body.email ?? null,
          body.phone?.replace("+", "") ?? "",
        ),
      );
    if (url.endsWith("/auth/v1/admin/generate_link"))
      return json({
        ...user("00000000-0000-4000-8000-0000000000a1", body.email),
        hashed_token: "hash-1",
        action_link: "x",
        email_otp: "123456",
        redirect_to: "",
        verification_type: "magiclink",
      });
    if (/\/auth\/v1\/admin\/users\/[^/]+$/.test(url)) {
      const id = url.split("/").pop()!;
      return json(
        user(
          id,
          id === "00000000-0000-4000-8000-0000000000a1" ? "a@x.ge" : null,
          id === "00000000-0000-4000-8000-0000000000b2" ? "995591099719" : "",
        ),
      );
    }
    if (url.includes("/auth/v1/token?grant_type=password"))
      return json({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        token_type: "bearer",
        user: user("00000000-0000-4000-8000-0000000000b2", null),
      });
    return json({ message: `unexpected ${method} ${url}` }, 500);
  }) as typeof fetch;
  mod = await import("./phone-login.server");
});

afterEach(() => {
  calls = [];
  lookup = [];
  accountId = null;
  throttleReason = null;
  staffAccount = false;
  preludeCheck = { status: 200, body: { status: "success" } };
  preludeSend = { status: 200, body: { id: "vrf_1", status: "success", method: "message" } };
});

const req = { ip: "10.0.0.1", userAgent: "Mozilla/5.0 (iPhone)" };
const card = (p: Record<string, unknown>) => ({
  client_id: "c1",
  studio_id: "s1",
  user_id: null,
  email: null,
  account_email: null,
  account_phone: null,
  ...p,
});

describe("отправка кода", () => {
  test("номера нет в карточках — SMS не уходит", async () => {
    const r = await mod.sendPhoneCode({
      phone: "+995591099719",
      format: "packages",
      locale: "ru",
      deviceId: null,
      appVersion: null,
      req,
    });
    expect(r).toEqual({ ok: false, error: "not_a_club_member" });
    expect(calls.some((c) => c.url.includes("prelude"))).toBe(false);
  });

  test("член клуба — запрос в Prelude с 4-значным кодом и сигналами", async () => {
    lookup = [card({ email: "a@x.ge" })];
    const r = await mod.sendPhoneCode({
      phone: "+995591099719",
      format: "packages",
      locale: "ru",
      deviceId: "dev-1",
      appVersion: "1.25",
      req,
    });
    expect(r).toEqual({ ok: true });
    const p = calls.find((c) => c.url === "https://api.prelude.dev/v2/verification")!;
    expect(p.body).toEqual({
      target: { type: "phone_number", value: "+995591099719" },
      signals: {
        ip: "10.0.0.1",
        user_agent: "Mozilla/5.0 (iPhone)",
        device_id: "dev-1",
        app_version: "1.25",
        device_platform: "web",
      },
      options: { code_size: 4, locale: "ru" },
    });
  });

  test("предел частоты — без Prelude; блок Prelude — ошибка", async () => {
    lookup = [card({ email: "a@x.ge" })];
    throttleReason = "phone_limit";
    expect(
      await mod.sendPhoneCode({
        phone: "+995591099719",
        format: "packages",
        locale: "en",
        deviceId: null,
        appVersion: null,
        req,
      }),
    ).toEqual({ ok: false, error: "too_many_requests" });
    expect(calls.some((c) => c.url.includes("prelude"))).toBe(false);
    throttleReason = null;
    preludeSend = {
      status: 200,
      body: { id: "vrf_1", status: "blocked", reason: "suspicious", method: "message" },
    };
    expect(
      await mod.sendPhoneCode({
        phone: "+995591099719",
        format: "packages",
        locale: "en",
        deviceId: null,
        appVersion: null,
        req,
      }),
    ).toEqual({ ok: false, error: "blocked" });
    preludeSend = {
      status: 400,
      body: { code: "invalid_line_type", message: "x", type: "bad_request" },
    };
    expect(
      await mod.sendPhoneCode({
        phone: "+995591099719",
        format: "packages",
        locale: "en",
        deviceId: null,
        appVersion: null,
        req,
      }),
    ).toEqual({ ok: false, error: "invalid_phone" });
  });
});

describe("проверка кода и вход", () => {
  const verify = () =>
    mod.verifyPhoneCode({
      phone: "+995591099719",
      code: "1234",
      format: "packages",
      locale: "ka",
      req,
    });

  test("неверный и устаревший код", async () => {
    lookup = [card({ email: "a@x.ge" })];
    preludeCheck = { status: 200, body: { status: "failure" } };
    expect(await verify()).toEqual({ ok: false, error: "invalid_code" });
    preludeCheck = { status: 200, body: { status: "expired_or_not_found" } };
    expect(await verify()).toEqual({ ok: false, error: "expired_code" });
    const check = calls.find((c) => c.url.endsWith("/verification/check"))!;
    expect(check.body).toEqual({
      target: { type: "phone_number", value: "+995591099719" },
      code: "1234",
    });
    expect(calls.some((c) => c.url.includes("/auth/v1/"))).toBe(false);
  });

  test("карточка с почтой, учётной записи нет — создаётся по почте, вход — token_hash", async () => {
    lookup = [card({ email: "a@x.ge" })];
    expect(await verify()).toEqual({
      ok: true,
      session: { kind: "token_hash", token_hash: "hash-1" },
    });
    const create = calls.find((c) => c.url.endsWith("/auth/v1/admin/users"))!;
    expect(create.body).toMatchObject({
      email: "a@x.ge",
      email_confirm: true,
      user_metadata: { app_format: "packages", locale: "ka" },
    });
    expect(calls.find((c) => c.url.endsWith("/generate_link"))!.body).toMatchObject({
      type: "magiclink",
      email: "a@x.ge",
    });
  });

  test("карточка с почтой, учётная запись уже есть — привязка, без создания", async () => {
    lookup = [card({ email: "a@x.ge" })];
    accountId = "00000000-0000-4000-8000-0000000000a1";
    expect(await verify()).toMatchObject({ ok: true, session: { kind: "token_hash" } });
    expect(calls.some((c) => c.url.endsWith("/auth/v1/admin/users") && c.method === "POST")).toBe(
      false,
    );
    expect(calls.find((c) => c.url.endsWith("/rpc/phone_login_link_client"))!.body).toEqual({
      p_client: "c1",
      p_user: "00000000-0000-4000-8000-0000000000a1",
    });
  });

  test("привязанная карточка — та же учётная запись", async () => {
    lookup = [card({ user_id: "00000000-0000-4000-8000-0000000000a1", account_email: "a@x.ge" })];
    expect(await verify()).toMatchObject({
      ok: true,
      session: { kind: "token_hash", token_hash: "hash-1" },
    });
  });

  test("без почты — учётная запись по телефону, разовый пароль стирается", async () => {
    lookup = [card({})];
    const r = await verify();
    expect(r).toEqual({
      ok: true,
      session: { kind: "session", access_token: "at", refresh_token: "rt" },
    });
    const create = calls.find(
      (c) => c.url.endsWith("/auth/v1/admin/users") && c.method === "POST",
    )!;
    expect(create.body).toMatchObject({
      phone: "+995591099719",
      phone_confirm: true,
      app_metadata: { phone_login_client: "c1" },
    });
    const order = calls.map((c) => c.url.split("/").pop());
    expect(order.indexOf("phone_login_clear_password")).toBeGreaterThan(
      order.findIndex((u) => u?.startsWith("token?")),
    );
  });

  test("учётная запись сотрудника — только по почте, вход не выдаётся", async () => {
    lookup = [card({ user_id: "00000000-0000-4000-8000-0000000000a1", account_email: "a@x.ge" })];
    staffAccount = true;
    expect(await verify()).toEqual({ ok: false, error: "staff_use_email" });
    expect(calls.some((c) => c.url.endsWith("/generate_link"))).toBe(false);
  });

  test("разные люди на номере — вход по почте", async () => {
    lookup = [card({ email: "a@x.ge" }), card({ client_id: "c2", email: "b@x.ge" })];
    expect(await verify()).toEqual({ ok: false, error: "ambiguous_phone" });
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});
