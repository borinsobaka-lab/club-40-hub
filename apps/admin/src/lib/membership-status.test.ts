import { describe, expect, test } from "bun:test";

import { effectiveStatus, isLiveStatus } from "./membership-status";
import { TRAINER_ROLES, hasRating, isAdminRole, roleGroup } from "./staff-roles";

describe("статус абонемента клиента", () => {
  const today = "2026-10-13";

  test("новая продажа пакетного клуба без посещений — «Ожидает посещения»", () => {
    const m = { status: "active", starts_on_first_visit: true, started_at: null, ends_at: null };
    expect(effectiveStatus(m, today)).toBe("awaiting");
    expect(isLiveStatus(effectiveStatus(m, today))).toBe(true);
  });

  test("после первого посещения — обычный действующий, кончился срок — истёк", () => {
    const base = { status: "active", starts_on_first_visit: true, started_at: "2026-10-01" };
    expect(effectiveStatus({ ...base, ends_at: "2026-10-31" }, today)).toBe("active");
    expect(effectiveStatus({ ...base, ends_at: "2026-10-12" }, today)).toBe("expired");
  });

  test("ждущее продление, возврат и абонемент подписочного клуба", () => {
    expect(
      effectiveStatus({ status: "pending", starts_on_first_visit: true, started_at: null }, today),
    ).toBe("pending");
    expect(effectiveStatus({ status: "refunded" }, today)).toBe("refunded");
    expect(isLiveStatus("refunded")).toBe(false);
    // Без полей пакетного формата (подписочные продажи) — как раньше.
    expect(effectiveStatus({ status: "active", ends_at: null }, today)).toBe("active");
    expect(effectiveStatus({ status: null }, today)).toBe("expired");
  });
});

describe("роли сотрудников", () => {
  test("старший администратор — администратор со своей подписью и без рейтинга", () => {
    expect(isAdminRole("senior_admin")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("trainer")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(TRAINER_ROLES.senior_admin.label).toBe("Старший администратор");
    expect(hasRating("senior_admin")).toBe(false);
  });

  test("группы в списках: старший администратор — с администраторами, неизвестная — тренер", () => {
    expect(roleGroup("senior_admin")).toBe("admin");
    expect(roleGroup("masseur")).toBe("masseur");
    expect(roleGroup("trainer")).toBe("trainer");
    expect(roleGroup("boss")).toBe("trainer");
    expect(roleGroup(undefined)).toBe("trainer");
  });
});
