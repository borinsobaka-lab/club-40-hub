import { describe, expect, test } from "bun:test";

import type { CommentStats } from "./client-comments";
import {
  commentLag,
  controlCopyText,
  controlFact,
  controlItems,
  endingWindow,
  hasFreshComment,
  isRenewed,
  overdueDebt,
  renewedKeys,
  type ControlSale,
} from "./dashboard-control";

const now = new Date(2026, 10, 10, 15, 0); // 10 ноября 2026, 15:00 локально
const today = "2026-11-10";

function sale(over: Partial<ControlSale> = {}): ControlSale {
  return {
    id: "s1",
    client_id: "c1",
    studio_name: "Ваке",
    clients: { full_name: null, first_name: "Анна", last_name: "Иванова", phone: "+995555" },
    memberships: { name: "8 занятий", kind: "package", visits_count: 8, personal_count: null },
    membership_state: "active",
    ends_at: "2026-11-12",
    balance_left: 3,
    payments: [],
    ...over,
  };
}

function stats(clientId: string, at: Date, kind: CommentStats["last_kind"] = "note"): CommentStats {
  return {
    client_id: clientId,
    comments_count: 1,
    last_at: at.toISOString(),
    last_kind: kind,
    last_author: "Нино",
    last_body: "Позвонить",
    last_sale_id: null,
  };
}

describe("«Руководителю» — свежесть комментария", () => {
  test("не старше 7 дней по календарю: 3-го — ещё свежий 10-го, 2-го — уже нет", () => {
    expect(hasFreshComment(stats("c1", new Date(2026, 10, 3, 23, 0)), now)).toBe(true);
    expect(hasFreshComment(stats("c1", new Date(2026, 10, 2, 9, 0)), now)).toBe(false);
    expect(hasFreshComment(stats("c1", new Date(2026, 10, 10, 9, 0)), now)).toBe(true);
  });

  test("нет комментариев и перенесённый без даты — не свежий", () => {
    expect(hasFreshComment(undefined, now)).toBe(false);
    expect(hasFreshComment(stats("c1", new Date(2026, 10, 9), "imported"), now)).toBe(false);
  });

  test("подпись: нет комментариев / сколько дней назад", () => {
    expect(commentLag(undefined, now)).toBe("Нет комментариев");
    expect(commentLag(stats("c1", new Date(2026, 9, 21)), now)).toBe("Последний 20 дней назад");
    expect(commentLag(stats("c1", new Date(2026, 10, 2)), now)).toBe("Последний 8 дней назад");
  });
});

describe("«Руководителю» — отбор", () => {
  test("окно «заканчиваются» — сегодня и 7 дней вперёд, через границу месяца", () => {
    expect(endingWindow(today)).toEqual({ from: today, to: "2026-11-17" });
    expect(endingWindow("2026-12-28")).toEqual({ from: "2026-12-28", to: "2027-01-04" });
  });

  test("продление в очереди — по виду баланса: персональные отдельно от групповых", () => {
    const renewed = renewedKeys([{ client_id: "c1", memberships: { kind: "package" } }]);
    expect(isRenewed(sale(), renewed)).toBe(true);
    expect(isRenewed(sale({ client_id: "c2" }), renewed)).toBe(false);
    const personal = sale({
      memberships: {
        name: "Персональные",
        kind: "personal",
        visits_count: null,
        personal_count: 5,
      },
    });
    expect(isRenewed(personal, renewed)).toBe(false);
    expect(isRenewed(sale({ memberships: null }), renewed)).toBe(true);
  });

  test("строки: без свежего комментария, сначала без комментариев, затем давние", () => {
    const sales = [
      sale({ id: "a", client_id: "fresh" }),
      sale({ id: "b", client_id: "old" }),
      sale({ id: "c", client_id: "none" }),
      sale({ id: "d", client_id: "older" }),
    ];
    const map = new Map([
      ["fresh", stats("fresh", new Date(2026, 10, 8))],
      ["old", stats("old", new Date(2026, 9, 25))],
      ["older", stats("older", new Date(2026, 8, 1))],
    ]);
    const items = controlItems(sales, map, new Set(), now);
    expect(items.map((x) => x.sale.id)).toEqual(["c", "d", "b"]);
    expect(items.every((x) => !x.done)).toBe(true);
  });

  test("уже показанная строка, которой написали, остаётся внизу с «Готово»", () => {
    const sales = [sale({ id: "a", client_id: "c1" }), sale({ id: "b", client_id: "c2" })];
    const map = new Map([["c1", stats("c1", new Date(2026, 10, 10, 14, 0))]]);
    const items = controlItems(sales, map, new Set(["a", "b"]), now);
    expect(items.map((x) => [x.sale.id, x.done])).toEqual([
      ["b", false],
      ["a", true],
    ]);
  });
});

