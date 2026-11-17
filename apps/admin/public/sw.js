/*
 * Service worker админки — ради установки как приложения (PWA) и страницы
 * «нет сети». Приложение он НЕ кэширует: скрипты, стили и запросы к Supabase
 * идут в сеть как обычно, поэтому после выкладки сразу открывается свежая
 * версия. Перехватываются только переходы по страницам: нет сети — отдаём
 * offline.html из кэша. Меняя offline.html, подними VERSION.
 *
 * Ещё — уведомления сотрудникам CRM (срок задачи, клиент ждёт ответа,
 * назначена сделка): сервер шлёт Web Push {t — заголовок, b — текст, u — путь
 * в админке, n — id}; нажатие открывает сделку или диалог.
 */
const VERSION = "v2";
const CACHE = `offline-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { b: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.t || "Base40", {
      body: data.b || "",
      tag: data.n || undefined,
      icon: "/icon-192.png",
      data: { u: data.u || "/crm" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.u) || "/crm";
  // Только свой адрес: путь админки, не чужая ссылка.
  const url = new URL(path.startsWith("/") ? path : "/crm", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => "focus" in w);
      if (!open) return self.clients.openWindow(url);
      // navigate доступен только для вкладок под управлением этого воркера.
      return open
        .navigate(url)
        .then((w) => (w || open).focus())
        .catch(() => self.clients.openWindow(url));
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription && event.oldSubscription.options;
  if (!options || !options.applicationServerKey) return;
  // Новую подписку в базу запишет админка при следующем открытии CRM.
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: options.applicationServerKey })
      .catch(() => {}),
  );
});
