import { describe, expect, test } from "bun:test";

import { overduePayments, tbilisiToday } from "./overdue-payments";

describe("просроченные платежи", () => {
  const today = "2026-11-07";
  test("только невнесённые, без возврата и с прошедшей датой; в сам день — не просрочен", () => {
    const rows = [
      { amount: "100", due_date: "2026-11-05", paid: false },
      { amount: 50, due_date: "2026-11-01", paid: false, refunded: null },
      { amount: 70, due_date: "2026-11-07", paid: false },
      { amount: 80, due_date: "2026-11-02", paid: true },
      { amount: 90, due_date: "2026-11-03", paid: false, refunded: true },
    ];
    expect(overduePayments(rows, today)).toEqual([
      { amount: 50, due_date: "2026-11-01" },
      { amount: 100, due_date: "2026-11-05" },
    ]);
  });
  test("сегодня — по Тбилиси (UTC+4)", () => {
    expect(tbilisiToday(new Date("2026-11-06T21:00:00Z"))).toBe("2026-11-07");
  });
});
