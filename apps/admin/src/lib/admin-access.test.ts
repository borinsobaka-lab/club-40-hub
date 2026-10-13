import { describe, expect, test } from "bun:test";

import {
  canOpenClubSection,
  canOpenRail,
  dashboardStudioIds,
  type AdminAccess,
} from "./admin-access";
import { canOpenPath, firstAllowedUrl, railSectionKey } from "./nav-sections";

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
    expect(canOpenPath(limited, A, "/pay-rates")).toBe(false);
    expect(canOpenPath(limited, A, "/news")).toBe(true);
    expect(canOpenPath(limited, A, "/push-triggers")).toBe(true);
    // Студия без доступа — ни одного раздела клуба.
    expect(canOpenClubSection(limited, "other", "schedule")).toBe(false);
  });

  test("номенклатуры обоих форматов — один раздел прав", () => {
    const memberships: AdminAccess = {
      ...limited,
      studios: { [A]: { owner: false, sections: ["memberships"] } },
    };
    expect(canOpenPath(memberships, A, "/memberships")).toBe(true);
    expect(canOpenPath(memberships, A, "/packages")).toBe(true);
    expect(canOpenPath(limited, A, "/packages")).toBe(false);
  });

  test("первая доступная страница", () => {
    expect(firstAllowedUrl(limited, A)).toBe("/schedule");
    expect(firstAllowedUrl(limited, B)).toBe("/cash");
    expect(firstAllowedUrl({ ...limited, rail: ["app"] }, A)).toBe("/news");
  });

  test("«Сотрудники» — в меню клуба, право — раздел рейки, от клуба не зависит", () => {
    for (const path of ["/trainers", "/payroll", "/admin-shifts", "/pay-rates"])
      expect(railSectionKey(path)).toBe("club");
    const staff: AdminAccess = { ...limited, rail: ["staff"] };
    expect(canOpenPath(staff, A, "/payroll")).toBe(true);
    expect(canOpenPath(staff, B, "/admin-shifts")).toBe(true);
    expect(canOpenPath(staff, A, "/schedule")).toBe(false);
    expect(firstAllowedUrl(staff, A)).toBe("/trainers");
    expect(canOpenPath(limited, A, "/payroll")).toBe(false);
  });

  test("«Скрипты LS» — по отметке раздела рейки, со всеми страницами", () => {
    expect(canOpenPath(legacy, A, "/scripts")).toBe(true);
    expect(canOpenPath(limited, A, "/scripts")).toBe(false);
    expect(canOpenPath(limited, A, "/scripts/settings")).toBe(false);
    const scripts: AdminAccess = { ...limited, rail: ["scripts"] };
    expect(canOpenPath(scripts, A, "/scripts/0f0e0d0c-0000-0000-0000-000000000000")).toBe(true);
    expect(canOpenPath(scripts, A, "/dashboard")).toBe(false);
    expect(firstAllowedUrl(scripts, A)).toBe("/scripts");
  });

  test("владельцу открыто всё в своей студии и «Доступы»", () => {
    expect(canOpenPath(owner, A, "/dashboard")).toBe(true);
    expect(canOpenPath(owner, A, "/trainers")).toBe(true);
    expect(canOpenPath(owner, A, "/pay-rates")).toBe(true);
    expect(canOpenPath(owner, A, "/employees")).toBe(true);
    expect(canOpenPath(owner, A, "/scripts")).toBe(true);
  });

  test("дашборд над студиями — только студии, где он открыт", () => {
    expect(dashboardStudioIds(legacy)).toEqual([A]);
    expect(dashboardStudioIds(limited)).toEqual([]);
    expect(dashboardStudioIds(owner)).toEqual([A]);
    const mixed: AdminAccess = {
      isOwner: false,
      rail: ["club"],
      studios: {
        [A]: { owner: false, sections: ["dashboard"] },
        [B]: { owner: false, sections: ["cash"] },
      },
    };
    expect(dashboardStudioIds(mixed)).toEqual([A]);
    // Раздел рейки открыт из любой студии — от активной не зависит.
    expect(canOpenPath(mixed, B, "/dashboard")).toBe(true);
    expect(firstAllowedUrl(mixed, B)).toBe("/cash");
    expect(firstAllowedUrl({ ...mixed, studios: { [A]: mixed.studios[A] } }, A)).toBe("/dashboard");
    // Без «Клуба» в рейке дашборд закрыт, как и разделы студий.
    expect(canOpenPath({ ...mixed, rail: ["app"] }, A, "/dashboard")).toBe(false);
  });
});
