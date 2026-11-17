import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWaTemplateMessage } from "@/lib/crm/channels.server";
import { authenticate, bearerToken } from "@/lib/staff-auth.server";

// Шаблон WhatsApp: в диалог (окно 24 ч закрыто) или первым — по номеру.
// Право CRM и видимость диалога проверяются от имени сотрудника (RLS).
const schema = z.object({
  templateId: z.string().uuid(),
  values: z.array(z.string().max(500)).max(20),
  conversationId: z.string().uuid().optional(),
  start: z
    .object({
      accountId: z.string().uuid(),
      phone: z.string().min(6).max(40),
      name: z.string().max(200),
      clientId: z.string().uuid().nullable(),
    })
    .optional(),
});

const fail = (error: string, status: number) => Response.json({ error }, { status });

export const Route = createFileRoute("/api/crm/send-template")({
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
          const res = await sendWaTemplateMessage({
            user: auth.supabase,
            userId: auth.user.id,
            ...parsed.data,
          });
          return Response.json({ ok: true, conversation_id: res.conversationId });
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Не удалось отправить шаблон", 422);
        }
      },
    },
  },
});
