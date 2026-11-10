import { describe, expect, test } from "bun:test";

import { PRESET_SCHEMES, cleanBonuses, schemeAmount, schemeExamples } from "./pay-schemes";

const [mat, trx] = PRESET_SCHEMES;

describe("оплата по числу людей", () => {
  test("коврик: до 3 — 15 ₾, дальше 4 ₾ за человека, бонус 7+ и 10+", () => {
    expect([0, 1, 3, 4, 5, 6, 7, 9, 10, 12].map((n) => schemeAmount(mat, n))).toEqual([
      15, 15, 15, 16, 20, 24, 33, 41, 50, 58,
    ]);
  });

  test("TRX: пример старшего тренера 2, 7, 5, 4, 3 (+5 ₾ за 7 человек)", () => {
    const total = [2, 7, 5, 4, 3].reduce((s, n) => s + schemeAmount(trx, n), 0);
    expect(total).toBe(15 + 47 + 30 + 24 + 15);
  });

  test("бонусы: порядок, повторы, пустые", () => {
    expect(
      cleanBonuses([
        { from: 10, amount: 10 },
        { from: 7, amount: 5 },
        { from: 7, amount: 6 },
        { from: 0, amount: 3 },
        { from: 5, amount: 0 },
      ]),
    ).toEqual([
      { from: 7, amount: 6 },
      { from: 10, amount: 10 },
    ]);
  });

  test("примеры для подсказки", () => {
    expect(schemeExamples(mat)).toEqual([
      { people: "1–3", amount: 15 },
      { people: "4", amount: 16 },
      { people: "7", amount: 33 },
      { people: "10", amount: 50 },
      { people: "12", amount: 58 },
    ]);
  });
});
