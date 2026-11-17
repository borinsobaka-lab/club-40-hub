import { createFileRoute } from "@tanstack/react-router";

import { hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { handleTelegramWebhook } from "@/lib/crm/channels.server";

// Вебхук Telegram-бота, подключённого к CRM (CRM.md, этап 2). Адрес и
// секрет ставит сервер при подключении бота (setWebhook, secret_token);
// Telegram присылает секрет заголовком — без него запрос не принимается.
const MAX_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const Route = createFileRoute("/api/crm/telegram/$accountId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!hasSupabaseAdmin()) return new Response("not configured", { status: 503 });
        if (!UUID.test(params.accountId)) return new Response("not found", { status: 404 });
        const text = await request.text();
        if (text.length > MAX_BODY_BYTES) return new Response("too large", { status: 413 });
        let update: unknown;
        try {
          update = JSON.parse(text);
        } catch {
          return new Response("bad request", { status: 400 });
        }
        const status = await handleTelegramWebhook(
          params.accountId,
          request.headers.get("x-telegram-bot-api-secret-token"),
          update,
        );
        return new Response(status === 200 ? "ok" : "error", { status });
      },
    },
  },
});
