import { describe, expect, test } from "bun:test";

import { carryoverBalanceKind, carryoverError, type CarryoverFields } from "./carryover";

const base: CarryoverFields = {
  clientId: "c",
  membershipId: "m",
  visits: "7",
  personal: "",
  diagnostics: "",
  startsOn: "2026-10-30",
  endsOn: "2026-11-29",
  debt: "",
  debtDue: "2026-12-10",
};

describe("форма абонемента переноса", () => {
  test("заполненная — без ошибок", () => {
    expect(carryoverError(base)).toBeNull();
    expect(carryoverError({ ...base, debt: "141" })).toBeNull();
  });

  test("обязательные поля и проверки как в базе", () => {
    expect(carryoverError({ ...base, clientId: "" })).toBe("Выберите клиента");
    expect(carryoverError({ ...base, membershipId: "" })).toBe("Выберите абонемент переноса");
    expect(carryoverError({ ...base, visits: "" })).toBe("Укажите остаток тренировок");
    expect(carryoverError({ ...base, visits: "2.5" })).toContain("целое число");
    expect(carryoverError({ ...base, visits: "-1" })).toContain("целое число");
    expect(carryoverError({ ...base, endsOn: "" })).toContain("до какого дня");
    expect(carryoverError({ ...base, endsOn: "2026-10-01" })).toBe("Окончание срока раньше начала");
    expect(carryoverError({ ...base, debt: "-5" })).toContain("Долг");
    expect(carryoverError({ ...base, debt: "50", debtDue: "" })).toContain("внести долг");
  });

  test("только персональные или только диагностики — тоже перенос", () => {
    expect(carryoverError({ ...base, visits: "0", personal: "3" })).toBeNull();
    expect(carryoverError({ ...base, visits: "", diagnostics: "1" })).toBeNull();
  });

  test("вид баланса — как выдаёт база", () => {
    expect(carryoverBalanceKind(base)).toBe("group");
    expect(carryoverBalanceKind({ visits: "5", personal: "2" })).toBe("group");
    expect(carryoverBalanceKind({ visits: "0", personal: "2" })).toBe("personal");
    expect(carryoverBalanceKind({ visits: "", personal: "" })).toBe("group");
  });
});
