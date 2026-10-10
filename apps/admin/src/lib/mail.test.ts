import { afterEach, describe, expect, test } from "bun:test";

import { htmlToText, mailProvider, sendMail } from "./mail";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = {
  url: string;
  headers: Record<string, string>;
  body: { message?: Record<string, unknown>; from?: string };
};
function mockFetch(status: number, reply: unknown) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, opts: RequestInit) => {
    calls.push({
      url,
      headers: opts.headers as Record<string, string>,
      body: JSON.parse(opts.body as string),
    });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return calls;
}

describe("выбор провайдера", () => {
  test("есть ключ Unisender Go — он", () =>
    expect(mailProvider({ UNISENDER_GO_API_KEY: "u", RESEND_API_KEY: "r" })).toBe("unisender"));
  test("только Resend — по-старому", () =>
    expect(mailProvider({ RESEND_API_KEY: "r" })).toBe("resend"));
  test("ничего — null", () => expect(mailProvider({})).toBeNull());
});

describe("sendMail", () => {
  test("Unisender Go: формат запроса", async () => {
    const calls = mockFetch(200, { status: "success", job_id: "j" });
    const r = await sendMail(
      { to: ["a@b.ru", "c@d.ru"], subject: "Тема", html: "<p>Код<br>1234</p>" },
      { UNISENDER_GO_API_KEY: "key", RESEND_API_KEY: "r" },
    );
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://go2.unisender.ru/ru/transactional/api/v1/email/send.json");
    expect(calls[0].headers["X-API-KEY"]).toBe("key");
    expect(calls[0].body.message).toEqual({
      recipients: [{ email: "a@b.ru" }, { email: "c@d.ru" }],
      from_email: "noreply@base40.fit",
      from_name: "Base40",
      subject: "Тема",
      body: { html: "<p>Код<br>1234</p>", plaintext: "Код\n1234" },
      track_links: 0,
      track_read: 0,
    });
  });

  test("Unisender Go: status error — не ok, с message и code", async () => {
    mockFetch(200, { status: "error", message: "invalid key", code: 102 });
    const origErr = console.error;
    console.error = () => {};
    const r = await sendMail(
      { to: "a@b.ru", subject: "s", html: "h" },
      { UNISENDER_GO_API_KEY: "k" },
    );
    console.error = origErr;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("invalid key (code 102)");
  });

  test("без ключа Unisender Go — Resend, как раньше", async () => {
    const calls = mockFetch(200, { id: "x" });
    const r = await sendMail({ to: "a@b.ru", subject: "s", html: "h" }, { RESEND_API_KEY: "re" });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].body.from).toBe("Base40 <noreply@base40.fit>");
  });
});

test("htmlToText: ссылка — адресом", () =>
  expect(htmlToText('<p>Нажмите</p><a href="https://x.ru/v">Войти</a>')).toBe(
    "Нажмите\nВойти: https://x.ru/v",
  ));
