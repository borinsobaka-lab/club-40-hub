import { describe, expect, test } from "bun:test";

import { canOpenClubSection, canOpenRail, type AdminAccess } from "./admin-access";
import { canOpenPath, firstAllowedUrl } from "./nav-sections";

const A = "studio-a";
const B = "studio-b";

/** Сотрудник, заведённый до настройки разделов: строк прав нет. */
const legacy: AdminAccess = {
  isOwner: false,
  rail: null,
  studios: { [A]: { owner: false, sections: null } },
};

const limited: AdminAccess = {
  isOwner: false,
  rail: ["club", "app"],
  studios: {
    [A]: { owner: false, sections: ["schedule", "clients"] },
    [B]: { owner: false, sections: ["cash"] },
  },
};

const owner: AdminAccess = {
  isOwner: true,
  rail: ["club"],
  studios: { [A]: { owner: true, sections: ["cash"] } },
};

describe("права в админке", () => {
  test("без строк прав открыто всё, кроме «Доступов»", () => {
    expect(canOpenRail(legacy, "staff")).toBe(true);
    expect(canOpenPath(legacy, A, "/dashboard")).toBe(true);
    expect(canOpenPath(legacy, A, "/trainers")).toBe(true);
    expect(canOpenPath(legacy, A, "/employees")).toBe(false);
  });

  test("разделы рейки и клуба — по отметкам, по каждой студии", () => {
    expect(canOpenPath(limited, A, "/schedule")).toBe(true);
    expect(canOpenPath(limited, A, "/dashboard")).toBe(false);
    expect(canOpenPath(limited, B, "/schedule")).toBe(false);
    expect(canOpenPath(limited, B, "/cash")).toBe(true);
    expect(canOpenPath(limited, A, "/trainers")).toBe(false);
    expect(canOpenPath(limited, A, "/news")).toBe(true);
    expect(canOpenPath(limited, A, "/push-triggers")).toBe(true);
    // Студия без доступа — ни одного раздела клуба.
    expect(canOpenClubSection(limited, "other", "schedule")).toBe(false);
  });

  test("первая доступная страница", () => {
    expect(firstAllowedUrl(limited, A)).toBe("/schedule");
    expect(firstAllowedUrl(limited, B)).toBe("/cash");
    expect(firstAllowedUrl({ ...limited, rail: ["app"] }, A)).toBe("/news");
  });

  test("владельцу открыто всё в своей студии и «Доступы»", () => {
    expect(canOpenPath(owner, A, "/dashboard")).toBe(true);
    expect(canOpenPath(owner, A, "/trainers")).toBe(true);
    expect(canOpenPath(owner, A, "/employees")).toBe(true);
  });
});
