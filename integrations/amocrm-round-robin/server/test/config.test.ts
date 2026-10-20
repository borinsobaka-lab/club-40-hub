import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";

test("стартует только с PUBLIC_URL", () => {
  const c = loadConfig({ PUBLIC_URL: "https://rr.example.com/" });
  expect(c.publicUrl).toBe("https://rr.example.com");
  expect(c.redirectUri).toBe("https://rr.example.com/oauth/callback");
  expect(c.configured).toBe(false);
});

test("все ключи — настроен", () => {
  const c = loadConfig({
    PUBLIC_URL: "https://rr.example.com",
    AMO_CLIENT_ID: "id",
    AMO_CLIENT_SECRET: "secret",
  });
  expect(c.configured).toBe(true);
});

test("без адреса или не https — ошибка", () => {
  expect(() => loadConfig({})).toThrow();
  expect(() => loadConfig({ PUBLIC_URL: "http://rr.example.com" })).toThrow();
});
