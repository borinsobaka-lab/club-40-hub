import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, safeValidateUIMessages, stepCountIs, streamText } from "ai";
import type { UIMessage } from "ai";

import { canOpenClubSection } from "@/lib/admin-access";
import { createAiProvider } from "@/lib/ai-gateway.server";
import { filterTools } from "@/lib/assistant/access";
import { loadAdminAccess } from "@/lib/assistant/access.server";
import { studioToday } from "@/lib/assistant/dates";
import {
  HISTORY_FOR_MODEL,
  MAX_QUESTION_CHARS,
  answerFromSteps,
  fromStored,
  historyForModel,
  messageText,
  threadTitle,
  toStored,
} from "@/lib/assistant/history";
import { buildSystemPrompt } from "@/lib/assistant/prompt";
import { createAssistantTools } from "@/lib/assistant/tools.server";
import type { StudioFormat } from "@/lib/studio-formats";
import { authenticateStaff } from "@/lib/staff-auth.server";

// Сколько шагов (вызовов инструментов) модель может сделать за один ответ.
// Вопрос о продажах — до 3–5 вызовов; потолок ограничивает стоимость зацикливания.
const MAX_STEPS = 12;

// Браузер присылает только новый вопрос — историю сервер берёт из базы
// (assistant_messages), поэтому запрос маленький.
const MAX_BODY_BYTES = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Тело запроса окна Kate: id диалога и новый вопрос (UIMessage). */
type ChatRequest = { threadId?: unknown; message?: unknown };

const text = (message: string, status: number) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Ассистент Kate — инструмент сотрудника, а не клиента приложения.
          const auth = await authenticateStaff(request);
          if (!auth.ok) return text(auth.message, auth.status);

          const provider = createAiProvider();
          const chatModel = process.env.AI_CHAT_MODEL;
          if (!provider || !chatModel) {
            return text(
              "AI-ассистент временно недоступен: модель ещё не подключена. История переписки сохранится, когда её подключат.",
              503,
            );
          }

          const declared = Number(request.headers.get("content-length") ?? "0");
          if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
            return text("Слишком длинный вопрос", 413);
          }
          // Content-Length может не быть (chunked) — проверяем и прочитанное.
          const raw = await request.text();
          if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return text("Слишком длинный вопрос", 413);
          let body: ChatRequest | null = null;
          try {
            body = JSON.parse(raw) as ChatRequest | null;
          } catch {
            body = null;
          }
          const threadId = typeof body?.threadId === "string" ? body.threadId : "";
          const parsed = await safeValidateUIMessages({ messages: [body?.message] });
          if (!UUID_RE.test(threadId) || !parsed.success) {
            return text("Некорректный запрос к ассистенту", 400);
          }
          const question = parsed.data[0];
          const questionText = messageText(question);
          if (question.role !== "user" || !questionText || question.id.length > 100) {
            return text("Некорректный запрос к ассистенту", 400);
          }
          if (questionText.length > MAX_QUESTION_CHARS) {
            return text(`Вопрос длиннее ${MAX_QUESTION_CHARS} символов — сократите его`, 413);
          }

          const { supabase, userId, studioId, roles } = auth.staff;

          // Диалог — свой (RLS): чужой id выглядит как несуществующий, а
          // завести диалог с занятым id не даст первичный ключ.
          const { data: thread, error: threadError } = await supabase
            .from("assistant_threads")
            .select("id")
            .eq("id", threadId)
            .maybeSingle();
          if (threadError) throw new Error(threadError.message);
          if (!thread) {
            const { error } = await supabase
              .from("assistant_threads")
              .insert({ id: threadId, studio_id: studioId, title: threadTitle(questionText) });
            if (error) return text("Не удалось начать диалог. Откройте новый чат.", 409);
          }

          const { data: past, error: pastError } = await supabase
            .from("assistant_messages")
            .select("id, role, parts")
            .eq("thread_id", threadId)
            .order("created_at", { ascending: false })
            .limit(HISTORY_FOR_MODEL);
          if (pastError) throw new Error(pastError.message);
          const history = ((past ?? []) as { id: string; role: string; parts: unknown }[])
            .reverse()
            .map(fromStored)
            .filter((m): m is UIMessage => !!m && m.id !== question.id);

          // Вопрос сохраняется сразу: не дошёл ответ — вопрос в истории остался.
          const storedQuestion = toStored(question);
          if (storedQuestion) {
            const { error } = await supabase
              .from("assistant_messages")
              .upsert(
                { thread_id: threadId, ...storedQuestion },
                { onConflict: "thread_id,id", ignoreDuplicates: true },
              );
            if (error) throw new Error(error.message);
          }

          const [{ data: studio }, { data: profile }, access] = await Promise.all([
            supabase.from("studios").select("name, format").eq("id", studioId).maybeSingle(),
            supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
            loadAdminAccess(supabase, userId, studioId, roles),
          ]);
          const tools = filterTools(
            createAssistantTools(supabase, studioId, {
              canSee: (key) => canOpenClubSection(access, studioId, key),
            }),
            access,
            studioId,
          );

          const messages = [...history, question];
          const answerId = crypto.randomUUID();
          const result = streamText({
            model: provider(chatModel),
            system: buildSystemPrompt({
              today: studioToday(),
              studio: {
                name: (studio?.name as string | null | undefined) ?? null,
                format: (studio?.format as StudioFormat | null | undefined) ?? null,
              },
              staffName: (profile?.full_name as string | null | undefined) ?? null,
            }),
            // Модели — только текст последних сообщений: строки данных из
            // прошлых ответов не хранятся, нужные Kate запросит заново.
            messages: await convertToModelMessages(historyForModel(messages)),
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
            // Ответ сохраняется из итога генерации, а не UI-потока: закрыл
            // окно — поток в браузер оборван, а ответ дописывается и при
            // следующем открытии будет в истории.
            onFinish: async ({ steps }) => {
              const stored = answerFromSteps(answerId, steps);
              if (!stored) return;
              const { error } = await supabase
                .from("assistant_messages")
                .upsert({ thread_id: threadId, ...stored }, { onConflict: "thread_id,id" });
              if (error) console.error("[api/chat] save answer failed", error.message);
            },
            onError: ({ error }) => console.error("[api/chat] AI stream error", error),
          });
          // Без этого обрыв связи с браузером остановил бы генерацию.
          void result.consumeStream();

          return result.toUIMessageStreamResponse({
            originalMessages: messages,
            generateMessageId: () => answerId,
            onError: (error) => {
              console.error("[api/chat] UI stream error", error);
              return "Не удалось получить ответ ассистента. Попробуйте ещё раз.";
            },
          });
        } catch (error) {
          console.error("[api/chat] request failed", error);
          return text("Не удалось запустить ассистента. Попробуйте ещё раз.", 500);
        }
      },
    },
  },
});
