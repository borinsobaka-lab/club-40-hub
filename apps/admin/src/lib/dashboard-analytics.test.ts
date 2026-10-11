import { describe, expect, test } from "bun:test";

import {
  ageGroups,
  ageOn,
  classifySales,
  clientLtv,
  dailySeries,
  foldSlices,
  membershipPayments,
  renewalRates,
  salesMetrics,
  type SaleRecord,
} from "./dashboard-analytics";

let seq = 0;
function sale(p: Partial<SaleRecord> & { clientId: string; soldAt: string }): SaleRecord {
  seq++;
  return {
    id: p.id ?? `s${seq}`,
    createdAt: `${p.soldAt}T10:00:${String(seq % 60).padStart(2, "0")}Z`,
    totalAmount: 100,
    membershipName: "Безлимит",
    trial: false,
    method: "cash",
    sellerKey: null,
    sellerName: null,
    endsAt: null,
    cancelled: false,
    noMembership: false,
    installments: [],
    ...p,
  };
}

describe("membershipPayments", () => {
  test("без графика — вся сумма в день продажи", () => {
    const p = membershipPayments([sale({ clientId: "a", soldAt: "2026-10-01", totalAmount: 300 })]);
    expect(p).toEqual([
      expect.objectContaining({ date: "2026-10-01", amount: 300, method: "cash" }),
    ]);
  });

  test("с графиком — только внесённые платежи, в день внесения", () => {
    const p = membershipPayments([
      sale({
        clientId: "a",
        soldAt: "2026-09-01",
        totalAmount: 300,
        method: "card",
        installments: [
          { amount: 100, paid: true, date: "2026-09-01", method: null },
          { amount: 100, paid: true, date: "2026-10-03", method: "transfer" },
          { amount: 100, paid: false, date: "2026-11-01", method: null },
        ],
      }),
    ]);
    expect(p.map((x) => [x.date, x.amount, x.method])).toEqual([
      ["2026-09-01", 100, "card"],
      ["2026-10-03", 100, "transfer"],
    ]);
  });
});

describe("classifySales", () => {
  test("первая покупка — новый, без перерыва — продление, после перерыва — возврат", () => {
    const first = sale({ clientId: "a", soldAt: "2026-01-01", endsAt: "2026-01-31" });
    const renewal = sale({ clientId: "a", soldAt: "2026-02-20", endsAt: "2026-03-20" });
    const back = sale({ clientId: "a", soldAt: "2026-06-01", endsAt: "2026-06-30" });
    const other = sale({ clientId: "b", soldAt: "2026-06-01" });
    const r = classifySales([back, other, renewal, first]);
    expect(r.get(first.id)).toBe("new");
    expect(r.get(renewal.id)).toBe("renewal");
    expect(r.get(back.id)).toBe("return");
    expect(r.get(other.id)).toBe("new");
  });

  test("пробное историей не считается", () => {
    const trial = sale({ clientId: "a", soldAt: "2026-01-01", endsAt: "2026-01-01", trial: true });
    const pack = sale({ clientId: "a", soldAt: "2026-01-02", endsAt: "2026-02-01" });
    const r = classifySales([trial, pack]);
    expect(r.get(trial.id)).toBe("new");
    expect(r.get(pack.id)).toBe("new");
  });

  test("прежний абонемент без срока — продление", () => {
    const open = sale({ clientId: "a", soldAt: "2025-01-01", endsAt: null });
    const next = sale({ clientId: "a", soldAt: "2026-05-01", endsAt: "2026-06-01" });
    expect(classifySales([open, next]).get(next.id)).toBe("renewal");
  });
});