describe("«Руководителю» — подписи абонемента", () => {
  test("просроченный долг: только невнесённые с прошедшей датой, без возврата", () => {
    const payments = [
      { amount: 100, due_date: "2026-10-01", paid: true },
      { amount: "150", due_date: "2026-11-01", paid: false },
      { amount: 50, due_date: "2026-11-05", paid: false },
      { amount: 70, due_date: "2026-10-20", paid: false, refunded: true },
      { amount: 200, due_date: today, paid: false },
    ];
    expect(overdueDebt(payments, today)).toEqual({ amount: 200, since: "2026-11-01" });
    const fact = controlFact("overdue", sale({ payments }), today);
    expect(fact).toContain("Просрочено");
    expect(fact).toContain("01.11.2026");
    expect(fact).toContain("(9 дней)");
  });

  test("заканчивается: сегодня / завтра / через N дней, с остатком", () => {
    expect(controlFact("ending", sale({ ends_at: today }), today)).toBe(
      "Заканчивается сегодня, 10.11.2026 · на балансе 3 из 8 тренировок",
    );
    expect(controlFact("ending", sale({ ends_at: "2026-11-11" }), today)).toContain("завтра");
    expect(controlFact("ending", sale({ ends_at: "2026-11-15" }), today)).toContain("через 5 дней");
  });

  test("остаток: групповые и персональные, срок", () => {
    expect(controlFact("balance", sale(), today)).toBe(
      "На балансе 3 из 8 тренировок · до 12.11.2026",
    );
    const personal = sale({
      ends_at: null,
      balance_left: 2,
      memberships: {
        name: "Персональные",
        kind: "personal",
        visits_count: null,
        personal_count: 5,
      },
    });
    expect(controlFact("balance", personal, today)).toBe("На балансе 2 из 5 персональных");
  });
});

describe("«Руководителю» — копирование списка", () => {
  test("заголовок и клиенты: имя фамилия (телефон, почта), без повторов и без «Готово»", () => {
    const anna = sale({
      id: "a",
      clients: {
        full_name: null,
        first_name: "Анна",
        last_name: "Иванова",
        phone: "+995555123456",
        email: "anna@example.com",
      },
    });
    const items = [
      { sale: anna, done: false },
      { sale: { ...anna, id: "a2" }, done: false },
      {
        sale: sale({
          id: "b",
          client_id: "c2",
          clients: { full_name: "Нино", first_name: null, last_name: null, phone: null },
        }),
        done: false,
      },
      {
        sale: sale({
          id: "c",
          client_id: "c3",
          clients: {
            full_name: null,
            first_name: "Мария",
            last_name: null,
            phone: null,
            email: "m@example.com",
          },
        }),
        done: false,
      },
      { sale: sale({ id: "d", client_id: "c4" }), done: true },
    ];
    expect(controlCopyText("Просроченные платежи", items)).toBe(
      [
        "Просроченные платежи",
        "Анна Иванова (+995 555 12 34 56, anna@example.com)",
        "Нино",
        "Мария (m@example.com)",
      ].join("\n"),
    );
  });
});
