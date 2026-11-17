import { createFileRoute } from "@tanstack/react-router";

import { hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { CRM_MAX_UPLOAD, sendToConversation } from "@/lib/crm/channels.server";
import { authenticate, bearerToken } from "@/lib/staff-auth.server";

// Ответ сотрудника в диалог CRM: multipart (conversation_id, body, file?).
// Видит ли сотрудник диалог, решает RLS от его имени; токен канала и запись
// сообщения — только на сервере (lib/crm/channels.server.ts).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const fail = (error: string, status: number) => Response.json({ error }, { status });

export const Route = createFileRoute("/api/crm/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!hasSupabaseAdmin()) return fail("Сервер не настроен", 503);
        const token = bearerToken(request.headers.get("authorization"));
        const auth = token ? await authenticate(token) : null;
        if (!auth) return fail("Сессия истекла. Войдите заново.", 401);
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > CRM_MAX_UPLOAD + 64 * 1024) return fail("Файл больше 20 МБ", 413);

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return fail("Неверный запрос", 400);
        }
        const conversationId = String(form.get("conversation_id") ?? "");
        if (!UUID.test(conversationId)) return fail("Диалог не найден", 400);
        const body = String(form.get("body") ?? "").slice(0, 4096);
        const file = form.get("file");
        try {
          const res = await sendToConversation({
            user: auth.supabase,
            userId: auth.user.id,
            conversationId,
            body,
            file: file instanceof File && file.size > 0 ? file : null,
          });
          return Response.json({ ok: true, id: res.id });
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Не удалось отправить", 422);
        }
      },
    },
  },
});
