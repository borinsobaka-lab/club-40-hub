import { createFileRoute } from "@tanstack/react-router";

import { IS_PACKAGES } from "@/lib/terms";
import homeHtml from "@/site/home.html?raw";

// Черновик нового сайта Lady Stretch (главная) — для согласования дизайна с
// владельцем (2026-11-17), до выкатки на lady-stretch.one. Одна статичная
// страница без React и без каркаса приложения (вход, заслон установки её не
// касаются): вёрстка — src/site/home.html, картинки и шрифты — public/site/.
// Только у приложения Lady Stretch; закрыта от поисковиков (noindex).
export const Route = createFileRoute("/site")({
  server: {
    handlers: {
      GET: async () => {
        if (!IS_PACKAGES) return new Response("Not found", { status: 404 });
        return new Response(homeHtml, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
            "x-robots-tag": "noindex, nofollow",
          },
        });
      },
    },
  },
});
