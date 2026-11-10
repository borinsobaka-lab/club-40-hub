/**
 * Ссылки клуба на карты (studios.google_maps_url / yandex_maps_url,
 * db/migrations/2026-11-10_zzz_studio_map_links.sql): клиенты открывают их
 * кнопками «Показать на карте» в выборе студии приложения.
 */

/** Ссылка из поля → https-адрес для базы; пусто — null; не ссылка — ошибка. */
export function normalizeMapUrl(raw: string): { url: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { url: null };
  const withScheme = /^https?:\/\//i.test(v)
    ? v.replace(/^http:\/\//i, "https://")
    : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (/\s/.test(v) || !u.hostname.includes(".")) throw new Error();
    return { url: u.toString() };
  } catch {
    return { error: "Вставьте ссылку целиком, например https://maps.app.goo.gl/…" };
  }
}
