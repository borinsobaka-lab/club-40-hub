import { describe, expect, test } from "bun:test";

import {
  clientLines,
  excelDate,
  isCurrentMembership,
  membershipLines,
  type ExportMembershipRow,
} from "./export-memberships";

// Выдуманные клиенты (настоящих данных в репозитории нет).
const TODAY = "2026-11-15";
const club = (id: string) => (id === "s1" ? "Ваке" : "Сабуртало");

function row(p: Partial<ExportMembershipRow> & { client: string }): ExportMembershipRow {
  const { client, ...rest } = p;
  return {
    id: Math.random().toString(36),
    studio_id: "s1",
    status: "active",
    started_at: "2026-10-01",
    ends_at: "2026-12-01",
    visits_left: 5,
    personal_left: null,
    diagnostics_left: null,
    starts_on_first_visit: false,
    created_at: "2026-10-01T10:00:00Z",
    clients: {
      id: client,
      full_name: null,
      first_name: client,
      last_name: "Тестова",
      email: ` ${client.toUpperCase()}@Example.com `,
      phone: "+995555000001",
      phone2: null,
    },
    memberships: { name: "8 занятий", kind: "package" },
    ...rest,
  };
}

describe("isCurrentMembership", () => {
  test("действует, заморожен, ждёт — текущие", () => {
    for (const status of ["active", "frozen", "pending"])
      expect(isCurrentMembership(row({ client: "a", status }), TODAY)).toBe(true);
  });
  test("ждёт первого посещения — текущий", () => {
    const r = row({ client: "a", starts_on_first_visit: true, started_at: null, ends_at: null });
    expect(isCurrentMembership(r, TODAY)).toBe(true);
  });
  test("active с прошедшим сроком, истёк, заменён, возврат — нет", () => {
    expect(isCurrentMembership(row({ client: "a", ends_at: "2026-11-14" }), TODAY)).toBe(false);
    for (const status of ["expired", "replaced", "refunded", "cancelled"])
      expect(isCurrentMembership(row({ client: "a", status }), TODAY)).toBe(false);
  });
});

describe("membershipLines", () => {
  test("почта в нижнем регистре без пробелов, статус и тип подписью", () => {
    const [l] = membershipLines([row({ client: "anna", ends_at: "2026-11-01" })], club, TODAY);
    expect(l.client).toBe("Тестова anna");
    expect(l.email).toBe("anna@example.com");
    expect(l.status).toBe("Истёк");
    expect(l.current).toBe(false);
    expect(l.kind).toBe("Пакет тренировок");
    expect(l.club).toBe("Ваке");
  });
  test("строка без карточки клиента пропускается", () => {
    expect(membershipLines([{ ...row({ client: "a" }), clients: null }], club, TODAY)).toEqual([]);
  });
});

describe("clientLines", () => {
  test("клиент с истёкшим и новым — есть действующий", () => {
    const lines = clientLines(
      [
        row({ client: "a", status: "expired", ends_at: "2026-09-01" }),
        row({ client: "a", studio_id: "s2", ends_at: "2026-12-10" }),
      ],
      club,
      TODAY,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].hasCurrent).toBe(true);
    expect(lines[0].currentEndsAt).toBe("2026-12-10");
    expect(lines[0].lastEndedAt).toBe("2026-09-01");
    expect(lines[0].clubs).toBe("Ваке, Сабуртало");
    expect(lines[0].total).toBe(2);
  });
  test("только закончившиеся — последний по сроку", () => {
    const [l] = clientLines(
      [
        row({ client: "b", status: "expired", ends_at: "2026-08-01" }),
        row({ client: "b", status: "expired", ends_at: "2026-10-20" }),
      ],
      club,
      TODAY,
    );
    expect(l.hasCurrent).toBe(false);
    expect(l.current).toBe("");
    expect(l.lastEndedAt).toBe("2026-10-20");
  });
});

test("excelDate — полночь UTC", () => {
  expect(excelDate("2026-11-15")?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
  expect(excelDate(null)).toBeNull();
});
