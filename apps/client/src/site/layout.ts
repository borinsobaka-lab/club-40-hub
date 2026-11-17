import finalHtml from "./final.html?raw";
import aboutHtml from "./pages/about.html?raw";
import contactsHtml from "./pages/contacts.html?raw";
import homeHtml from "./pages/home.html?raw";
import studiosHtml from "./pages/studios.html?raw";
import trainingHtml from "./pages/training.html?raw";
import script from "./script.js?raw";
import styles from "./styles.css?raw";

/**
 * Черновик нового сайта Lady Stretch (на согласовании у владельца,
 * 2026-11-17): статичные страницы в стилистике приложения, без React.
 * Здесь — общий каркас (шапка, меню, подвал, стили и скрипт) и список
 * страниц; содержимое страниц — `pages/*.html`, картинки и шрифты —
 * `public/site/`. Отдают роуты `routes/site.ts` и `routes/site.$page.ts`.
 */
type SitePage = { title: string; description: string; body: string; preload?: string };

const BRAND = "Lady Stretch";

const PAGES: Record<string, SitePage> = {
  "": {
    title: `${BRAND} — студии растяжки для девушек в Тбилиси`,
    description:
      "Lady Stretch — студии растяжки и аэростретчинга в Тбилиси. Группы до 8 человек, шесть направлений, три студии в Ваке и Сабуртало. Пробное занятие — 14 ₾.",
    body: homeHtml,
    preload: "/site/img/hero-neon.webp",
  },
  about: {
    title: `О нас — ${BRAND}`,
    description:
      "История Lady Stretch в Тбилиси: от первой студии в Ваке до сообщества девушек, которых объединяет любовь к движению и заботе о себе.",
    body: aboutHtml,
  },
  training: {
    title: `Тренировки — ${BRAND}`,
    description:
      "Шесть направлений Lady Stretch: классическая растяжка, аэростретчинг, растяжка с подкачкой, здоровая спина, roll-стретчинг и пилатес. Мини-группы, каждый день с 9:00 до 21:00.",
    body: trainingHtml,
  },
  studios: {
    title: `Наши студии — ${BRAND}`,
    description:
      "Три студии Lady Stretch в Тбилиси: проспект Чавчавадзе, 51 и улица Палиашвили, 11а в Ваке, улица Нуцубидзе, 125а в Сабуртало.",
    body: studiosHtml,
  },
  contacts: {
    title: `Контакты — ${BRAND}`,
    description:
      "Контакты Lady Stretch в Тбилиси: телефон, WhatsApp, Messenger, Instagram, адреса студий, сотрудничество и работа в студии.",
    body: contactsHtml,
  },
};

const NAV = [
  { href: "/site/about", label: "О нас", key: "about" },
  { href: "/site/training", label: "Тренировки", key: "training" },
  { href: "/site/studios", label: "Студии", key: "studios" },
  { href: "/site#app", label: "Приложение", key: "app" },
  { href: "/site/contacts", label: "Контакты", key: "contacts" },
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Готовая страница сайта или null, если такой нет. */
export function renderSitePage(key: string): string | null {
  const page = Object.hasOwn(PAGES, key) ? PAGES[key] : undefined;
  if (!page) return null;

  const links = (cls: string) =>
    NAV.map(
      (n) =>
        `<a${cls ? ` class="${cls}"` : ""} href="${n.href}"${n.key === key ? ' aria-current="page"' : ""}>${n.label}</a>`,
    ).join("");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2A2B2F">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:image" content="https://app.lady-stretch.one/site/img/hero-aero.webp">
<link rel="icon" href="/favicon.ico">
<link rel="preload" href="/site/fonts/roboto-cyrillic-600-normal.woff2" as="font" type="font/woff2" crossorigin>
${page.preload ? `<link rel="preload" href="${page.preload}" as="image">` : ""}
<style>${styles}</style>
</head>
<body>
<a class="skip" href="#top">К содержанию</a>
<header class="nav" id="nav">
  <div class="wrap">
    <div class="nav-in">
      <a href="/site" class="logo" aria-label="${BRAND}"></a>
      <nav class="nav-links" aria-label="Разделы">${links("")}</nav>
      <div class="lang" id="lang">
        <button class="lang-btn" aria-haspopup="true" aria-expanded="false">Рус
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="lang-menu">
          <button>English</button>
          <button>ქართული</button>
          <button aria-current="true">Русский</button>
        </div>
      </div>
      <a class="btn btn-brand" href="/site#trial">Пробное занятие</a>
      <button class="burger" id="burger" aria-label="Меню" aria-expanded="false" aria-controls="mmenu"><span></span></button>
    </div>
  </div>
</header>
<div class="mmenu" id="mmenu">
  ${links("m")}
  <a class="btn btn-brand btn-lg" href="/site#trial">Записаться на пробное</a>
</div>
<main id="top" tabindex="-1">
${page.body.replace("<!--FINAL-->", finalHtml)}
</main>
<div class="mbar" id="mbar"><a class="btn btn-brand" href="/site#trial">Записаться на пробное — 14 ₾</a></div>
<script>${script}</script>
</body>
</html>
`;
}
