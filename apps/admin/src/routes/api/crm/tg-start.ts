import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { startTelegramChat } from "@/lib/crm/channels.server";
import { authenticate, bearerToken } from "@/lib/staff-auth.server";

// «Написать в Telegram» первым — с личного аккаунта, по номеру или @нику.
// Право CRM и клуб аккаунта проверяются от имени сотрудника.
const schema = z.object({
  accountId: z.string().uuid(),
  phone: z.string().max(40).nullable(),
  username: z.string().max(64).nullable(),
  name: z.string().max(200),
  clientId: z.string().uuid().nullable(),
  body: z.string().min(1).max(4096),
});

const fail = (error: string, status: number) => Response.json({ error }, { status });

export const Route = createFileRoute("/api/crm/tg-start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!hasSupabaseAdmin()) return fail("Сервер не настроен", 503);
        const token = bearerToken(request.headers.get("authorization"));
        const auth = token ? await authenticate(token) : null;
        if (!auth) return fail("Сессия истекла. Войдите заново.", 401);
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("Неверный запрос", 400);
        try {
          const res = await startTelegramChat({
            user: auth.supabase,
            userId: auth.user.id,
            ...parsed.data,
          });
          return Response.json({ ok: true, conversation_id: res.conversationId });
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Не удалось отправить сообщение", 422);
        }
      },
    },
  },
});
