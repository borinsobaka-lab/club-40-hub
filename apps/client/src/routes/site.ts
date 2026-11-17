import { createFileRoute } from "@tanstack/react-router";

import { IS_PACKAGES } from "@/lib/terms";
import { renderSitePage } from "@/site/layout";

// Черновик нового сайта Lady Stretch — для согласования дизайна с владельцем
// (2026-11-17), до выкатки на lady-stretch.one. Статичные страницы без React
// и без каркаса приложения (вход и заслон установки их не касаются): каркас и
// список страниц — src/site/layout.ts, картинки и шрифты — public/site/.
// Только у приложения Lady Stretch; закрыт от поисковиков (noindex).
// Здесь — главная (/site), остальные страницы — site.$page.ts.
export function siteResponse(key: string) {
  const html = IS_PACKAGES ? renderSitePage(key) : null;
  if (!html) return new Response("Not found", { status: 404 });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export const Route = createFileRoute("/site")({
  server: { handlers: { GET: async () => siteResponse("") } },
});
