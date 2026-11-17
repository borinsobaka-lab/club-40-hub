import { createFileRoute } from "@tanstack/react-router";

import { siteResponse } from "./site";

// Страницы черновика сайта Lady Stretch: /site/about, /site/training,
// /site/studios, /site/contacts (см. site.ts и src/site/layout.ts).
export const Route = createFileRoute("/site/$page")({
  server: { handlers: { GET: async ({ params }) => siteResponse(params.page) } },
});
