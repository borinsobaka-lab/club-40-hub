import { describe, expect, test } from "bun:test";

import { getTranslator } from "@/i18n/translate";
import {
  clientDisplayName,
  commentWhen,
  daysBetween,
  goalText,
  payoutIn,
  payoutMoney,
  payoutPeriodLabel,
  telegramHref,
} from "./format";
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

  test("Telegram администратора: ник, @ник, t.me и ссылка; мусор — без ссылки", () => {
    expect(telegramHref("@mariam_ls")).toBe("https://t.me/mariam_ls");
    expect(telegramHref(" mariam_ls ")).toBe("https://t.me/mariam_ls");
    expect(telegramHref("t.me/mariam_ls")).toBe("https://t.me/mariam_ls");
    expect(telegramHref("https://t.me/mariam_ls")).toBe("https://t.me/mariam_ls");
    expect(telegramHref("http://telegram.me/mariam_ls")).toBe("https://t.me/mariam_ls");
    expect(telegramHref("+995 591 00 00 00")).toBeNull();
    expect(telegramHref("javascript:alert(1)")).toBeNull();
    expect(telegramHref("")).toBeNull();
    expect(telegramHref(null)).toBeNull();
  });

  test("выплаты: период, деньги, когда выплата", () => {
    expect(payoutPeriodLabel("2026-11-11", "2026-11-25", t)).toBe("11–25 ноября");
    expect(payoutPeriodLabel("2026-10-26", "2026-11-10", t)).toBe("26 октября – 10 ноября");
    expect(payoutPeriodLabel("2026-12-26", "2027-01-10", t)).toBe("26 декабря – 10 января");
    expect(payoutMoney(240, t)).toBe("240 ₾");
    expect(payoutMoney(235.9, t)).toBe("235,9 ₾");
    expect(daysBetween("2026-11-24", "2026-11-26")).toBe(2);
    expect(payoutIn("2026-11-26", "2026-11-26", t)).toBe("сегодня");
    expect(payoutIn("2026-11-25", "2026-11-26", t)).toBe("завтра");
    expect(payoutIn("2026-11-21", "2026-11-26", t)).toBe("через 5 дней");
    expect(payoutIn("2026-11-27", "2026-11-26", t)).toBeNull();
  });
});
