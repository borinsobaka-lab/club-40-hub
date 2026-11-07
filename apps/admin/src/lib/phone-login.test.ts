import { describe, expect, test } from "bun:test";

import {
  isAllowedOrigin,
  mapPreludeError,
  normalizeCode,
  normalizePhone,
  preludeLocale,
  resolveIdentity,
  type PhoneCandidate,
} from "./phone-login";

const row = (p: Partial<PhoneCandidate>): PhoneCandidate => ({
  client_id: "c1",
  studio_id: "s1",
  user_id: null,
  email: null,
  account_email: null,
  account_phone: null,
  ...p,
});

describe("номер и код", () => {
  test("номер в E.164", () => {
    expect(normalizePhone("+995 591 09 97 19")).toBe("+995591099719");
    expect(normalizePhone("591 09 97 19")).toBe("+995591099719");
    expect(normalizePhone("00995591099719")).toBe("+995591099719");
    expect(normalizePhone("+7 916 123-45-67")).toBe("+79161234567");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone(42)).toBeNull();
  });
  test("код — 4–8 цифр", () => {
    expect(normalizeCode("1 2 3 4")).toBe("1234");
    expect(normalizeCode("123")).toBeNull();
  });
});

describe("кто за номером", () => {
  test("никого", () => expect(resolveIdentity([])).toBe("not_found"));
  test("карточка с учётной записью", () => {
    expect(resolveIdentity([row({ user_id: "u1", account_email: "a@x.ge" })])).toEqual({
      kind: "account",
      userId: "u1",
      email: "a@x.ge",
      clientIds: ["c1"],
    });
  });
  test("карточки одного человека в двух клубах — одна почта", () => {
    const r = resolveIdentity([
      row({ email: "a@x.ge" }),
      row({ client_id: "c2", email: "a@x.ge" }),
    ]);
    expect(r).toMatchObject({ kind: "email", email: "a@x.ge" });
  });
  test("разные люди на одном номере — ambiguous", () => {
    expect(
      resolveIdentity([row({ email: "a@x.ge" }), row({ client_id: "c2", email: "b@x.ge" })]),
    ).toBe("ambiguous");
    expect(resolveIdentity([row({ user_id: "u1" }), row({ client_id: "c2", user_id: "u2" })])).toBe(
      "ambiguous",
    );
    expect(resolveIdentity([row({}), row({ client_id: "c2" })])).toBe("ambiguous");
    expect(resolveIdentity([row({ email: "a@x.ge" }), row({ client_id: "c2" })])).toBe("ambiguous");
  });
  test("свободная карточка с почтой учётной записи — тот же человек", () => {
    expect(
      resolveIdentity([
        row({ user_id: "u1", account_email: "a@x.ge" }),
        row({ client_id: "c2", email: "a@x.ge" }),
      ]),
    ).toMatchObject({ kind: "account", userId: "u1" });
  });
  test("без почты — по телефону", () => {
    expect(resolveIdentity([row({})])).toEqual({ kind: "phone_only", clientId: "c1" });
  });
});

describe("Prelude и CORS", () => {
  test("язык SMS: грузинского у Verify нет", () => {
    expect(preludeLocale("ru")).toBe("ru");
    expect(preludeLocale("en")).toBe("en");
    expect(preludeLocale("ka")).toBeUndefined();
  });
  test("ошибки", () => {
    expect(mapPreludeError("invalid_line_type")).toBe("invalid_phone");
    expect(mapPreludeError("premature_retry")).toBe("too_many_requests");
    expect(mapPreludeError("invalid_api_key")).toBe("not_configured");
    expect(mapPreludeError("whatever")).toBe("server_error");
  });
  test("адреса приложений", () => {
    expect(isAllowedOrigin("https://app.lady-stretch.one")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("http://localhost:8081", "http://localhost:8081")).toBe(true);
    expect(isAllowedOrigin(null)).toBe(false);
  });
});