describe("renewalRates", () => {
  test("продления и возвращения по месяцам", () => {
    const sales = [
      // a: закончился в марте, продлил через 10 дней
      sale({ clientId: "a", soldAt: "2026-02-10", endsAt: "2026-03-10" }),
      sale({ clientId: "a", soldAt: "2026-03-20", endsAt: "2026-04-20" }),
      // b: закончился в марте, не продлил; вернулся в июне
      sale({ clientId: "b", soldAt: "2026-02-01", endsAt: "2026-03-01" }),
      sale({ clientId: "b", soldAt: "2026-06-05", endsAt: "2026-07-05" }),
      // c: отменённый — не в базе продлений
      sale({ clientId: "c", soldAt: "2026-02-01", endsAt: "2026-03-05", cancelled: true }),
    ];
    const rates = renewalRates(sales, new Date(2026, 5, 15), 4); // март–июнь
    expect(rates.map((r) => r.key)).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
    const march = rates[0];
    expect([march.renewed, march.renewalBase, march.renewal]).toEqual([1, 2, 50]);
    // На начало июня больше 30 дней без абонемента все трое (a — с 20 апреля),
    // вернулся только b.
    const june = rates[3];
    expect([june.returned, june.returnBase]).toEqual([1, 3]);
    expect(june.returnRate).toBeCloseTo(33.33, 1);
    // В апреле с окончания у b прошёл всего 31 день — уже ушедший, c — 27 дней ещё нет.
    expect(rates[1].returnBase).toBe(1);
  });
});

describe("возраст", () => {
  test("полных лет и группы", () => {
    const today = new Date(2026, 9, 11);
    expect(ageOn("2000-10-11", today)).toBe(26);
    expect(ageOn("2000-10-12", today)).toBe(25);
    expect(ageOn(null, today)).toBeNull();
    expect(ageOn("2030-01-01", today)).toBeNull();
    const g = ageGroups([15, 25, 29, 30, 65, null]);
    expect(g.map((x) => x.value)).toEqual([1, 2, 1, 0, 0, 1, 1]);
  });
});

describe("foldSlices", () => {
  test("хвост сворачивается в «Остальное»", () => {
    const s = foldSlices(
      [
        { key: "a", label: "A", value: 5 },
        { key: "b", label: "B", value: 4 },
        { key: "c", label: "C", value: 1 },
        { key: "d", label: "D", value: 2 },
        { key: "z", label: "Z", value: 0 },
      ],
      3,
    );
    expect(s.map((x) => [x.label, x.value])).toEqual([
      ["A", 5],
      ["B", 4],
      ["Остальное", 3],
    ]);
  });
});

describe("dailySeries", () => {
  test("все дни периода, пустые — нулём", () => {
    const d = dailySeries(
      [
        { date: "2026-10-02", value: 5 },
        { date: "2026-10-02", value: 1 },
        { date: "2026-11-01", value: 9 },
      ],
      "2026-10-01",
      "2026-10-03",
    );
    expect(d.map((x) => [x.date, x.value])).toEqual([
      ["2026-10-01", 0],
      ["2026-10-02", 6],
      ["2026-10-03", 0],
    ]);
  });
});

describe("salesMetrics и clientLtv", () => {
  const sales = [
    sale({
      id: "x",
      clientId: "a",
      soldAt: "2026-09-20",
      totalAmount: 300,
      installments: [
        { amount: 100, paid: true, date: "2026-09-20", method: null },
        { amount: 200, paid: true, date: "2026-10-05", method: null },
      ],
    }),
    sale({ id: "y", clientId: "b", soldAt: "2026-10-02", totalAmount: 500 }),
  ];
  const otherSales = [
    {
      id: "o1",
      clientId: "a",
      soldAt: "2026-10-03",
      totalAmount: 40,
      itemName: "Вода",
      method: "cash",
    },
  ];

  test("выручка — по дате продажи, платежи — по дате внесения", () => {
    const m = salesMetrics({ sales, otherSales }, "2026-10-01", "2026-10-31");
    expect(m.membershipRevenue).toBe(500);
    expect(m.membershipPayments).toBe(700);
    expect(m.avgMembershipPayment).toBe(350);
    expect(m.otherRevenue).toBe(40);
    expect(m.avgOtherCheck).toBe(40);
  });

  test("LTV — все платежи клиента минус возвраты", () => {
    const ltv = clientLtv({
      sales,
      otherSales,
      refunds: [{ date: "2026-10-04", amount: 50, saleId: "x", otherSaleId: null }],
    });
    expect(ltv.get("a")).toBe(290);
    expect(ltv.get("b")).toBe(500);
  });
});
