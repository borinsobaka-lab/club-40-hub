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

// Письмо считаем «клиентским», если в нём есть код и нет ссылки авто-входа.
const hasCode = (html: string) => html.includes("1234");
const hasLoginLink = (html: string) => html.includes("/auth/v1/verify");

describe("isAdminApp — признак приложения по redirect_to", () => {
  test("админка", () => expect(isAdminApp(ADMIN)).toBe(true));
  test("клиентское приложение", () => expect(isAdminApp(CLIENT)).toBe(false));
  test("подделка хоста не проходит", () =>
    expect(isAdminApp("https://admin.base40.fit.evil.com/")).toBe(false));
  test("пустой redirect — считаем клиентом", () => expect(isAdminApp("")).toBe(false));
  test("мусор вместо URL — считаем клиентом", () => expect(isAdminApp("не-url")).toBe(false));
});

describe("вход: письмо зависит от приложения, а не от человека", () => {
  test("клиентское приложение — код, без ссылки авто-входа", () => {
    const { html, subject } = buildEmail(payload(CLIENT), isAdminApp(CLIENT));
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
    expect(subject).not.toContain("админ");
  });

  test("админка — ссылка, без кода", () => {
    const { html, subject } = buildEmail(payload(ADMIN), isAdminApp(ADMIN));
    expect(hasLoginLink(html)).toBe(true);
    expect(hasCode(html)).toBe(false);
    expect(subject).toContain("админ");
  });

  test("один и тот же человек в двух приложениях получает разные письма", () => {
    const asClient = buildEmail(payload(CLIENT), isAdminApp(CLIENT));
    const asStaff = buildEmail(payload(ADMIN), isAdminApp(ADMIN));
    expect(asClient.subject).not.toBe(asStaff.subject);
    expect(hasCode(asClient.html)).toBe(true);
    expect(hasCode(asStaff.html)).toBe(false);
  });

  test("нераспознанный redirect — безопасный откат на код", () => {
    const { html } = buildEmail(payload(""), isAdminApp(""));
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
  });
});

describe("остальные типы писем", () => {
  test("регистрация клиента — код", () => {
    const { html } = buildEmail(payload(CLIENT, "signup"), false);
    expect(hasCode(html)).toBe(true);
    expect(hasLoginLink(html)).toBe(false);
  });

  test("восстановление пароля — ссылка (только админка, у клиентов паролей нет)", () => {
    const { html } = buildEmail(payload(ADMIN, "recovery"), true);
    expect(hasLoginLink(html)).toBe(true);
  });

  test("приглашение сотрудника — ссылка", () => {
    const { html } = buildEmail(payload(ADMIN, "invite"), true);
    expect(hasLoginLink(html)).toBe(true);
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
