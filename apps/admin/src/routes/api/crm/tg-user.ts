import { createFileRoute } from "@tanstack/react-router";

import { hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { handleTgUserEvent } from "@/lib/crm/channels.server";
import { tgUserSecretValid } from "@/lib/crm/tg-user.server";

// События сервиса личных аккаунтов Telegram (integrations/crm-telegram):
// входящее сообщение, сообщение владельца со своего телефона, «вход сброшен».
// Multipart: meta — JSON, file — вложение. Принимается только с общим
// секретом CRM_TG_SECRET в заголовке Authorization.
const MAX_BODY_BYTES = 22 * 1024 * 1024;

export const Route = createFileRoute("/api/crm/tg-user")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!hasSupabaseAdmin()) return new Response("not configured", { status: 503 });
        if (!tgUserSecretValid(request.headers.get("authorization")))
          return new Response("forbidden", { status: 403 });
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
          return new Response("too large", { status: 413 });
        let meta: unknown;
        let file: File | null = null;
        try {
          const form = await request.formData();
          meta = JSON.parse(String(form.get("meta") ?? ""));
          const f = form.get("file");
          file = f instanceof File && f.size > 0 ? f : null;
        } catch {
          return new Response("bad request", { status: 400 });
        }
        const event = meta as { type?: string; account_id?: string };
        if (
          (event.type !== "message" && event.type !== "status") ||
          typeof event.account_id !== "string"
        )
          return new Response("bad request", { status: 400 });
        const ok = await handleTgUserEvent(meta as Parameters<typeof handleTgUserEvent>[0], file);
        return new Response(ok ? "ok" : "error", { status: ok ? 200 : 500 });
      },
    },
  },
});
