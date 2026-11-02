import { describe, expect, test } from "bun:test";
import { balanceLineText, membershipBalance } from "./membership-balance";

describe("membershipBalance", () => {
  test("пакет тренировок с подарочными персональными и диагностикой", () => {
    const lines = membershipBalance(
      {
        kind: "package",
        visits_count: 8,
        personal_count: 1,
        diagnostics_count: 1,
        visits_left: 2,
        personal_left: 1,
        diagnostics_left: 0,
      },
      true,
    );
    expect(lines.map(balanceLineText)).toEqual([
      "Групповые: использовано 6 из 8, осталось 2",
      "Персональные: использовано 0 из 1, осталось 1",
      "Диагностики: использовано 1 из 1, осталось 0",
    ]);
  });

  test("пакет персональных — без групповых", () => {
    const lines = membershipBalance(
      { kind: "personal", visits_count: 0, personal_count: 10, visits_left: 0, personal_left: 3 },
      true,
    );
    expect(lines.map(balanceLineText)).toEqual(["Персональные: использовано 7 из 10, осталось 3"]);
  });

  test("остаток больше номенклатуры («Остаток из 1С», правка вручную) — только остаток", () => {
    const [l] = membershipBalance({ kind: "package", visits_count: 1, visits_left: 7 }, true);
    expect(l.used).toBeNull();
    expect(balanceLineText(l)).toBe("Групповые: осталось 7");
  });

  test("подписочный: безлимит и пакет посещений", () => {
    expect(
      balanceLineText(membershipBalance({ visits_count: null, visits_left: null }, false)[0]),
    ).toBe("Посещения: безлимит");
    expect(balanceLineText(membershipBalance({ visits_count: 12, visits_left: 4 }, false)[0])).toBe(
      "Посещения: использовано 8 из 12, осталось 4",
    );
  });
});
