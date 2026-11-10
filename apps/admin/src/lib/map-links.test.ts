import { expect, test } from "bun:test";

import { normalizeMapUrl } from "./map-links";

test("ссылка на карты: https, пусто, без схемы, мусор", () => {
  expect(normalizeMapUrl("")).toEqual({ url: null });
  expect(normalizeMapUrl(" https://maps.app.goo.gl/AbC123 ")).toEqual({
    url: "https://maps.app.goo.gl/AbC123",
  });
  expect(normalizeMapUrl("yandex.ru/maps/-/CDabc")).toEqual({
    url: "https://yandex.ru/maps/-/CDabc",
  });
  expect(normalizeMapUrl("http://yandex.com/maps/org/1")).toEqual({
    url: "https://yandex.com/maps/org/1",
  });
  expect(normalizeMapUrl("Палиашвили 11а")).toHaveProperty("error");
});
