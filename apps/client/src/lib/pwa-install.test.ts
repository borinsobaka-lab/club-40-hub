import { describe, expect, test } from "bun:test";

import { detectIosGuide, detectPlatform, splitQuoted } from "./pwa-install";

const UA = {
  // iOS 26: версия системы заморожена на 18_6, Safari — Version/26.
  safari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  safari26_2:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1",
  safari18_6:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  safari17:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // Встроенные браузеры: Version нет.
  instagramFrozen:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0",
  instagramOld:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0",
  chromeIos26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1",
  chromeIos17:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

describe("detectPlatform", () => {
  test("iPhone — ios", () => {
    expect(detectPlatform(UA.safari26)).toBe("ios");
    expect(detectPlatform(UA.instagramFrozen)).toBe("ios");
    expect(detectPlatform(UA.chromeIos17)).toBe("ios");
  });

  test("iPad с user agent Mac'а — ios только при сенсорном экране", () => {
    expect(detectPlatform(UA.ipadDesktop, 5)).toBe("ios");
    expect(detectPlatform(UA.ipadDesktop, 0)).toBe("other");
  });

  test("Android и компьютер", () => {
    expect(detectPlatform(UA.android)).toBe("android");
    expect(detectPlatform(UA.windows)).toBe("other");
  });
});

describe("detectIosGuide", () => {
  test("Safari: по Version, а не по замороженной версии системы", () => {
    expect(detectIosGuide(UA.safari26)).toBe("ios26");
    expect(detectIosGuide(UA.safari26_2)).toBe("ios26");
    expect(detectIosGuide(UA.safari18_6)).toBe("legacy");
    expect(detectIosGuide(UA.safari17)).toBe("legacy");
  });

  test("без Version: старая система — ранние версии, 18_6 и выше — iOS 26", () => {
    expect(detectIosGuide(UA.instagramOld)).toBe("legacy");
    expect(detectIosGuide(UA.instagramFrozen)).toBe("ios26");
    expect(detectIosGuide(UA.chromeIos26)).toBe("ios26");
    expect(detectIosGuide(UA.chromeIos17)).toBe("legacy");
  });

  test("неизвестный user agent — iOS 26", () => {
    expect(detectIosGuide("")).toBe("ios26");
  });
});

describe("splitQuoted", () => {
  test("русские кавычки, в том числе вложенные", () => {
    expect(splitQuoted("Выберите «На экран „Домой“» и нажмите «Добавить»")).toEqual([
      { text: "Выберите ", quoted: false },
      { text: "«На экран „Домой“»", quoted: true },
      { text: " и нажмите ", quoted: false },
      { text: "«Добавить»", quoted: true },
    ]);
  });

  test("английские и грузинские кавычки", () => {
    expect(splitQuoted("Tap “Share”")).toEqual([
      { text: "Tap ", quoted: false },
      { text: "“Share”", quoted: true },
    ]);
    expect(splitQuoted("დააჭირეთ „Add“-ს")).toEqual([
      { text: "დააჭირეთ ", quoted: false },
      { text: "„Add“", quoted: true },
      { text: "-ს", quoted: false },
    ]);
  });

  test("без кавычек — одна часть", () => {
    expect(splitQuoted("Откройте эту ссылку в браузере Safari")).toEqual([
      { text: "Откройте эту ссылку в браузере Safari", quoted: false },
    ]);
  });
});
