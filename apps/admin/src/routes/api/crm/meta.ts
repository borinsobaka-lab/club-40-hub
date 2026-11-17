import { createFileRoute } from "@tanstack/react-router";

import { hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { handleMetaWebhook } from "@/lib/crm/channels.server";
import { metaConfigured, metaSignatureValid } from "@/lib/crm/meta.server";

// Вебхук приложения Meta — один на WhatsApp, Messenger и Instagram (CRM.md).
// GET — проверка адреса при настройке в кабинете разработчика (токен
// META_VERIFY_TOKEN), POST — события; тело принимается только с верной
// подписью X-Hub-Signature-256 (секрет приложения META_APP_SECRET).
const MAX_BODY_BYTES = 1024 * 1024;

export const Route = createFileRoute("/api/crm/meta")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = process.env.META_VERIFY_TOKEN;
        if (
          token &&
          url.searchParams.get("hub.mode") === "subscribe" &&
          url.searchParams.get("hub.verify_token") === token
        )
          return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
        return new Response("forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        if (!hasSupabaseAdmin() || !metaConfigured())
          return new Response("not configured", { status: 503 });
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return new Response("too large", { status: 413 });
        if (!metaSignatureValid(raw, request.headers.get("x-hub-signature-256")))
          return new Response("bad signature", { status: 403 });
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad request", { status: 400 });
        }
        const ok = await handleMetaWebhook(payload);
        return new Response(ok ? "ok" : "error", { status: ok ? 200 : 500 });
      },
    },
  },
});
