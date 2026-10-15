/**
 * Установка приложения на телефон (PWA). Без установки приложение не
 * открывается (решение владельца 2026-10-15): в браузере вместо него —
 * инструкция по установке (components/install-screen.tsx, заслон —
 * InstallGate в __root.tsx). Здесь — чистая логика без запросов к базе и
 * без React: тесты рядом (pwa-install.test.ts).
 */

export type InstallPlatform = "ios" | "android" | "other";

/** Инструкция для iPhone: в iOS 26 путь к «На экран „Домой“» другой. */
export type IosGuide = "ios26" | "legacy";

/** Устройство по user agent: iPhone/iPad, Android или прочее (компьютер). */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  // iPad (iPadOS 13+) в Safari выдаёт себя за Mac — отличает сенсорный экран.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

/**
 * Какую вкладку инструкции для iPhone открыть первой. Safari пишет свою
 * версию (Version/26.0) — она совпадает с версией iOS; версия системы в
 * user agent с iOS 26 заморожена на 18_6…18_7. У встроенных браузеров
 * (Instagram, Telegram и т.п.) Version нет, а «18_6» и выше может быть и
 * iOS 26 — тогда новая инструкция: старых систем всё меньше, а вкладку
 * клиент переключит сам.
 */
export function detectIosGuide(userAgent: string): IosGuide {
  const safari = /Version\/(\d+)/.exec(userAgent);
  if (safari) return Number(safari[1]) >= 26 ? "ios26" : "legacy";
  const os = /OS (\d+)[_.](\d+)/.exec(userAgent);
  if (os) {
    const major = Number(os[1]);
    const minor = Number(os[2]);
    if (major < 18 || (major === 18 && minor < 6)) return "legacy";
  }
  return "ios26";
}

/**
 * Открыто ли приложение установленным (с экрана «Домой»), а не во вкладке
 * браузера. iOS — navigator.standalone и display-mode; Android — display-mode
 * установленного приложения (манифест: display "standalone").
 */
export function isInstalledDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  if (document.referrer.startsWith("android-app://")) return true;
  return INSTALLED_DISPLAY_MODES.some(
    (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true,
  );
}

export const INSTALLED_DISPLAY_MODES = [
  "standalone",
  "fullscreen",
  "minimal-ui",
  "window-controls-overlay",
] as const;

/**
 * Настоящий Chrome на Android — только в нём показываем кнопку установки в
 * одно нажатие (решение владельца 2026-10-15: кнопка, которая не работает,
 * хуже, чем её отсутствие). Остальные браузеры на Chromium тоже шлют
 * beforeinstallprompt, но ведут себя по-разному: у Samsung Internet 27.x
 * событие то не приходит, то окно установки возвращает пустой ответ. Их
 * user agent содержит Chrome/ — отсекаем по своим меткам; встроенные
 * браузеры приложений (WebView: «; wv)», Version/4.0) — тоже.
 */
export function isAndroidChrome(userAgent: string): boolean {
  if (!/Android/.test(userAgent) || !/Chrome\/\d+/.test(userAgent)) return false;
  return !OTHER_ANDROID_BROWSERS.test(userAgent);
}

const OTHER_ANDROID_BROWSERS = new RegExp(
  [
    "; wv\\)",
    "Version\\/\\d",
    "SamsungBrowser",
    "EdgA",
    "OPR\\/",
    "Opera",
    "OPT\\/",
    "YaBrowser",
    "YaApp",
    "YaSearch",
    "MiuiBrowser",
    "XiaoMi",
    "HuaweiBrowser",
    "HONORBrowser",
    "HeyTapBrowser",
    "OppoBrowser",
    "VivoBrowser",
    "UCBrowser",
    "QQBrowser",
    "baiduboxapp",
    "DuckDuckGo",
    "Puffin",
    "Silk",
    "GSA\\/",
    "Instagram",
    "FBAN",
    "FBAV",
    "FB_IAB",
    "Telegram",
    "Line\\/",
    "Snapchat",
    "musical_ly",
    "Bytedance",
    "Pinterest",
    "Twitter",
    "LinkedInApp",
    "Viber",
    "WhatsApp",
    "VKAndroidApp",
    "vkclient",
    "OKApp",
  ].join("|"),
);

/** Часть текста шага: обычный текст, название кнопки в кавычках или браузер. */
export type StepTextPart = { text: string; kind: "plain" | "quoted" | "browser" };

/**
 * Текст шага инструкции по частям: названия кнопок в кавычках («Поделиться»,
 * “Share”, „Share“; вложенные — «На экран „Домой“» — остаются одной частью)
 * и названия браузеров (Safari, Chrome) — на экране жирные, у браузера ещё
 * и его значок.
 */
export function splitStepText(text: string): StepTextPart[] {
  const parts: StepTextPart[] = [];
  const re = /«[^»]+»|“[^”]+”|„[^“”]+[“”]|\b(?:Safari|Chrome)\b/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), kind: "plain" });
    const quoted = /^[«“„]/.test(m[0]);
    parts.push({ text: m[0], kind: quoted ? "quoted" : "browser" });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), kind: "plain" });
  return parts;
}
