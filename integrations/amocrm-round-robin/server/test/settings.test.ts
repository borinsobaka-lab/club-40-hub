import { expect, test } from "bun:test";
import { parseSettings } from "../src/settings";

test("JSON-строка и объект", () => {
  const want = { users: [3, 1, 2], skipManual: true };
  expect(parseSettings('{"users":[3,1,2],"skip_manual":true}')).toEqual(want);
  expect(parseSettings({ users: ["3", "1", "2"], skip_manual: true })).toEqual(want);
});

test("мусор и дубли", () => {
  expect(parseSettings("не json")).toEqual({ users: [], skipManual: false });
  expect(parseSettings(undefined)).toEqual({ users: [], skipManual: false });
  expect(parseSettings({ users: [1, 1, "x", -2, 0, 4] })).toEqual({
    users: [1, 4],
    skipManual: false,
  });
});
