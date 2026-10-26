import { describe, expect, test } from "bun:test";

import {
  change,
  classesSummary,
  filterStudios,
  forecast,
  formatChange,
  formatRate,
  groupByCity,
  monthStarts,
  monthWeeks,
  nomenclature,
  rating,
  revenueTable,
  salesSummary,
  shiftPeriod,
  trialsSummary,
  zeroTree,
} from "./logic";
import type { AnStudio, RevenueRow, SalesData } from "./types";

const studio = (id: string, city: string | null, extra: Partial<AnStudio> = {}): AnStudio => ({
  id,
  name: id,
  city,
  format: "packages",
  ownership: "own",
  brandId: null,
  brandName: null,
  brandColor: null,
  pointZero: null,
  closedOn: null,
  canManage: false,
  ...extra,
});

const TODAY = "2026-09-10";

describe("клубы по городам", () => {
  test("сначала города с открытыми клубами по алфавиту, внутри — открытые, затем закрытые", () => {
    const groups = groupByCity(
      [
        studio("Ваке", "Тбилиси"),
        studio("Старый", "Тбилиси", { closedOn: "2026-01-01" }),
        studio("Абакан-1", "Абакан", { closedOn: "2026-01-01" }),
        studio("Батуми", "Батуми"),
        studio("Сабуртало", "Тбилиси"),
        studio("Без", null),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.city)).toEqual(["Батуми", "Тбилиси", "Без города", "Абакан"]);
    expect(groups[1].studios.map((s) => s.id)).toEqual(["Ваке", "Сабуртало", "Старый"]);
  });

  test("закрытие с будущей даты ещё не действует; фильтр статуса", () => {
    const list = [
      studio("a", "X", { closedOn: "2026-09-11" }),
      studio("b", "X", { closedOn: TODAY }),
    ];
    const f = { brandId: null, city: null, clubId: null };
    expect(filterStudios(list, { ...f, status: "open" }, TODAY).map((s) => s.id)).toEqual(["a"]);
    expect(filterStudios(list, { ...f, status: "closed" }, TODAY).map((s) => s.id)).toEqual(["b"]);
  });
});

