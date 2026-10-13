import { describe, expect, test } from "bun:test";

import { catalogStudioIds, isSharedCatalog, type CatalogStudio } from "./studio-catalog";

const studios: CatalogStudio[] = [
  { id: "vake", format: "packages" },
  { id: "base40", format: "subscription" },
  { id: "saburtalo", format: "packages" },
  { id: "other-sub", format: "subscription" },
];

describe("catalogStudioIds", () => {
  test("пакетный клуб — каталог всех пакетных клубов", () => {
    expect(catalogStudioIds(studios, "vake")).toEqual(["vake", "saburtalo"]);
    expect(catalogStudioIds(studios, "saburtalo")).toEqual(["vake", "saburtalo"]);
  });

  test("подписочный клуб — только свой каталог", () => {
    expect(catalogStudioIds(studios, "base40")).toEqual(["base40"]);
  });

  test("клуб не найден в списке — только он сам", () => {
    expect(catalogStudioIds(studios, "new")).toEqual(["new"]);
    expect(catalogStudioIds([], "vake")).toEqual(["vake"]);
  });

  test("isSharedCatalog", () => {
    expect(isSharedCatalog("packages")).toBe(true);
    expect(isSharedCatalog("subscription")).toBe(false);
    expect(isSharedCatalog(undefined)).toBe(false);
  });
});
