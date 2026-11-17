import { describe, expect, test } from "bun:test";

import {
  clubsLabel,
  defaultClubId,
  resolveClubIds,
  toggleAll,
  toggleClub,
  type ClubLite,
} from "./dashboard-clubs";

const clubs: ClubLite[] = [
  { id: "a", name: "Ваке" },
  { id: "b", name: "Сабуртало" },
  { id: "c", name: "Глдани" },
];

describe("клуб по умолчанию", () => {
  test("клуб из шапки, а без доступа к нему — первый", () => {
    expect(defaultClubId(clubs, "c")).toBe("c");
    expect(defaultClubId(clubs, "чужой")).toBe("a");
    expect(defaultClubId([], "a")).toBeNull();
  });

  test("без выбора — клуб из шапки", () => {
    expect(resolveClubIds(clubs, "b", null)).toEqual(["b"]);
  });

  test("недоступные отбрасываются, порядок — как в списке клубов", () => {
    expect(resolveClubIds(clubs, "b", ["x", "c", "a"])).toEqual(["a", "c"]);
    expect(resolveClubIds(clubs, "b", ["x"])).toEqual(["b"]);
  });
});

describe("выбор клубов", () => {
  test("клуб добавляется к выбору", () => {
    expect(toggleClub(clubs, ["a"], "c")).toEqual(["a", "c"]);
  });

  test("снять можно любой, кроме последнего", () => {
    expect(toggleClub(clubs, ["a", "c"], "a")).toEqual(["c"]);
    expect(toggleClub(clubs, ["c"], "c")).toEqual(["c"]);
  });

  test("все клубы и обратно — один", () => {
    expect(toggleAll(clubs, ["b"], "b")).toEqual(["a", "b", "c"]);
    expect(toggleAll(clubs, ["a", "b", "c"], "b")).toEqual(["b"]);
    expect(toggleAll(clubs, ["a", "b", "c"], "x")).toEqual(["a"]);
  });

  test("подпись поля", () => {
    expect(clubsLabel(clubs, ["b"])).toBe("Сабуртало");
    expect(clubsLabel(clubs, ["a", "b", "c"])).toBe("Все клубы");
    expect(clubsLabel(clubs, ["a", "c"])).toBe("2 клуба");
  });
});
