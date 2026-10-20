import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { signToken, verifyDisableSignature, verifyDisposableToken } from "../src/jwt";

const secret = "s3cret";
const clientId = "0b0832f6-0000-0000-0000-000000000000";
const now = 1_800_000_000;
const good = {
  account_id: 1,
  user_id: 2,
  client_uuid: clientId,
  iat: now,
  nbf: now,
  exp: now + 1800,
};

test("свой токен принимается", () => {
  expect(verifyDisposableToken(signToken(good, secret), secret, clientId, now)?.user_id).toBe(2);
});

test("чужая подпись, истёкший, чужая интеграция — нет", () => {
  expect(verifyDisposableToken(signToken(good, "other"), secret, clientId, now)).toBeNull();
  expect(verifyDisposableToken(signToken(good, secret), secret, clientId, now + 2000)).toBeNull();
  expect(
    verifyDisposableToken(signToken({ ...good, client_uuid: "x" }, secret), secret, clientId, now),
  ).toBeNull();
  expect(verifyDisposableToken("abc", secret, clientId, now)).toBeNull();
});

test("подпись хука отключения", () => {
  const sig = createHmac("sha256", secret).update(`${clientId}|123`).digest("hex");
  expect(verifyDisableSignature(clientId, "123", sig, secret)).toBe(true);
  expect(verifyDisableSignature(clientId, "124", sig, secret)).toBe(false);
});
