import { describe, expect, test } from "bun:test";

import {
  carryoverChunks,
  parseCarryoverSheet,
  parseImportPhone,
  splitName,
  summarizeCarryover,
} from "./import-carryover";

// Выдуманные строки в формате выгрузки купленной студии (настоящих данных
// клиентов в репозитории нет).
const HEADER = [
  "Создание",
  "Номер",
  "Клиент",
  "Номер телефона",
  "Абонемент",
  "Группа",
  "Действующий",
  "Стоимость",
  "Скидка",
  "Итоговая цена",
  "Оплачено",
  "Долг",
  "Возврат",
  "Начало",
  "Дней",
  "Окончание",
  "Занятий",
  "Использовано занятий",
  "Осталось занятий",
  "Подарочных занятий",
  "Филиал",
  "Примечание",
];
const d = (s: string) => new Date(`${s}T00:00:00Z`);

function line(p: {
  ref: number;
  name: string;
  phone: string;
  left: number;
  starts?: string;
  ends?: string;
  debt?: number | null;
  active?: string;
  note?: string | null;
}) {
  return [
    d("2026-10-30"),
    p.ref,
    p.name,
    p.phone,
    "12 занятий",
    null,
    p.active ?? "да",
    307,
    31,
    276,
    276 - (p.debt ?? 0),
    p.debt ?? null,
    null,
    d(p.starts ?? "2026-10-30"),
    42,
    d(p.ends ?? "2026-12-10"),
    12,
    12 - p.left,
    p.left,
    null,
    "Тбилиси",
    p.note ?? null,
  ];
}

describe("телефон из выгрузки", () => {
  test("код страны без «+», скобки и пробелы", () => {
    expect(parseImportPhone("995 (59) 956 0575")).toBe("+995599560575");
    expect(parseImportPhone(" 995 (55) 719 0055")).toBe("+995557190055");
    expect(parseImportPhone("7 (916) 609 3835")).toBe("+79166093835");
    expect(parseImportPhone("+995 599 12 34 56")).toBe("+995599123456");
    expect(parseImportPhone("599 12 34 56")).toBe("+995599123456");
  });
  test("пусто и мусор — null", () => {
    expect(parseImportPhone("")).toBeNull();
    expect(parseImportPhone("123")).toBeNull();
  });
});

test("имя: фамилия — первое слово", () => {
  expect(splitName("Тестова Анна")).toEqual({ last_name: "Тестова", first_name: "Анна" });
  expect(splitName("  Doe  Jane Mary ")).toEqual({ last_name: "Doe", first_name: "Jane Mary" });
  expect(splitName("Мононим")).toEqual({ last_name: "Мононим", first_name: "" });
});

describe("разбор выгрузки", () => {
  const sheet = [
    HEADER,
    line({ ref: 101, name: "Тестова Анна", phone: "995 (59) 100 0001", left: 11 }),
    line({
      ref: 102,
      name: "Пример Мария",
      phone: "12-34",
      left: 5,
      debt: 141,
      note: "скидка 5",
    }),
    line({ ref: 103, name: "Старая Ольга", phone: "995 (59) 100 0003", left: 0 }),
    line({ ref: 104, name: "Ушедшая Вера", phone: "995 (59) 100 0004", left: 3, active: "нет" }),
    line({
      ref: 105,
      name: "Прошлая Ира",
      phone: "995 (59) 100 0005",
      left: 2,
      ends: "2026-11-05",
    }),
    line({ ref: 101, name: "Дубль Анна", phone: "995 (59) 100 0001", left: 4 }),
    [null, null, null, null],
  ];
  const { rows, problems } = parseCarryoverSheet(sheet);

  test("переносятся действующие с остатком; срок прошёл — как есть", () => {
    expect(rows.map((r) => r.ref)).toEqual(["101", "102", "105"]);
    expect(rows[0]).toMatchObject({
      last_name: "Тестова",
      first_name: "Анна",
      phone: "+995591000001",
      registered_on: "2026-10-30",
      visits: 11,
      starts_on: "2026-10-30",
      ends_on: "2026-12-10",
      debt: 0,
    });
    expect(rows[1].debt).toBe(141);
    expect(rows[1].comment).toBe(
      "Перенос из прежней студии: «12 занятий» № 102, оплачено 135 ₾ из 276 ₾, долг 141 ₾. скидка 5",
    );
  });

  test("неразобранный телефон — без телефона; пропущенные — с причиной", () => {
    expect(rows[1].phone).toBeNull();
    expect(problems).toEqual([
      expect.objectContaining({ name: "Пример Мария", skipped: false }),
      expect.objectContaining({ name: "Старая Ольга", text: "нет остатка занятий", skipped: true }),
      expect.objectContaining({ name: "Ушедшая Вера", skipped: true }),
      expect.objectContaining({ name: "Дубль Анна", text: "номер 101 повторяется", skipped: true }),
    ]);
  });

  test("сводка и пачки", () => {
    expect(summarizeCarryover(rows, "2026-11-10")).toEqual({
      rows: 3,
      visits: 18,
      withDebt: 1,
      debtTotal: 141,
      expired: 1,
      withoutPhone: 1,
    });
    const chunks = carryoverChunks(
      rows,
      { studioId: "s", membershipId: "m", debtDue: "2026-11-29" },
      2,
    );
    expect(chunks.map((c) => c.rows.length)).toEqual([2, 1]);
    expect(chunks[0]).toMatchObject({ studio_id: "s", membership_id: "m", debt_due: "2026-11-29" });
    expect(Object.keys(chunks[0].rows[0])).not.toContain("phoneRaw");
  });

  test("нет нужных колонок — понятная ошибка", () => {
    expect(() => parseCarryoverSheet([["Клиент", "Осталось занятий"]])).toThrow("«Номер»");
    expect(() => parseCarryoverSheet([["что-то"]])).toThrow("заголовков");
  });
});
