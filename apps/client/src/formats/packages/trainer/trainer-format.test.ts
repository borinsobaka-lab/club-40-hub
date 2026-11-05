import { describe, expect, test } from "bun:test";

import { getTranslator } from "@/i18n/translate";
import { clientDisplayName, commentWhen, goalText } from "./format";
import { healthRestrictions } from "./profile-labels";

const t = getTranslator("ru");

describe("тренер: подписи", () => {
  test("ограничения: «Ничего из перечисленного» не в счёт, комментарий — в счёт", () => {
    expect(healthRestrictions(["none"], null).any).toBe(false);
    expect(healthRestrictions(["none"], "  ").any).toBe(false);
    expect(healthRestrictions(["back_joints", "none"], null)).toEqual({
      flags: ["back_joints"],
      notes: null,
      any: true,
    });
    expect(healthRestrictions([], " Грыжа ").notes).toBe("Грыжа");
  });

  test("цель: «Другое» — с текстом клиента", () => {
    expect(goalText("flexibility", null, t)).toBe("Стать гибче");
    expect(goalText("other", "Шпагат", t)).toBe("Другое: Шпагат");
    expect(goalText(null, null, t)).toBeNull();
  });

  test("имя: «Имя Фамилия», без них — полное имя", () => {
    expect(clientDisplayName({ first_name: "Анна", last_name: "Тестова", full_name: null })).toBe(
      "Анна Тестова",
    );
    expect(
      clientDisplayName({ first_name: null, last_name: null, full_name: "Тестова Анна" }),
    ).toBe("Тестова Анна");
  });

  test("когда оставлен комментарий: сегодня, вчера, дата", () => {
    const now = new Date(2026, 10, 5, 18, 0);
    expect(commentWhen(new Date(2026, 10, 5, 14, 5).toISOString(), t, now)).toMatch(
      /^сегодня 14:05/,
    );
    expect(commentWhen(new Date(2026, 10, 4, 9, 30).toISOString(), t, now)).toMatch(/^вчера 09:30/);
    expect(commentWhen(new Date(2026, 9, 12, 9, 30).toISOString(), t, now)).toContain("12");
  });
});
