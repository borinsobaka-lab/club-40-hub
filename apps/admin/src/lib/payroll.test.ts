import { describe, expect, test } from "bun:test";

import {
  addMonths,
  defaultPeriod,
  monthDays,
  monthLabel,
  payDate,
  payoutPeriods,
  payrollBounds,
  periodLabel,
  periodRange,
  periodTitle,
  plural,
  studioAbbrs,
  summarize,
  workSummary,
  type PayrollAdjustment,
  type PayrollLine,
} from "./payroll";

const line = (p: Partial<PayrollLine>): PayrollLine => ({
  trainer_id: "t1",
  work_date: "2026-10-05",
  studio_id: "s1",
  studio_name: "Ваке",
  kind: "group",
  title: null,
  units: 1,
  amount: 0,
  ...p,
});

const adj = (p: Partial<PayrollAdjustment>): PayrollAdjustment => ({
  id: "a",
  trainer_id: "t1",
  kind: "bonus",
  amount: 0,
  adjusted_on: "2026-10-05",
  reason: "—",
  created_by_name: null,
  created_at: "2026-10-05T10:00:00Z",
  ...p,
});

describe("периоды прогрессивной ставки: выплаты 11-го и 26-го", () => {
  test("26–10 и 11–25", () => {
    expect(periodRange("2026-11", "advance", "progressive")).toEqual({
      from: "2026-10-26",
      to: "2026-11-10",
    });
    expect(periodRange("2026-11", "main", "progressive")).toEqual({
      from: "2026-11-11",
      to: "2026-11-25",
    });
    // Январь: первый период начинается в декабре прошлого года.
    expect(periodRange("2027-01", "advance", "progressive").from).toBe("2026-12-26");
    expect(payrollBounds("2026-11", "progressive")).toEqual({
      from: "2026-10-26",
      to: "2026-11-25",
    });
    expect(payoutPeriods("2026-11", "month", "progressive")).toEqual([
      { from: "2026-10-26", to: "2026-11-10" },
      { from: "2026-11-11", to: "2026-11-25" },
    ]);
  });

  test("периоды идут подряд без пропусков и наложений", () => {
    expect(periodRange("2026-12", "advance", "progressive").from).toBe("2026-11-26");
    expect(periodRange("2026-11", "main", "progressive").to).toBe("2026-11-25");
  });

  test("день выплаты и подписи", () => {
    expect(payDate("2026-11", "advance", "progressive")).toBe("2026-11-11");
    expect(payDate("2026-11", "main", "progressive")).toBe("2026-11-26");
    expect(payDate("2026-11", "month", "progressive")).toBeNull();
    expect(periodLabel("2026-11", "advance", "progressive")).toBe("26 окт – 10 нояб");
    expect(periodLabel("2026-11", "main", "progressive")).toBe("11–25 нояб");
    expect(periodLabel("2026-11", "month", "progressive")).toBe("Оба периода");
    expect(periodTitle("2026-11", "advance", "progressive")).toBe("26 октября – 10 ноября 2026");
    expect(periodTitle("2026-11", "main", "progressive")).toBe("Ноябрь 11–25, 2026");
  });

  test("период по умолчанию — ближайшая выплата", () => {
    expect(defaultPeriod("2026-11-05", "progressive")).toEqual({
      month: "2026-11",
      period: "advance",
    });
    expect(defaultPeriod("2026-11-11", "progressive")).toEqual({
      month: "2026-11",
      period: "advance",
    });
    expect(defaultPeriod("2026-11-12", "progressive")).toEqual({
      month: "2026-11",
      period: "main",
    });
    expect(defaultPeriod("2026-11-26", "progressive")).toEqual({
      month: "2026-11",
      period: "main",
    });
    expect(defaultPeriod("2026-12-27", "progressive")).toEqual({
      month: "2027-01",
      period: "advance",
    });
  });
});

