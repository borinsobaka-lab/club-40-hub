import { afterEach, describe, expect, test } from "bun:test";

import { htmlToText, mailProvider, sendMail } from "./mail";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
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

describe("провайдер", () => {
  test("ключ Resend — Resend", () => expect(mailProvider({ RESEND_API_KEY: "r" })).toBe("resend"));
  test("ключа нет — null (старый UNISENDER_GO_API_KEY не в счёт)", () =>
    expect(mailProvider({ UNISENDER_GO_API_KEY: "u" })).toBeNull());
});

describe("sendMail", () => {
  test("Resend: формат запроса", async () => {
    const calls = mockFetch(200, { id: "x" });
    const r = await sendMail(
      { to: ["a@b.ru", "c@d.ru"], subject: "Тема", html: "<p>Код<br>1234</p>", replyTo: "r@b.ru" },
      { RESEND_API_KEY: "re" },
    );
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].headers.Authorization).toBe("Bearer re");
    expect(calls[0].body).toEqual({
      from: "Base40 <noreply@base40.fit>",
      to: ["a@b.ru", "c@d.ru"],
      subject: "Тема",
      html: "<p>Код<br>1234</p>",
      text: "Код\n1234",
      reply_to: "r@b.ru",
    });
  });

  test("Resend: ошибка — не ok, с текстом Resend", async () => {
    mockFetch(403, {
      statusCode: 403,
      name: "validation_error",
      message: "The base40.fit domain is not verified.",
    });
    const origErr = console.error;
    console.error = () => {};
    const r = await sendMail({ to: "a@b.ru", subject: "s", html: "h" }, { RESEND_API_KEY: "k" });
    console.error = origErr;
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error).toBe("Resend 403: The base40.fit domain is not verified. (validation_error)");
  });

  test("без ключа — не отправляет", async () => {
    const calls = mockFetch(200, {});
    const r = await sendMail({ to: "a@b.ru", subject: "s", html: "h" }, {});
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

test("htmlToText: ссылка — адресом", () =>
  expect(htmlToText('<p>Нажмите</p><a href="https://x.ru/v">Войти</a>')).toBe(
    "Нажмите\nВойти: https://x.ru/v",
  ));
