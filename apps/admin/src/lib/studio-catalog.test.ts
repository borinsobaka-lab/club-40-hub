import { describe, expect, test } from "bun:test";

import {
  catalogStudioIds,
  networkStudioIds,
  sameNetwork,
  type CatalogStudio,
} from "./studio-catalog";

const studios: CatalogStudio[] = [
  { id: "vake", format: "packages" },
  { id: "saburtalo", format: "packages" },
];

describe("catalogStudioIds", () => {
  test("каталог — все клубы сети", () => {
    expect(catalogStudioIds(studios, "vake")).toEqual(["vake", "saburtalo"]);
    expect(catalogStudioIds(studios, "saburtalo")).toEqual(["vake", "saburtalo"]);
  });

  test("клуб не найден в списке — только он сам", () => {
    expect(catalogStudioIds(studios, "new")).toEqual(["new"]);
    expect(catalogStudioIds([], "vake")).toEqual(["vake"]);
  });
});

describe("networkStudioIds / sameNetwork", () => {
  test("клубы сети — одна база клиентов", () => {
    expect(networkStudioIds(studios, "vake")).toEqual(["vake", "saburtalo"]);
    expect(sameNetwork(studios, "vake", "saburtalo")).toBe(true);
    expect(sameNetwork(studios, "saburtalo", "vake")).toBe(true);
  });

  test("клуб не найден — только он сам", () => {
    expect(networkStudioIds(studios, "new")).toEqual(["new"]);
    expect(sameNetwork(studios, "new", "vake")).toBe(false);
    expect(sameNetwork([], "vake", "vake")).toBe(true);
  });
});