describe("периоды", () => {
  test("аванс, основная, весь месяц", () => {
    expect(periodRange("2026-10", "advance")).toEqual({ from: "2026-10-01", to: "2026-10-19" });
    expect(periodRange("2026-10", "main")).toEqual({ from: "2026-10-20", to: "2026-10-31" });
    expect(periodRange("2026-02", "main")).toEqual({ from: "2026-02-20", to: "2026-02-28" });
    expect(periodRange("2026-09", "month")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodLabel("2026-09", "main")).toBe("Основная 20–30");
  });

  test("день выплаты", () => {
    expect(payDate("2026-10", "advance")).toBe("2026-10-20");
    expect(payDate("2026-12", "main")).toBe("2027-01-01");
    expect(payDate("2026-10", "month")).toBeNull();
  });

  test("период по умолчанию — ближайшая выплата", () => {
    expect(defaultPeriod("2026-10-01")).toEqual({ month: "2026-09", period: "main" });
    expect(defaultPeriod("2026-01-01")).toEqual({ month: "2025-12", period: "main" });
    expect(defaultPeriod("2026-10-11")).toEqual({ month: "2026-10", period: "advance" });
    expect(defaultPeriod("2026-10-20")).toEqual({ month: "2026-10", period: "advance" });
    expect(defaultPeriod("2026-10-21")).toEqual({ month: "2026-10", period: "main" });
  });

  test("месяцы и подписи", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(monthLabel("2026-10")).toBe("Октябрь 2026");
    expect(periodTitle("2026-09", "advance")).toBe("Сентябрь 1–19, 2026");
    const days = monthDays("2026-10");
    expect(days).toHaveLength(31);
    expect(days[0]).toEqual({ date: "2026-10-01", day: 1, weekday: 4 });
  });
});

describe("summarize", () => {
  test("оклад, продажи, бонус 5 %, корректировки — в границах периода", () => {
    const lines = [
      line({ kind: "group", units: 2, amount: 60 }),
      line({ kind: "personal", units: 1, amount: 50 }),
      line({ kind: "other", title: "Фото", units: 1, amount: 40 }),
      line({ kind: "sale", units: 2, amount: 4718 }),
      line({ kind: "group", work_date: "2026-10-20", units: 1, amount: 30 }),
      line({ trainer_id: "t2", kind: "shift", work_date: "2026-10-01", units: 1, amount: 50 }),
    ];
    const adjustments = [
      adj({ kind: "deduction", amount: 125 }),
      adj({ kind: "bonus", amount: 15 }),
      adj({ kind: "bonus", amount: 100, adjusted_on: "2026-10-25" }),
    ];
    const s = summarize(lines, adjustments, periodRange("2026-10", "advance"));
    expect(s.get("t1")).toEqual({
      bonusRate: 0.05,
      base: 150,
      shifts: 0,
      groups: 2,
      personals: 1,
      others: 1,
      sales: 4718,
      salesCount: 2,
      trialBonus: 0,
      trialSales: 0,
      bonus: 235.9,
      adjustments: -110,
      total: 275.9,
    });
    expect(s.get("t2")?.shifts).toBe(1);
    expect(s.get("t2")?.total).toBe(50);

    const main = summarize(lines, adjustments, periodRange("2026-10", "main"));
    expect(main.get("t1")?.total).toBe(130);
    expect(main.has("t2")).toBe(false);
  });

  test("бонус за абонементы после пробного — в бонусе и итоге, не в окладе", () => {
    const s = summarize(
      [
        line({ kind: "group", units: 1, amount: 33 }),
        line({ kind: "trial_bonus", units: 2, amount: 20 }),
        line({ kind: "sale", units: 1, amount: 100 }),
      ],
      [],
      periodRange("2026-10", "advance"),
    ).get("t1")!;
    expect([s.base, s.trialBonus, s.trialSales, s.bonus, s.total]).toEqual([33, 20, 2, 25, 58]);
  });

  test("подпись оклада", () => {
    const s = summarize(
      [line({ kind: "shift", units: 10, amount: 500 })],
      [],
      periodRange("2026-10", "month"),
    );
    expect(workSummary(s.get("t1")!)).toBe("10 смен");
    expect(plural(1, ["смена", "смены", "смен"])).toBe("смена");
    expect(plural(22, ["смена", "смены", "смен"])).toBe("смены");
    expect(plural(12, ["смена", "смены", "смен"])).toBe("смен");
  });
});

describe("studioAbbrs", () => {
  test("первые буквы, при совпадении — длиннее", () => {
    const m = studioAbbrs(["Ваке", "Сабуртало", "Варкетили", "Old Town"]);
    expect(m.get("Сабуртало")).toBe("С");
    expect(m.get("Old Town")).toBe("OT");
    expect(m.get("Ваке")).toBe("Вак");
    expect(m.get("Варкетили")).toBe("Вар");
  });

  describe("свой процент с продаж", () => {
    test("бонус считается по проценту сотрудника, без него — 5 %", () => {
      const lines = [
        line({ trainer_id: "a", kind: "sale", amount: 1000 }),
        line({ trainer_id: "b", kind: "sale", amount: 1000 }),
      ];
      const out = summarize(lines, [], { from: "2026-10-01", to: "2026-10-31" }, (id) =>
        id === "a" ? 0.03 : 0.05,
      );
      expect(out.get("a")?.bonus).toBe(30);
      expect(out.get("b")?.bonus).toBe(50);
      expect(summarize(lines, [], { from: "2026-10-01", to: "2026-10-31" }).get("a")?.bonus).toBe(
        50,
      );
    });
  });
});
