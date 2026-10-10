import { describe, expect, test } from "bun:test";

import { buildEmail, buildEmails, isAdminApp, type HookPayload } from "./auth-email";

const payload = (redirect_to: string, email_action_type = "magiclink"): HookPayload => ({
  user: { id: "u1", email: "owner@example.com" },
  email_data: {
    token: "1234",
    token_hash: "hash",
    redirect_to,
    email_action_type,
    site_url: "https://admin.base40.fit",
  },
});

const ADMIN = "https://admin.base40.fit/";
const CLIENT = "https://app.base40.fit/";

const hasCode = (html: string) => html.includes("1234");
// Ссылка авто-входа — любая ссылка или token_hash (из него собирается
// /auth/v1/verify). В письмах авторизации их быть не должно.
const hasLoginLink = (html: string) =>
  html.includes("/auth/v1/verify") || html.includes("href") || html.includes("hash");

describe("isAdminApp — признак приложения по redirect_to", () => {
  test("админка", () => expect(isAdminApp(ADMIN)).toBe(true));
  test("клиентское приложение", () => expect(isAdminApp(CLIENT)).toBe(false));
  test("подделка хоста не проходит", () =>
    expect(isAdminApp("https://admin.base40.fit.evil.com/")).toBe(false));
  test("пустой redirect — считаем клиентом", () => expect(isAdminApp("")).toBe(false));
  test("мусор вместо URL — считаем клиентом", () => expect(isAdminApp("не-url")).toBe(false));
});

describe("вход: всегда код, приложение меняет только текст", () => {
  test("клиентское приложение — код, без ссылки", () => {
    const { html, subject } = buildEmail(payload(CLIENT), isAdminApp(CLIENT));
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
    expect(subject).not.toContain("админ");
  });

  test("админка — код, без ссылки", () => {
    const { html, subject } = buildEmail(payload(ADMIN), isAdminApp(ADMIN));
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
    expect(subject).toContain("админ");
  });

  test("один и тот же человек в двух приложениях получает разные письма", () => {
    const asClient = buildEmail(payload(CLIENT), isAdminApp(CLIENT));
    const asStaff = buildEmail(payload(ADMIN), isAdminApp(ADMIN));
    expect(asClient.subject).not.toBe(asStaff.subject);
  });

  test("нераспознанный redirect — клиентское письмо с кодом", () => {
    const { html, subject } = buildEmail(payload(""), isAdminApp(""));
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
    expect(subject).not.toContain("админ");
  });
});

describe("остальные типы писем", () => {
  test("регистрация клиента — код", () => {
    const { html } = buildEmail(payload(CLIENT, "signup"), false);
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
  });

  // /recover у GoTrue публичный: ссылка в таком письме была бы входом без кода.
  test("восстановление доступа — код, без ссылки", () => {
    const { html } = buildEmail(payload(ADMIN, "recovery"), true);
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
  });

  test("приглашение — код, без ссылки", () => {
    const { html } = buildEmail(payload(ADMIN, "invite"), true);
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
  });

  test("смена почты — код", () => {
    const { html } = buildEmail(payload(CLIENT, "email_change"), false);
    expect(hasCode(html)).toBe(true);
  });

  test("неизвестный тип — код (безопасный откат)", () => {
    const { html } = buildEmail(payload(ADMIN, "reauthentication"), true);
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
  });
});

describe("смена почты — код уходит на новый адрес", () => {
  const change = (extra: Partial<HookPayload["email_data"]>): HookPayload => ({
    user: { id: "u1", email: "old@example.com", new_email: "new@example.com" },
    email_data: {
      token: "111111",
      token_hash: "h1",
      redirect_to: CLIENT,
      email_action_type: "email_change",
      site_url: CLIENT,
      ...extra,
    },
  });

  test("без Secure Email Change — одно письмо на новый адрес", () => {
    const emails = buildEmails(change({}), false);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe("new@example.com");
    expect(emails[0].html).toContain("111111");
  });

  test("Secure Email Change — token на текущий адрес, token_new на новый", () => {
    const emails = buildEmails(change({ token_new: "222222", token_hash_new: "h2" }), false);
    expect(emails.map((e) => e.to)).toEqual(["old@example.com", "new@example.com"]);
    expect(emails[0].html).toContain("111111");
    expect(emails[1].html).toContain("222222");
  });

  test("прочие типы — одно письмо на user.email", () => {
    const emails = buildEmails(payload(CLIENT), false);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe("owner@example.com");
  });
});
