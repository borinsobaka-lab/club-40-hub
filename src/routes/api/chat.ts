import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

type Body = { messages?: unknown };

async function getUserContext(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, "");
  const url =
    (import.meta as any).env?.VITE_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";
  const anon =
    (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    "";
  if (!url || !anon) {
    console.error("[api/chat] Supabase env is not configured");
    return null;
  }
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("studio_id, full_name")
    .eq("id", data.user.id)
    .maybeSingle();
  return { supabase, userId: data.user.id, studioId: prof?.studio_id as string | undefined };
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await getUserContext(request);
          if (!ctx || !ctx.studioId) {
            return new Response("Сессия истекла. Войдите заново и повторите запрос.", { status: 401 });
          }
          const { messages } = (await request.json()) as Body;
          if (!Array.isArray(messages)) {
            return new Response("Messages are required", { status: 400 });
          }

          const key = process.env.LOVABLE_API_KEY;
          if (!key) return new Response("AI ассистент не настроен", { status: 500 });

          const { supabase, studioId } = ctx;

        const tools = {
          list_clients: tool({
            description: "Список клиентов студии (профили). Опциональный поиск по имени/email.",
            inputSchema: z.object({
              search: z.string().optional(),
              limit: z.number().int().min(1).max(200).default(50),
            }),
            execute: async ({ search, limit }) => {
              let q = supabase
                .from("profiles")
                .select("id, full_name, email, phone, created_at")
                .eq("studio_id", studioId)
                .limit(limit);
              if (search) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
              const { data, error } = await q;
              if (error) return { error: error.message };
              return { count: data?.length ?? 0, rows: data ?? [] };
            },
          }),
          list_trainers: tool({
            description: "Список тренеров и сотрудников студии.",
            inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
            execute: async ({ limit }) => {
              const { data, error } = await supabase
                .from("employees")
                .select("id, full_name, email, role_title, active, hourly_rate_cents")
                .eq("studio_id", studioId)
                .limit(limit);
              if (error) return { error: error.message };
              return { count: data?.length ?? 0, rows: data ?? [] };
            },
          }),
          list_schedule: tool({
            description: "Расписание занятий за период. Даты в ISO формате (YYYY-MM-DD).",
            inputSchema: z.object({
              from: z.string().describe("Начало периода, ISO дата"),
              to: z.string().describe("Конец периода, ISO дата"),
            }),
            execute: async ({ from, to }) => {
              const { data, error } = await supabase
                .from("class_sessions")
                .select("id, starts_at, ends_at, capacity, booked_count, class_type_id, instructor_id")
                .eq("studio_id", studioId)
                .gte("starts_at", from)
                .lte("starts_at", to)
                .order("starts_at", { ascending: true })
                .limit(500);
              if (error) return { error: error.message };
              return { count: data?.length ?? 0, rows: data ?? [] };
            },
          }),
          list_memberships: tool({
            description: "Абонементы клиентов (опциональный фильтр по статусу).",
            inputSchema: z.object({
              status: z.enum(["active", "paused", "cancelled", "expired"]).optional(),
              limit: z.number().int().min(1).max(500).default(100),
            }),
            execute: async ({ status, limit }) => {
              let q = supabase
                .from("memberships")
                .select("id, user_id, plan_name, status, started_at, ends_at, price_cents")
                .eq("studio_id", studioId)
                .limit(limit);
              if (status) q = q.eq("status", status);
              const { data, error } = await q;
              if (error) return { error: error.message };
              return { count: data?.length ?? 0, rows: data ?? [] };
            },
          }),
          counts_overview: tool({
            description: "Сводка: общее число клиентов, тренеров, активных абонементов, ближайших занятий.",
            inputSchema: z.object({}),
            execute: async () => {
              const [clients, employees, mem, sessions] = await Promise.all([
                supabase.from("profiles").select("id", { count: "exact", head: true }).eq("studio_id", studioId),
                supabase.from("employees").select("id", { count: "exact", head: true }).eq("studio_id", studioId),
                supabase
                  .from("memberships")
                  .select("id", { count: "exact", head: true })
                  .eq("studio_id", studioId)
                  .eq("status", "active"),
                supabase
                  .from("class_sessions")
                  .select("id", { count: "exact", head: true })
                  .eq("studio_id", studioId)
                  .gte("starts_at", new Date().toISOString()),
              ]);
              return {
                clients: clients.count ?? 0,
                trainers: employees.count ?? 0,
                active_memberships: mem.count ?? 0,
                upcoming_sessions: sessions.count ?? 0,
              };
            },
          }),
        };

          const gateway = createLovableAiGatewayProvider(key);
          const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system:
            "Ты — Kate, AI-ассистент админ-панели фитнес-студии CLUB 40. " +
            "Отвечай на русском, кратко и по делу. У тебя есть инструменты для запросов к БД: " +
            "клиенты, тренеры, расписание, абонементы, сводка. Используй их когда нужно. " +
            "Если данных нет — честно скажи. Никогда не выдумывай цифры. " +
            "Текущая дата: " + new Date().toISOString().slice(0, 10) + ".",
          messages: await convertToModelMessages(messages as UIMessage[]),
          tools,
          stopWhen: stepCountIs(50),
          onError: ({ error }) => console.error("[api/chat] AI stream error", error),
          });

          return result.toUIMessageStreamResponse({
            originalMessages: messages as UIMessage[],
            onError: (error) => {
              console.error("[api/chat] UI stream error", error);
              return "Не удалось получить ответ ассистента. Попробуйте ещё раз.";
            },
          });
        } catch (error) {
          console.error("[api/chat] request failed", error);
          return new Response("Не удалось запустить ассистента. Попробуйте ещё раз.", { status: 500 });
        }
      },
    },
  },
});
