/*
 * Service worker клиентского приложения (регистрируется в __root.tsx, пока
 * только у пакетного). Задача — быстрый повторный запуск:
 *
 * - /assets/* (JS, CSS, шрифты, картинки сборки; имена с хэшем, не меняются)
 *   — из кэша, без сети. Новая сборка — новые имена, старые со временем
 *   вытесняются (держим последние MAX_ASSETS файлов).
 * - Страница (HTML) — из сети, как раньше: после деплоя сразу новая версия.
 *   Если сети нет или она не ответила за NAV_TIMEOUT_MS — последняя
 *   сохранённая копия этой же страницы.
 * - Иконки, манифест и прочие файлы из public/ — из кэша с обновлением фоном.
 *
 * Запросы к Supabase (другой домен) и не-GET не трогаем.
 */
const VERSION = "v1";
const ASSETS_CACHE = `base40-assets-${VERSION}`;
const PAGES_CACHE = `base40-pages-${VERSION}`;
const STATIC_CACHE = `base40-static-${VERSION}`;
const KEEP = [ASSETS_CACHE, PAGES_CACHE, STATIC_CACHE];
const MAX_ASSETS = 300;
const NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("base40-") && !KEEP.includes(n))
          .map((n) => caches.delete(n)),
      );
      // Запрос страницы стартует параллельно с запуском service worker.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }
  if (/\.(png|ico|svg|webp|webmanifest)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSETS_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trimAssets(cache);
  }
  return response;
}

async function trimAssets(cache) {
  const keys = await cache.keys();
  // keys() — в порядке добавления: удаляем самые старые.
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

function pageKey(request) {
  const url = new URL(request.url);
  url.hash = "";
  return url.toString();
}

function networkFirstPage(event) {
  const { request } = event;
  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(request));
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.includes("text/html")) {
      const cache = await caches.open(PAGES_CACHE);
      await cache.put(pageKey(request), response.clone());
    }
    return response;
  })();
  // Сохранение свежей копии не прерываем, даже если отдали сохранённую.
  event.waitUntil(network.catch(() => {}));
  return pageResponse(request, network);
}

async function pageResponse(request, network) {
  const cached = caches.open(PAGES_CACHE).then((cache) => cache.match(pageKey(request)));
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    // Сеть не ответила вовремя — сохранённая копия, если есть.
    return (await cached) || (await network);
  } catch (error) {
    const fallback = await cached;
    if (fallback) return fallback;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  return (await update) || fetch(request);
}