describe("периоды", () => {
  test("недели месяца — пн–вс, обрезаны месяцем", () => {
    // Сентябрь 2026: 1-е — вторник.
    expect(monthWeeks("2026-09-01").map((w) => w.label)).toEqual([
      "1–6",
      "7–13",
      "14–20",
      "21–27",
      "28–30",
    ]);
  });

  test("сдвиг периода: конец месяца остаётся концом, день ограничен длиной месяца", () => {
    expect(shiftPeriod({ from: "2026-09-01", to: "2026-09-30" }, -1)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(shiftPeriod({ from: "2026-03-01", to: "2026-03-30" }, -1)).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(shiftPeriod({ from: "2026-09-01", to: "2026-09-17" }, -12)).toEqual({
      from: "2025-09-01",
      to: "2025-09-17",
    });
    expect(monthStarts("2026-09-17", 3)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  test("прогноз: по прошедшим полным дням, 1-го числа и не в текущем месяце — нет", () => {
    expect(forecast(900, "2026-09-01", "2026-09-10")).toBe(3000);
    expect(forecast(0, "2026-09-01", "2026-09-01")).toBeNull();
    expect(forecast(900, "2026-08-01", "2026-09-10")).toBeNull();
  });

  test("изменение и формат", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(5, 0)).toBeNull();
    expect(change(null, 3)).toBeNull();
    expect(formatChange(-4.6)).toBe("−5%");
    expect(formatRate(null)).toBe("—");
    expect(formatRate(48.25, 1)).toBe("48,3%");
  });
});

describe("выручка", () => {
  const row = (studioId: string, date: string, m: number, refunds = 0): RevenueRow => ({
    studioId,
    date,
    membership: m,
    other: 0,
    refunds,
  });

  test("недели, факт, прогноз города от суммы, точка 0, история", () => {
    const studios = [
      studio("a", "Тбилиси", { pointZero: 3000 }),
      studio("b", "Тбилиси", { pointZero: 2000 }),
      studio("c", "Батуми"),
    ];
    const days = [
      row("a", "2026-09-02", 500),
      row("a", "2026-09-08", 400, 100),
      row("b", "2026-09-09", 300),
      row("a", "2026-09-10", 1000), // сегодня: в факте есть, в прогнозе нет
    ];
    const months = [row("a", "2026-08-01", 5000), row("b", "2026-07-01", 700)];
    const t = revenueTable({
      studios,
      days,
      months,
      month: "2026-09-01",
      today: TODAY,
      history: 2,
    });
    expect(t.historyMonths).toEqual(["2026-08-01", "2026-07-01"]);
    const tbilisi = t.cities.find((c) => c.line.label === "Тбилиси")!;
    expect(tbilisi.line.weeks).toEqual([500, 1600, 0, 0, 0]);
    expect(tbilisi.line.fact).toBe(2100);
    // До вчера: 1100 за 9 дней → 1100 / 9 × 30.
    expect(tbilisi.line.forecast).toBeCloseTo((1100 / 9) * 30, 6);
    expect(tbilisi.line.pointZero).toBe(5000);
    expect(tbilisi.line.pointZeroRate).toBeCloseTo((((1100 / 9) * 30) / 5000) * 100, 6);
    expect(tbilisi.line.history).toEqual([5000, 700]);
    expect(t.total.fact).toBe(2100);
    // У Батуми точки 0 нет — у сети тоже.
    expect(t.total.pointZero).toBeNull();
  });
});

const sales: SalesData = {
  sold: [
    { studioId: "a", date: "2026-09-01", membershipId: "m1", origin: "new", count: 2, amount: 200 },
    {
      studioId: "a",
      date: "2026-09-02",
      membershipId: "m1",
      origin: "renewal",
      count: 3,
      amount: 300,
    },
    {
      studioId: "a",
      date: "2026-09-02",
      membershipId: "m2",
      origin: "return",
      count: 1,
      amount: 150,
    },
    { studioId: "a", date: "2026-09-03", membershipId: "t", origin: "trial", count: 4, amount: 40 },
    { studioId: "b", date: "2026-09-03", membershipId: "m1", origin: "new", count: 5, amount: 500 },
  ],
  paid: [],
  paidTotal: [
    { studioId: "a", origin: "new", income: 200, refunds: 0, paidSales: 2 },
    { studioId: "a", origin: "renewal", income: 300, refunds: 100, paidSales: 3 },
    { studioId: "a", origin: "return", income: 150, refunds: 0, paidSales: 1 },
    { studioId: "a", origin: "trial", income: 40, refunds: 0, paidSales: 4 },
  ],
  names: { m1: { name: "8 занятий", kind: "package" }, m2: { name: "Безлимит", kind: "package" } },
};

describe("продажи", () => {
  test("абонементы без пробных, повторные = продления + возвраты, средний чек по оплаченным", () => {
    const s = salesSummary(sales, new Set(["a"]));
    expect([s.sold, s.newSold, s.repeatSold, s.trials]).toEqual([6, 2, 4, 4]);
    expect(s.paid).toBe(550);
    expect(s.repeatPaid).toBe(350);
    expect(s.avgCheck).toBeCloseTo(550 / 6, 6);
    expect(s.avgRepeat).toBeCloseTo(350 / 4, 6);
  });

  test("что покупают: все / новые / продления", () => {
    const ids = new Set(["a", "b"]);
    expect(nomenclature(sales, ids, "all").map((l) => [l.name, l.count])).toEqual([
      ["8 занятий", 10],
      ["Безлимит", 1],
    ]);
    expect(nomenclature(sales, ids, "new").map((l) => l.count)).toEqual([7]);
    expect(nomenclature(sales, ids, "repeat").map((l) => l.count)).toEqual([3, 1]);
  });
});

describe("занятия и пробные", () => {
  test("средние и доходимость — из итоговых сумм", () => {
    const s = classesSummary(
      [
        {
          studioId: "a",
          date: "d",
          workoutId: "w",
          kind: "group",
          classes: 2,
          booked: 10,
          attended: 8,
          noShow: 2,
          capacity: 20,
          capAttended: 8,
        },
        {
          studioId: "a",
          date: "d",
          workoutId: null,
          kind: "personal",
          classes: 3,
          booked: 3,
          attended: 3,
          noShow: 0,
          capacity: 0,
          capAttended: 0,
        },
      ],
      new Set(["a"]),
    );
    expect([s.classes, s.personal, s.avgBooked, s.attendance, s.fill]).toEqual([2, 3, 5, 80, 40]);
  });

  test("конверсии пробных — от пришедших; без пришедших — нет доли", () => {
    const t = trialsSummary(
      [
        {
          studioId: "a",
          date: "d",
          membershipId: "t",
          trials: 10,
          attended: 8,
          day0: 4,
          d14: 6,
          open: 1,
        },
      ],
      new Set(["a"]),
    );
    expect([t.attendance, t.day0Rate, t.d14Rate]).toEqual([80, 50, 75]);
    expect(trialsSummary([], new Set(["a"])).d14Rate).toBeNull();
  });

  test("рейтинг: доли по клубам с пришедшими, продления и возвраты штуками", () => {
    const r = rating({
      studios: [studio("a", "X"), studio("b", "X"), studio("c", "Y")],
      trials: [
        {
          studioId: "a",
          date: "d",
          membershipId: "t",
          trials: 4,
          attended: 4,
          day0: 1,
          d14: 2,
          open: 0,
        },
        {
          studioId: "b",
          date: "d",
          membershipId: "t",
          trials: 2,
          attended: 2,
          day0: 2,
          d14: 2,
          open: 0,
        },
      ],
      sales,
      by: "club",
    });
    expect(r.day0.map((e) => [e.key, e.value])).toEqual([
      ["b", 100],
      ["a", 25],
    ]);
    expect(r.renewals.map((e) => [e.key, e.value])).toEqual([["a", 3]]);
    const byCity = rating({
      studios: [studio("a", "X"), studio("b", "X")],
      trials: [],
      sales,
      by: "city",
    });
    expect(byCity.returns).toEqual([{ key: "X", label: "X", value: 1 }]);
  });
});

test("нулевая номенклатура: город → клуб → позиции, пустые не показываются", () => {
  const tree = zeroTree(
    [
      { studioId: "a", kind: "membership", name: "Пакет", count: 2, lastOn: "2026-09-01" },
      { studioId: "a", kind: "other", name: "Вода", count: 5, lastOn: "2026-09-02" },
    ],
    [studio("a", "X"), studio("b", "Y")],
    TODAY,
  );
  expect(tree.map((c) => [c.city, c.count])).toEqual([["X", 7]]);
  expect(tree[0].studios[0].items.map((i) => i.name)).toEqual(["Вода", "Пакет"]);
});
