import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, safeValidateUIMessages, stepCountIs, streamText } from "ai";

import { createAiProvider } from "@/lib/ai-gateway.server";
import { studioToday } from "@/lib/assistant/dates";
import { buildSystemPrompt } from "@/lib/assistant/prompt";
import { createAssistantTools } from "@/lib/assistant/tools.server";
import { authenticateStaff } from "@/lib/staff-auth.server";

// Сколько шагов (вызовов инструментов) модель может сделать за один ответ.
// Типичный вопрос — 1–3 вызова; потолок ограничивает стоимость зацикливания.
const MAX_STEPS = 12;

// Потолок запроса: история чата целиком уходит модели (и в счёт за токены).
// В истории едут и ответы инструментов (до 500 строк на вызов), поэтому
// запас — мегабайт; больше — 413.
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MESSAGES = 100;
const tooLarge = () =>
  new Response("Слишком длинный разговор с ассистентом — начните новый", { status: 413 });

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Ассистент Kate — инструмент сотрудника, а не клиента приложения.
          const auth = await authenticateStaff(request);
          if (!auth.ok) return new Response(auth.message, { status: auth.status });

          const provider = createAiProvider();
          const chatModel = process.env.AI_CHAT_MODEL;
          if (!provider || !chatModel) {
            return new Response(
              "AI-ассистент временно недоступен: после переезда новый AI-провайдер ещё не подключён.",
              { status: 503 },
            );
          }

          const { supabase, studioId } = auth.staff;
          const tools = createAssistantTools(supabase, studioId);

          const declared = Number(request.headers.get("content-length") ?? "0");
          if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return tooLarge();
          // Content-Length может не быть (chunked) — проверяем и прочитанное.
          const raw = await request.text();
          if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return tooLarge();
          let body: { messages?: unknown } | null = null;
          try {
            body = JSON.parse(raw) as { messages?: unknown } | null;
          } catch {
            body = null;
          }
          if (Array.isArray(body?.messages) && body.messages.length > MAX_MESSAGES) {
            return tooLarge();
          }
          const parsed = await safeValidateUIMessages({ messages: body?.messages });
          if (!parsed.success) {
            return new Response("Некорректный запрос к ассистенту", { status: 400 });
          }
          const messages = parsed.data;

          const result = streamText({
            model: provider(chatModel),
            system: buildSystemPrompt(studioToday()),
            messages: await convertToModelMessages(messages),
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
            // Закрыл окно Kate — генерацию (и оплату токенов) прекращаем.
            abortSignal: request.signal,
            onError: ({ error }) => console.error("[api/chat] AI stream error", error),
          });

          return result.toUIMessageStreamResponse({
            originalMessages: messages,
            onError: (error) => {
              console.error("[api/chat] UI stream error", error);
              return "Не удалось получить ответ ассистента. Попробуйте ещё раз.";
            },
          });
        } catch (error) {
          console.error("[api/chat] request failed", error);
          return new Response("Не удалось запустить ассистента. Попробуйте ещё раз.", {
            status: 500,
          });
        }
      },
    },
  },
});
