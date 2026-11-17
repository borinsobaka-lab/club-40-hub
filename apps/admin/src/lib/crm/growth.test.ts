import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CRM_SETTINGS,
  funnelMoney,
  funnelSteps,
  monthLabel,
  monthOf,
  plural,
  scenarioLabel,
  scenarioRule,
  waitingMinutes,
  waitTone,
  workStart,
} from "./logic";

const S = DEFAULT_CRM_SETTINGS; // 9–21 по Тбилиси, норматив 15, эскалация 60

describe("скорость ответа", () => {
  test("рабочие часы по Тбилиси (UTC+4): ночное сообщение ждёт с открытия", () => {
    // 12:00 Тбилиси — сразу.
    expect(workStart(new Date("2026-11-20T08:00:00Z"), S).toISOString()).toBe(
      "2026-11-20T08:00:00.000Z",
    );
    // 23:30 Тбилиси — с 9:00 следующего дня.
    expect(workStart(new Date("2026-11-20T19:30:00Z"), S).toISOString()).toBe(
      "2026-11-21T05:00:00.000Z",
    );
    // 03:00 Тбилиси — с 9:00 того же дня.
    expect(workStart(new Date("2026-11-19T23:00:00Z"), S).toISOString()).toBe(
      "2026-11-20T05:00:00.000Z",
    );
    // Ровно закрытие (21:00) — уже нерабочее.
    expect(workStart(new Date("2026-11-20T17:00:00Z"), S).toISOString()).toBe(
      "2026-11-21T05:00:00.000Z",
    );
  });

  test("сколько ждёт: в рабочее время, ночью — ноль до открытия", () => {
    expect(waitingMinutes(null, new Date(), S)).toBeNull();
    expect(waitingMinutes("2026-11-20T08:00:00Z", new Date("2026-11-20T08:25:30Z"), S)).toBe(25);
    expect(waitingMinutes("2026-11-20T19:30:00Z", new Date("2026-11-20T22:00:00Z"), S)).toBe(0);
    expect(waitingMinutes("2026-11-20T19:30:00Z", new Date("2026-11-21T05:10:00Z"), S)).toBe(10);
  });

  test("в нормативе, дольше норматива, пора звать руководителя", () => {
    expect(waitTone(14, S)).toBe("ok");
    expect(waitTone(15, S)).toBe("late");
    expect(waitTone(60, S)).toBe("critical");
    expect(waitTone(600, { ...S, escalate_minutes: null })).toBe("late");
  });
});

describe("сценарии", () => {
  test("подписи и правило с параметрами", () => {
    expect(scenarioLabel("lapsed")).toBe("Возврат");
    expect(scenarioLabel("нет такого")).toBe("Сценарий");
    expect(scenarioRule("expiring", { days: 7, left: 2 })).toBe(
      "До конца срока ≤ 7 дней или осталось ≤ 2 тренировки",
    );
    expect(scenarioRule("expiring", { days: 0, left: 1 })).toBe(
      "До конца срока сегодня или осталось ≤ 1 тренировка",
    );
    expect(scenarioRule("overdue_payment", { days: 1 })).toBe("Платёж просрочен на 1 день");
    expect(scenarioRule("inactive", { days: 21 })).toBe("Не был 21 день и не записан");
  });

  test("склонение", () => {
    expect([1, 2, 5, 11, 22, 111].map((n) => plural(n, "день", "дня", "дней"))).toEqual([
      "день",
      "дня",
      "дней",
      "дней",
      "дня",
      "дней",
    ]);
  });
});

describe("сквозная воронка", () => {
  const row = {
    leads: 40,
    replied: 36,
    booked: 20,
    attended: 15,
    trial: 12,
    won: 8,
    lost: 10,
    revenue: 2400,
    ltv: 3000,
    spend: 1000,
  };

  test("цена заявки и клиента, окупаемость", () => {
    expect(funnelMoney(row)).toEqual({ cpl: 25, cac: 125, romi: 200 });
    expect(funnelMoney({ ...row, spend: 0 })).toEqual({ cpl: null, cac: null, romi: null });
    expect(funnelMoney({ ...row, won: 0, ltv: 0 })).toEqual({ cpl: 25, cac: null, romi: -100 });
  });

  test("шаги по порядку", () => {
    expect(funnelSteps(row).map((s) => [s.label, s.count])).toEqual([
      ["Заявки", 40],
      ["Ответили", 36],
      ["Записаны", 20],
      ["Пришли", 15],
      ["Купили", 8],
    ]);
  });

  test("месяц расхода", () => {
    expect(monthOf("2026-11-19")).toBe("2026-11-01");
    expect(monthLabel("2026-11-01")).toBe("Ноябрь 2026");
  });
});
