import { createFileRoute } from "@tanstack/react-router";

import { buildManifest, fetchAppInstall } from "@/lib/app-install";

// Веб-манифест для установки приложения (PWA): подпись под значком и иконки
// из админки («Мобильное приложение» → «Настройки»), см. src/lib/app-install.ts.
// Собирается на лету: статичный public/manifest.webmanifest не знал бы
// настроек. Кэш короткий — Android сам перепроверяет манифест установленного
// приложения и подхватывает новую иконку и подпись.
export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(buildManifest(await fetchAppInstall())), {
          headers: {
            "content-type": "application/manifest+json; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        }),
    },
  },
});
