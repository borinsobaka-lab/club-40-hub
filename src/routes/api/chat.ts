import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createAiProvider } from "@/lib/ai-gateway.server";
import { getStaffContext } from "@/lib/staff-auth.server";
import { sanitizeSearch } from "@/lib/format";

type Body = { messages?: unknown };

// Ассистент Kate — инструмент сотрудника, а не клиента приложения. Пускаем
// только сотрудников (owner/admin/trainer); анонимы и клиенты получают 401.
async function getUserContext(request: Request) {
  return await getStaffContext(request);
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await getUserContext(request);
          if (!ctx || !ctx.studioId) {
            return new Response("Сессия истекла. Войдите заново и повторите запрос.", {
              status: 401,
            });
          }
          const { messages } = (await request.json()) as Body;
          if (!Array.isArray(messages)) {
            return new Response("Messages are required", { status: 400 });
          }

          const provider = createAiProvider();
          const chatModel = process.env.AI_CHAT_MODEL;
          if (!provider || !chatModel) {
            return new Response(
              "AI-ассистент временно недоступен: после переезда новый AI-провайдер ещё не подключён.",
              { status: 503 },
            );
          }

          const { supabase, studioId } = ctx;

          // Универсальный селектор по студии
          const studioTable = (table: string, select: string, limit = 100) =>
            supabase.from(table).select(select).eq("studio_id", studioId).limit(limit);

          const tools = {
            // ====== КЛИЕНТЫ ======
            list_clients: tool({
              description:
                "Клиенты студии со всеми полями: ФИО, имя/фамилия, телефон, email, ДР, пол, заметки, дата регистрации, последний визит, CRM-ссылка, фото. Можно фильтровать по точным ID.",
              inputSchema: z.object({
                ids: z
                  .array(z.string().uuid())
                  .optional()
                  .describe(
                    "Точные clients.id, если нужно подтянуть клиентов по связям из других таблиц",
                  ),
                search: z.string().optional().describe("Поиск по имени/фамилии/телефону/email"),
                limit: z.number().int().min(1).max(500).default(100),
              }),
              execute: async ({ ids, search, limit }) => {
                let q = supabase
                  .from("clients")
                  .select(
                    "id, full_name, first_name, last_name, phone, email, birthday, gender, notes, registration_date, last_visit_date, crm_link, photo_url, created_at",
                  )
                  .eq("studio_id", studioId)
                  .order("created_at", { ascending: false })
                  .limit(limit);
                if (ids?.length) q = q.in("id", ids);
                // Запятые и скобки из строки модели развалили бы .or():
                // там запятая разделяет условия, а скобки группируют.
                const term = sanitizeSearch(search ?? "");
                if (term)
                  q = q.or(
                    `full_name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`,
                  );
                const { data, error } = await q;
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== ТРЕНЕРЫ / СОТРУДНИКИ ======
            list_trainers: tool({
              description:
                "Тренеры и админы студии: ФИО, фото, пол, специализация, био, соцсети, роль.",
              inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
              execute: async ({ limit }) => {
                const { data, error } = await studioTable(
                  "trainers",
                  "id, full_name, photo_url, gender, specialization, bio, telegram, whatsapp, instagram, facebook, tiktok, role, created_at",
                  limit,
                );
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== ТРЕНИРОВКИ (шаблоны) ======
            list_workouts: tool({
              description: "Шаблоны тренировок студии (название, описание, тип, фото).",
              inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
              execute: async ({ limit }) => {
                const { data, error } = await studioTable(
                  "workouts",
                  "id, name, description, type, photo_url, created_at",
                  limit,
                );
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== РАСПИСАНИЕ ======
            list_schedule: tool({
              description: "Расписание занятий за период. Даты в ISO (YYYY-MM-DD).",
              inputSchema: z.object({
                from: z.string(),
                to: z.string(),
                limit: z.number().int().min(1).max(1000).default(500),
              }),
              execute: async ({ from, to, limit }) => {
                const { data, error } = await supabase
                  .from("schedule_entries")
                  .select("id, starts_at, ends_at, workout_id, capacity, booked_count")
                  .eq("studio_id", studioId)
                  .gte("starts_at", from)
                  .lte("starts_at", to)
                  .order("starts_at", { ascending: true })
                  .limit(limit);
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== АБОНЕМЕНТЫ (шаблоны) ======
            list_memberships: tool({
              description:
                "Шаблоны абонементов студии: название, описание, бонусы, число посещений, срок, цена, активность, обложка, признак 'для двоих'. Можно фильтровать по точным ID.",
              inputSchema: z.object({
                ids: z
                  .array(z.string().uuid())
                  .optional()
                  .describe(
                    "Точные memberships.id, если нужно подтянуть названия по связям из client_memberships или sales",
                  ),
                only_active: z.boolean().default(false),
                for_couple: z.boolean().optional(),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ ids, only_active, for_couple, limit }) => {
                let q = supabase
                  .from("memberships")
                  .select(
                    "id, name, description, benefits, visits_count, duration_days, auto_renew, installment_enabled, price, is_active, cover_url, for_couple, created_at",
                  )
                  .eq("studio_id", studioId)
                  .limit(limit);
                if (ids?.length) q = q.in("id", ids);
                if (only_active) q = q.eq("is_active", true);
                if (typeof for_couple === "boolean") q = q.eq("for_couple", for_couple);
                const { data, error } = await q;
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== ВЫДАННЫЕ КЛИЕНТАМ АБОНЕМЕНТЫ ======
            list_client_memberships: tool({
              description:
                "Выданные клиентам абонементы (client_memberships). Содержит client_id, membership_id, status, started_at, ends_at, visits_left. " +
                "Для вопросов «у кого скоро заканчивается абонемент» лучше используй list_expiring_client_memberships. " +
                "Для имени клиента ОБЯЗАТЕЛЬНО вызови list_clients по полученным client_id; для названия абонемента — list_memberships по membership_id. Никогда не выдумывай имена и названия.",
              inputSchema: z.object({
                status: z.enum(["active", "replaced", "expired", "cancelled"]).optional(),
                client_id: z.string().uuid().optional(),
                expiring_within_days: z
                  .number()
                  .int()
                  .min(1)
                  .max(365)
                  .optional()
                  .describe(
                    "Вернуть только записи, у которых ends_at в пределах N дней от сегодня.",
                  ),
                order_by: z.enum(["created_desc", "ends_at_asc"]).default("created_desc"),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ status, client_id, expiring_within_days, order_by, limit }) => {
                let q = supabase
                  .from("client_memberships")
                  .select(
                    "id, client_id, membership_id, sale_id, source, started_at, ends_at, visits_left, status, created_at",
                  )
                  .eq("studio_id", studioId)
                  .limit(limit);
                if (order_by === "ends_at_asc") {
                  q = q.order("ends_at", { ascending: true, nullsFirst: false });
                } else {
                  q = q.order("created_at", { ascending: false });
                }
                if (status) q = q.eq("status", status);
                if (client_id) q = q.eq("client_id", client_id);
                if (expiring_within_days) {
                  const today = new Date();
                  const to = new Date(today.getTime() + expiring_within_days * 86400000);
                  const iso = (d: Date) => d.toISOString().slice(0, 10);
                  q = q.gte("ends_at", iso(today)).lte("ends_at", iso(to));
                }
                const { data, error } = await q;
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            list_expiring_client_memberships: tool({
              description:
                "ТОЛЬКО для вопросов «у кого ближе всего/скоро заканчивается/истекает абонемент». " +
                "Возвращает реальные активные абонементы клиентов, отсортированные по ближайшей дате окончания, уже со связанными данными клиента и шаблона абонемента. " +
                "Используй этот инструмент вместо ручного сопоставления, чтобы не выдумывать людей и названия.",
              inputSchema: z.object({
                within_days: z
                  .number()
                  .int()
                  .min(1)
                  .max(3650)
                  .optional()
                  .describe(
                    "Ограничить окончанием в пределах N дней. Если пользователь не указал период, не передавай параметр.",
                  ),
                limit: z.number().int().min(1).max(100).default(10),
              }),
              execute: async ({ within_days, limit }) => {
                const today = new Date();
                const iso = (d: Date) => d.toISOString().slice(0, 10);
                let q = supabase
                  .from("client_memberships")
                  .select(
                    "id, client_id, membership_id, sale_id, source, started_at, ends_at, visits_left, status, created_at, clients(id, full_name, first_name, last_name, phone, email), memberships(id, name, visits_count, duration_days, price, is_active)",
                  )
                  .eq("studio_id", studioId)
                  .eq("status", "active")
                  .not("ends_at", "is", null)
                  .gte("ends_at", iso(today))
                  .order("ends_at", { ascending: true, nullsFirst: false })
                  .limit(limit);
                if (within_days) {
                  const to = new Date(today.getTime() + within_days * 86400000);
                  q = q.lte("ends_at", iso(to));
                }
                const { data, error } = await q;
                if (error) return { error: error.message };

                const rows = (data ?? []).map((row: any) => {
                  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
                  const membership = Array.isArray(row.memberships)
                    ? row.memberships[0]
                    : row.memberships;
                  const clientName =
                    [client?.last_name, client?.first_name].filter(Boolean).join(" ").trim() ||
                    client?.full_name ||
                    null;
                  return {
                    id: row.id,
                    client_id: row.client_id,
                    client_name: clientName,
                    client_phone: client?.phone ?? null,
                    client_email: client?.email ?? null,
                    membership_id: row.membership_id,
                    membership_name: membership?.name ?? null,
                    membership_visits_count: membership?.visits_count ?? null,
                    membership_duration_days: membership?.duration_days ?? null,
                    membership_price: membership?.price ?? null,
                    sale_id: row.sale_id,
                    source: row.source,
                    started_at: row.started_at,
                    ends_at: row.ends_at,
                    visits_left: row.visits_left,
                    status: row.status,
                  };
                });

                return {
                  count: rows.length,
                  rows,
                  integrity_note:
                    "client_name и membership_name взяты только из связанных строк clients/memberships. Если поле null — связь в базе отсутствует, его нельзя додумывать.",
                };
              },
            }),

            // ====== ПРОДАЖИ ======
            list_sales: tool({
              description:
                "Продажи абонементов: дата, сумма, первый взнос, рассрочка, клиент, абонемент, админ, комментарий. Фильтр по периоду (sold_at).",
              inputSchema: z.object({
                from: z.string().optional(),
                to: z.string().optional(),
                client_id: z.string().uuid().optional(),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ from, to, client_id, limit }) => {
                let q = supabase
                  .from("sales")
                  .select(
                    "id, sold_at, client_id, membership_id, admin_id, admin_name, total_amount, down_payment_amount, remaining_installments, comment, created_at",
                  )
                  .eq("studio_id", studioId)
                  .order("sold_at", { ascending: false })
                  .limit(limit);
                if (from) q = q.gte("sold_at", from);
                if (to) q = q.lte("sold_at", to);
                if (client_id) q = q.eq("client_id", client_id);
                const { data, error } = await q;
                if (error) return { error: error.message };
                const total = (data ?? []).reduce(
                  (s, r: any) => s + Number(r.total_amount || 0),
                  0,
                );
                return { count: data?.length ?? 0, total_amount: total, rows: data ?? [] };
              },
            }),

            // ====== КАССА ======
            list_cash_operations: tool({
              description: "Операции по кассе: приход/расход, категория, сумма, комментарий, дата.",
              inputSchema: z.object({
                kind: z.enum(["income", "expense"]).optional(),
                from: z.string().optional(),
                to: z.string().optional(),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ kind, from, to, limit }) => {
                let q = supabase
                  .from("cash_operations")
                  .select("id, kind, category, amount, comment, occurred_at, user_id, created_at")
                  .eq("studio_id", studioId)
                  .order("occurred_at", { ascending: false })
                  .limit(limit);
                if (kind) q = q.eq("kind", kind);
                if (from) q = q.gte("occurred_at", from);
                if (to) q = q.lte("occurred_at", to);
                const { data, error } = await q;
                if (error) return { error: error.message };
                const income = (data ?? [])
                  .filter((r: any) => r.kind === "income")
                  .reduce((s, r: any) => s + Number(r.amount || 0), 0);
                const expense = (data ?? [])
                  .filter((r: any) => r.kind === "expense")
                  .reduce((s, r: any) => s + Number(r.amount || 0), 0);
                return {
                  count: data?.length ?? 0,
                  total_income: income,
                  total_expense: expense,
                  balance: income - expense,
                  rows: data ?? [],
                };
              },
            }),

            // ====== ПРОМОКОДЫ ======
            list_promo_codes: tool({
              description:
                "Промокоды студии: имя, код, скидка, лимит, использования, срок, активность.",
              inputSchema: z.object({
                only_active: z.boolean().default(false),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ only_active, limit }) => {
                let q = supabase
                  .from("promo_codes")
                  .select(
                    "id, name, code, expires_at, discount_type, discount_value, usage_limit, usage_count, description, is_active, created_at",
                  )
                  .eq("studio_id", studioId)
                  .order("created_at", { ascending: false })
                  .limit(limit);
                if (only_active) q = q.eq("is_active", true);
                const { data, error } = await q;
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== НОВОСТИ ======
            list_news: tool({
              description:
                "Новости для мобильного приложения: заголовок, описание, кнопка, картинки.",
              inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
              execute: async ({ limit }) => {
                const { data, error } = await studioTable(
                  "news",
                  "id, position, title, description, full_title, full_text, button_text, button_url, image_url, banner_url, created_at, updated_at",
                  limit,
                );
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== УСЛУГИ ======
            list_services: tool({
              description: "Услуги мобильного приложения (карточки услуг).",
              inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
              execute: async ({ limit }) => {
                const { data, error } = await studioTable(
                  "services",
                  "id, position, title, description, full_title, full_text, button_text, button_url, image_url, banner_url, created_at",
                  limit,
                );
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== ПУШ-УВЕДОМЛЕНИЯ ======
            list_push_notifications: tool({
              description:
                "Пуш-уведомления: заголовок, текст, action_url, сегменты, статус (draft/scheduled/sent), запланировано/отправлено, метрики доставки/прочтения.",
              inputSchema: z.object({
                status: z.enum(["draft", "scheduled", "sent"]).optional(),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ status, limit }) => {
                let q = supabase
                  .from("push_notifications")
                  .select(
                    "id, title, message, action_url, segments, status, scheduled_at, sent_at, sent_count, delivered_count, read_count, created_at, updated_at",
                  )
                  .eq("studio_id", studioId)
                  .order("created_at", { ascending: false })
                  .limit(limit);
                if (status) q = q.eq("status", status);
                const { data, error } = await q;
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== ОБРАТНАЯ СВЯЗЬ ======
            list_feedback: tool({
              description:
                "Обратная связь от клиентов: тема, сообщение, настроение, контакт, статус (pending/resolved).",
              inputSchema: z.object({
                status: z.enum(["pending", "resolved"]).optional(),
                topic: z
                  .enum(["training", "staff", "cleanliness", "app", "idea", "thanks", "other"])
                  .optional(),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ status, topic, limit }) => {
                let q = supabase
                  .from("feedback")
                  .select(
                    "id, topic, message, mood, client_name, client_contact, status, resolved_by_name, resolved_at, resolution_comment, created_at",
                  )
                  .order("created_at", { ascending: false })
                  .limit(limit);
                if (status) q = q.eq("status", status);
                if (topic) q = q.eq("topic", topic);
                const { data, error } = await q;
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== NPS ======
            list_nps: tool({
              description: "NPS-ответы: оценка (0-10), тип опроса, комментарий, обработан ли.",
              inputSchema: z.object({
                survey_type: z
                  .enum([
                    "first_lessons",
                    "first_month",
                    "before_renewal",
                    "after_return",
                    "general",
                  ])
                  .optional(),
                handled: z.boolean().optional(),
                from: z.string().optional(),
                to: z.string().optional(),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ survey_type, handled, from, to, limit }) => {
                let q = supabase
                  .from("nps_responses")
                  .select(
                    "id, score, client_name, comment, language, survey_type, handled, created_at",
                  )
                  .order("created_at", { ascending: false })
                  .limit(limit);
                if (survey_type) q = q.eq("survey_type", survey_type);
                if (typeof handled === "boolean") q = q.eq("handled", handled);
                if (from) q = q.gte("created_at", from);
                if (to) q = q.lte("created_at", to);
                const { data, error } = await q;
                if (error) return { error: error.message };
                const rows = data ?? [];
                const promoters = rows.filter((r: any) => r.score >= 9).length;
                const detractors = rows.filter((r: any) => r.score <= 6).length;
                const nps = rows.length
                  ? Math.round(((promoters - detractors) / rows.length) * 100)
                  : null;
                return { count: rows.length, nps_score: nps, promoters, detractors, rows };
              },
            }),

            // ====== ИСТОРИЯ ЗАПИСЕЙ ======
            list_bookings_log: tool({
              description:
                "История записей клиентов на тренировки: имя клиента, тренировка, тип, время, статус.",
              inputSchema: z.object({
                from: z.string().optional(),
                to: z.string().optional(),
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ from, to, limit }) => {
                let q = supabase
                  .from("bookings_log")
                  .select("*")
                  .eq("studio_id", studioId)
                  .order("created_at", { ascending: false })
                  .limit(limit);
                if (from) q = q.gte("created_at", from);
                if (to) q = q.lte("created_at", to);
                const { data, error } = await q;
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== АКТИВНЫЕ БРОНИ ======
            list_schedule_bookings: tool({
              description: "Брони в расписании (schedule_bookings).",
              inputSchema: z.object({
                limit: z.number().int().min(1).max(500).default(200),
              }),
              execute: async ({ limit }) => {
                const { data, error } = await supabase
                  .from("schedule_bookings")
                  .select("id, entry_id, user_id, status, created_at, cancelled_at")
                  .eq("studio_id", studioId)
                  .order("created_at", { ascending: false })
                  .limit(limit);
                if (error) return { error: error.message };
                return { count: data?.length ?? 0, rows: data ?? [] };
              },
            }),

            // ====== НАСТРОЙКИ КЛУБА ======
            get_club_settings: tool({
              description: "Глобальные настройки клуба (ссылки, минуты для отмены брони).",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase
                  .from("club_settings")
                  .select("*")
                  .maybeSingle();
                if (error) return { error: error.message };
                return data ?? {};
              },
            }),

            // ====== СВОДКА ======
            counts_overview: tool({
              description:
                "Сводка по студии: число клиентов, тренеров, шаблонов абонементов, активных клиентских абонементов, продаж за 30 дней, операций кассы, новостей, услуг, пушей, фидбэка, ответов NPS.",
              inputSchema: z.object({}),
              execute: async () => {
                const head = { count: "exact" as const, head: true };
                const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
                const [
                  clients,
                  trainers,
                  memberships,
                  activeCM,
                  sales30,
                  cash,
                  news,
                  services,
                  pushSent,
                  feedbackPending,
                  nps,
                  workouts,
                ] = await Promise.all([
                  supabase.from("clients").select("id", head).eq("studio_id", studioId),
                  supabase.from("trainers").select("id", head).eq("studio_id", studioId),
                  supabase.from("memberships").select("id", head).eq("studio_id", studioId),
                  supabase
                    .from("client_memberships")
                    .select("id", head)
                    .eq("studio_id", studioId)
                    .eq("status", "active"),
                  supabase
                    .from("sales")
                    .select("id", head)
                    .eq("studio_id", studioId)
                    .gte("sold_at", since30),
                  supabase.from("cash_operations").select("id", head).eq("studio_id", studioId),
                  supabase.from("news").select("id", head).eq("studio_id", studioId),
                  supabase.from("services").select("id", head).eq("studio_id", studioId),
                  supabase
                    .from("push_notifications")
                    .select("id", head)
                    .eq("studio_id", studioId)
                    .eq("status", "sent"),
                  supabase.from("feedback").select("id", head).eq("status", "pending"),
                  supabase.from("nps_responses").select("id", head),
                  supabase.from("workouts").select("id", head).eq("studio_id", studioId),
                ]);
                return {
                  clients: clients.count ?? 0,
                  trainers: trainers.count ?? 0,
                  workouts: workouts.count ?? 0,
                  membership_plans: memberships.count ?? 0,
                  active_client_memberships: activeCM.count ?? 0,
                  sales_last_30d: sales30.count ?? 0,
                  cash_operations: cash.count ?? 0,
                  news: news.count ?? 0,
                  services: services.count ?? 0,
                  push_sent: pushSent.count ?? 0,
                  feedback_pending: feedbackPending.count ?? 0,
                  nps_responses: nps.count ?? 0,
                };
              },
            }),
          };

          const result = streamText({
            model: provider(chatModel),
            system:
              "Ты — Kate, AI-ассистент админ-панели фитнес-студии Base40. " +
              "Отвечай на русском, кратко и по делу, используя markdown. Текущая дата: " +
              new Date().toISOString().slice(0, 10) +
              ".\n\n" +
              "ЖЁСТКИЕ ПРАВИЛА (нарушение = серьёзная ошибка):\n" +
              "1. НИКОГДА не выдумывай данные: имена, телефоны, e-mail, названия абонементов, суммы, даты, id. " +
              "Любая цифра/имя/название в ответе должны быть дословно взяты из результата инструмента в этом же ответе. " +
              "Запрещено писать фразы вроде «были сопоставлены по ID», если ты реально не получила эти строки инструментом. " +
              "Если инструмент ничего не вернул или связь отсутствует — так и скажи: «нет данных», не подставляй примеры.\n" +
              "2. Сущности связаны по id. Чтобы показать имя клиента и название абонемента в одном ответе, " +
              "сделай несколько вызовов и СВЯЖИ их сам: \n" +
              "   - клиент: clients.id ←→ client_memberships.client_id, sales.client_id\n" +
              "   - шаблон абонемента: memberships.id ←→ client_memberships.membership_id, sales.membership_id\n" +
              "   - продажа: sales.id ←→ client_memberships.sale_id\n" +
              "   Сначала получи список (например, истекающих client_memberships), затем одним вызовом подтяни " +
              "соответствующих клиентов и шаблоны абонементов по их id. Не сопоставляй по «похожим» именам.\n" +
              "3. Для вопросов «у кого ближе всего/скоро заканчивается/истекает абонемент» ОБЯЗАТЕЛЬНО используй только list_expiring_client_memberships. " +
              "Если пользователь не указал период, не ограничивай within_days — верни ближайшие активные окончания по ends_at. " +
              "В ответ можно включать только поля, которые пришли в rows этого инструмента. Если count=0 — ответь, что активных абонементов с будущей датой окончания не найдено.\n" +
              "4. Если в ответе фигурируют клиенты или абонементы — указывай рядом их id из БД, чтобы данные можно было проверить. " +
              "Если client_name или membership_name = null, не придумывай название: напиши «связь не найдена».\n" +
              "5. Никогда не показывай примеры/иллюстративные данные. Лучше ответить «не нашла записей», чем придумать.\n\n" +
              "Доступные разделы через инструменты: клиенты, тренеры, тренировки, расписание, шаблоны абонементов, " +
              "выданные абонементы, продажи, касса, промокоды, новости, услуги, пуш-уведомления, обратная связь, NPS, " +
              "история записей, активные брони, настройки клуба и сводка counts_overview.",

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
          return new Response("Не удалось запустить ассистента. Попробуйте ещё раз.", {
            status: 500,
          });
        }
      },
    },
  },
});
