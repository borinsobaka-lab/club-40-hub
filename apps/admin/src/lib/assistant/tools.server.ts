import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { z } from "zod";

import { sanitizeSearch } from "@/lib/format";
import { catalogStudioIds, type CatalogStudio } from "@/lib/studio-catalog";

import { addDays, studioDayStart, studioToday } from "./dates";

/**
 * Инструменты AI-ассистента Kate: только чтение данных студии через клиент
 * от имени сотрудника (RLS действует). Каждый инструмент возвращает
 * { count, rows } или { error } — модель обязана сказать об ошибке, а не
 * подставлять значения (см. prompt.ts).
 */

type QueryResult = { data: unknown; error: { message: string } | null };

/** Ответ Supabase -> результат инструмента. */
async function listResult(query: PromiseLike<QueryResult>) {
  const { data, error } = await query;
  if (error) return { error: error.message };
  const rows = (data ?? []) as Record<string, unknown>[];
  return { count: rows.length, rows };
}

const limit = (max: number, byDefault: number) =>
  z.number().int().min(1).max(max).default(byDefault);
// Только дата: inPeriod строит из неё границы суток, время сломало бы фильтр.
const dateString = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD, без времени")
    .describe(`${what}, YYYY-MM-DD`);
const isoDate = (what: string) => dateString(what).optional();

/** Встроенная связь нетипизированного клиента: объект или массив из одного. */
function one<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

function sum<T>(rows: T[], value: (row: T) => unknown) {
  return rows.reduce((s, r) => s + Number(value(r) || 0), 0);
}

/**
 * Фильтр периода по timestamptz-колонке: границы — сутки студии, `to`
 * включительно (до начала следующих суток). Голая дата в .lte() обрезала бы
 * последний день до полуночи UTC.
 */
function inPeriod<Q extends { gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q }>(
  q: Q,
  column: string,
  from?: string,
  to?: string,
) {
  if (from) q = q.gte(column, studioDayStart(from));
  if (to) q = q.lt(column, studioDayStart(addDays(to, 1)));
  return q;
}

export function createAssistantTools(supabase: SupabaseClient, studioId: string) {
  // feedback и nps_responses: старые строки могут быть без студии (до
  // feedback_nps_studio.sql) — так же, как в разделах админки.
  const ownOrUnassigned = `studio_id.eq.${studioId},studio_id.is.null`;
  // Тренировки и номенклатура пакетных клубов общие (lib/studio-catalog.ts).
  const catalogIds = async () => {
    const { data } = await supabase.from("studios").select("id, format");
    return catalogStudioIds((data ?? []) as CatalogStudio[], studioId);
  };

  return {
    // ====== КЛИЕНТЫ ======
    list_clients: tool({
      description:
        "Клиенты клуба со всеми полями: ФИО, имя/фамилия, телефон, email, ДР, пол, заметки, дата регистрации, последний визит, CRM-ссылка, фото. Можно фильтровать по точным ID.",
      inputSchema: z.object({
        ids: z
          .array(z.string().uuid())
          .optional()
          .describe("Точные clients.id, если нужно подтянуть клиентов по связям из других таблиц"),
        search: z.string().optional().describe("Поиск по имени/фамилии/телефону/email"),
        limit: limit(500, 100),
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
        if (term) {
          q = q.or(
            `full_name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`,
          );
        }
        return listResult(q);
      },
    }),

    // ====== СОТРУДНИКИ ======
    // Сотрудники общие для студий (trainer_studios); здесь — сотрудники этой
    // студии. Банковские реквизиты и ставки ассистенту не отдаём.
    list_trainers: tool({
      description: "Сотрудники клуба (тренеры и администраторы): имя, роль, фото, Telegram.",
      inputSchema: z.object({ limit: limit(200, 100) }),
      execute: async ({ limit }) =>
        listResult(
          supabase
            .from("trainers")
            .select(
              "id, full_name, role, photo_url, telegram, created_at, trainer_studios!inner(studio_id)",
            )
            .eq("trainer_studios.studio_id", studioId)
            .limit(limit),
        ),
    }),

    // ====== ТРЕНИРОВКИ (шаблоны) ======
    list_workouts: tool({
      description: "Шаблоны тренировок клуба (название, описание, тип, фото).",
      inputSchema: z.object({ limit: limit(200, 100) }),
      execute: async ({ limit }) =>
        listResult(
          supabase
            .from("workouts")
            .select("id, name, description, type, photo_url, created_at")
            .in("studio_id", await catalogIds())
            .limit(limit),
        ),
    }),

    // ====== РАСПИСАНИЕ ======
    list_schedule: tool({
      description:
        "Расписание занятий за период (по дате начала занятия, обе даты включительно). kind: group — групповое (по тренировке workout_id), personal — персональное, other — прочая активность (название в title).",
      inputSchema: z.object({
        from: dateString("Начало периода"),
        to: dateString("Конец периода включительно"),
        limit: limit(1000, 500),
      }),
      execute: async ({ from, to, limit }) => {
        const q = supabase
          .from("schedule_entries")
          .select("id, kind, title, starts_at, ends_at, workout_id, capacity, booked_count")
          .eq("studio_id", studioId);
        return listResult(
          inPeriod(q, "starts_at", from, to).order("starts_at", { ascending: true }).limit(limit),
        );
      },
    }),

    // ====== АБОНЕМЕНТЫ (шаблоны) ======
    list_memberships: tool({
      description:
        "Шаблоны абонементов клуба: название, описание, бонусы, число посещений, срок, цена, активность, обложка, признак 'для двоих'. Можно фильтровать по точным ID.",
      inputSchema: z.object({
        ids: z
          .array(z.string().uuid())
          .optional()
          .describe(
            "Точные memberships.id, если нужно подтянуть названия по связям из client_memberships или sales",
          ),
        only_active: z.boolean().default(false),
        for_couple: z.boolean().optional(),
        limit: limit(500, 200),
      }),
      execute: async ({ ids, only_active, for_couple, limit }) => {
        let q = supabase
          .from("memberships")
          .select(
            "id, name, description, benefits, visits_count, duration_days, auto_renew, installment_enabled, price, is_active, cover_url, for_couple, created_at",
          )
          .in("studio_id", await catalogIds())
          .limit(limit);
        if (ids?.length) q = q.in("id", ids);
        if (only_active) q = q.eq("is_active", true);
        if (typeof for_couple === "boolean") q = q.eq("for_couple", for_couple);
        return listResult(q);
      },
    }),

    // ====== ВЫДАННЫЕ КЛИЕНТАМ АБОНЕМЕНТЫ ======
    list_client_memberships: tool({
      description:
        "Выданные клиентам абонементы (client_memberships). Содержит client_id, membership_id, status, started_at, ends_at, visits_left. " +
        "Статус frozen — абонемент на паузе (заморожен), он действующий. " +
        "Для вопросов «у кого скоро заканчивается абонемент» лучше используй list_expiring_client_memberships. " +
        "Для имени клиента ОБЯЗАТЕЛЬНО вызови list_clients по полученным client_id; для названия абонемента — list_memberships по membership_id. Никогда не выдумывай имена и названия.",
      inputSchema: z.object({
        status: z.enum(["active", "frozen", "replaced", "expired", "cancelled"]).optional(),
        client_id: z.string().uuid().optional(),
        expiring_within_days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe("Вернуть только записи, у которых ends_at в пределах N дней от сегодня."),
        order_by: z.enum(["created_desc", "ends_at_asc"]).default("created_desc"),
        limit: limit(500, 200),
      }),
      execute: async ({ status, client_id, expiring_within_days, order_by, limit }) => {
        let q = supabase
          .from("client_memberships")
          .select(
            "id, client_id, membership_id, sale_id, source, started_at, ends_at, visits_left, status, created_at",
          )
          .eq("studio_id", studioId)
          .limit(limit);
        q =
          order_by === "ends_at_asc"
            ? q.order("ends_at", { ascending: true, nullsFirst: false })
            : q.order("created_at", { ascending: false });
        if (status) q = q.eq("status", status);
        if (client_id) q = q.eq("client_id", client_id);
        if (expiring_within_days) {
          const today = studioToday();
          q = q.gte("ends_at", today).lte("ends_at", addDays(today, expiring_within_days));
        }
        return listResult(q);
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
        limit: limit(100, 10),
      }),
      execute: async ({ within_days, limit }) => {
        const today = studioToday();
        let q = supabase
          .from("client_memberships")
          .select(
            "id, client_id, membership_id, sale_id, source, started_at, ends_at, visits_left, status, created_at, clients(id, full_name, first_name, last_name, phone, email), memberships(id, name, visits_count, duration_days, price, is_active)",
          )
          .eq("studio_id", studioId)
          .eq("status", "active")
          .not("ends_at", "is", null)
          .gte("ends_at", today)
          .order("ends_at", { ascending: true, nullsFirst: false })
          .limit(limit);
        if (within_days) q = q.lte("ends_at", addDays(today, within_days));
        const { data, error } = await q;
        if (error) return { error: error.message };

        type Client = {
          full_name: string | null;
          first_name: string | null;
          last_name: string | null;
          phone: string | null;
          email: string | null;
        };
        type Membership = {
          name: string | null;
          visits_count: number | null;
          duration_days: number | null;
          price: number | null;
        };
        type Row = Record<string, unknown> & {
          clients: Client | Client[] | null;
          memberships: Membership | Membership[] | null;
        };

        const rows = ((data ?? []) as Row[]).map(({ clients, memberships, ...row }) => {
          const client = one(clients);
          const membership = one(memberships);
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
        "Продажи абонементов: дата, сумма, первый взнос, рассрочка, клиент, абонемент, админ, комментарий. " +
        "Фильтр по дате продажи (sold_at, обе даты включительно). total_amount — сумма продаж без учёта возвратов.",
      inputSchema: z.object({
        from: isoDate("Начало периода"),
        to: isoDate("Конец периода включительно"),
        client_id: z.string().uuid().optional(),
        limit: limit(500, 200),
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
        // sold_at — date, поэтому голые даты здесь корректны.
        if (from) q = q.gte("sold_at", from);
        if (to) q = q.lte("sold_at", to);
        if (client_id) q = q.eq("client_id", client_id);
        const res = await listResult(q);
        if ("error" in res) return res;
        return { ...res, total_amount: sum(res.rows, (r) => r.total_amount) };
      },
    }),

    // ====== КАССА ======
    list_cash_operations: tool({
      description:
        "Операции по кассе: приход/расход, категория, сумма, комментарий, дата (обе даты периода включительно).",
      inputSchema: z.object({
        kind: z.enum(["income", "expense"]).optional(),
        from: isoDate("Начало периода"),
        to: isoDate("Конец периода включительно"),
        limit: limit(500, 200),
      }),
      execute: async ({ kind, from, to, limit }) => {
        let q = supabase
          .from("cash_operations")
          .select("id, kind, category, amount, comment, occurred_at, user_id, created_at")
          .eq("studio_id", studioId);
        if (kind) q = q.eq("kind", kind);
        const res = await listResult(
          inPeriod(q, "occurred_at", from, to)
            .order("occurred_at", { ascending: false })
            .limit(limit),
        );
        if ("error" in res) return res;
        const income = sum(
          res.rows.filter((r) => r.kind === "income"),
          (r) => r.amount,
        );
        const expense = sum(
          res.rows.filter((r) => r.kind === "expense"),
          (r) => r.amount,
        );
        return {
          count: res.count,
          total_income: income,
          total_expense: expense,
          balance: income - expense,
          rows: res.rows,
        };
      },
    }),

    // ====== ПРОМОКОДЫ ======
    list_promo_codes: tool({
      description: "Промокоды клуба: имя, код, скидка, лимит, использования, срок, активность.",
      inputSchema: z.object({
        only_active: z.boolean().default(false),
        limit: limit(500, 200),
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
        return listResult(q);
      },
    }),

    // ====== НОВОСТИ ======
    // Новости, услуги и пуши выбирают клубы (studio_ids) — берём те, что
    // показываются в текущем клубе.
    list_news: tool({
      description:
        "Новости мобильного приложения, которые показываются в текущем клубе: заголовок, описание, кнопка, картинки, клубы (studio_ids).",
      inputSchema: z.object({ limit: limit(200, 100) }),
      execute: async ({ limit }) =>
        listResult(
          supabase
            .from("news")
            .select(
              "id, position, title, description, full_title, full_text, button_text, button_url, image_url, banner_url, studio_ids, created_at, updated_at",
            )
            .contains("studio_ids", [studioId])
            .limit(limit),
        ),
    }),

    // ====== УСЛУГИ ======
    list_services: tool({
      description:
        "Услуги мобильного приложения (карточки услуг), которые показываются в текущем клубе.",
      inputSchema: z.object({ limit: limit(200, 100) }),
      execute: async ({ limit }) =>
        listResult(
          supabase
            .from("services")
            .select(
              "id, position, title, description, full_title, full_text, button_text, button_url, image_url, banner_url, studio_ids, created_at",
            )
            .contains("studio_ids", [studioId])
            .limit(limit),
        ),
    }),

    // ====== ПУШ-УВЕДОМЛЕНИЯ ======
    list_push_notifications: tool({
      description:
        "Пуш-уведомления клиентам текущего клуба: заголовок, текст, action_url, сегменты, статус (draft/scheduled/sending — идёт рассылка/sent), запланировано/отправлено, метрики: recipients_count — клиентов с приложением, devices_count — их телефонов с уведомлениями, sent_count — принято службой доставки, failed_count — не дошло, delivered_count — показано на телефоне, read_count — клиентов открыли.",
      inputSchema: z.object({
        status: z.enum(["draft", "scheduled", "sending", "sent"]).optional(),
        limit: limit(500, 200),
      }),
      execute: async ({ status, limit }) => {
        let q = supabase
          .from("push_notifications")
          .select(
            "id, title, message, action_url, segments, studio_ids, status, scheduled_at, sent_at, recipients_count, devices_count, sent_count, failed_count, delivered_count, read_count, created_at, updated_at",
          )
          .contains("studio_ids", [studioId])
          .order("created_at", { ascending: false })
          .limit(limit);
        if (status) q = q.eq("status", status);
        return listResult(q);
      },
    }),

    // ====== ОБРАТНАЯ СВЯЗЬ ======
    list_feedback: tool({
      description:
        "Обратная связь от клиентов (форма в мобильном приложении и по QR-коду клуба): тема, сообщение, настроение, контакт, статус (pending/resolved), откуда (source: app — приложение, link — ссылка или QR-код, portal — добавил сотрудник).",
      inputSchema: z.object({
        status: z.enum(["pending", "resolved"]).optional(),
        topic: z
          .enum(["training", "staff", "cleanliness", "app", "idea", "thanks", "other"])
          .optional(),
        limit: limit(500, 200),
      }),
      execute: async ({ status, topic, limit }) => {
        let q = supabase
          .from("feedback")
          .select(
            "id, topic, message, mood, client_name, client_contact, status, resolved_by_name, resolved_at, resolution_comment, created_at, source",
          )
          .or(ownOrUnassigned)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (status) q = q.eq("status", status);
        if (topic) q = q.eq("topic", topic);
        return listResult(q);
      },
    }),

    // ====== NPS ======
    list_nps: tool({
      description:
        "NPS-ответы: оценка (0-10), тип опроса, комментарий, обработан ли. Период — по дате ответа, обе даты включительно.",
      inputSchema: z.object({
        survey_type: z
          .enum(["first_lessons", "first_month", "before_renewal", "after_return", "general"])
          .optional(),
        handled: z.boolean().optional(),
        from: isoDate("Начало периода"),
        to: isoDate("Конец периода включительно"),
        limit: limit(500, 200),
      }),
      execute: async ({ survey_type, handled, from, to, limit }) => {
        let q = supabase
          .from("nps_responses")
          .select("id, score, client_name, comment, language, survey_type, handled, created_at")
          .or(ownOrUnassigned);
        if (survey_type) q = q.eq("survey_type", survey_type);
        if (typeof handled === "boolean") q = q.eq("handled", handled);
        const res = await listResult(
          inPeriod(q, "created_at", from, to)
            .order("created_at", { ascending: false })
            .limit(limit),
        );
        if ("error" in res) return res;
        const scores = res.rows.map((r) => Number(r.score));
        const promoters = scores.filter((s) => s >= 9).length;
        const detractors = scores.filter((s) => s <= 6).length;
        const nps = scores.length
          ? Math.round(((promoters - detractors) / scores.length) * 100)
          : null;
        return { ...res, nps_score: nps, promoters, detractors };
      },
    }),

    // ====== ИСТОРИЯ ЗАПИСЕЙ ======
    list_bookings_log: tool({
      description:
        "История записей клиентов на тренировки: имя клиента, тренировка, тип, время, статус. " +
        "Период — по времени занятия (starts_at), обе даты включительно.",
      inputSchema: z.object({
        from: isoDate("Начало периода"),
        to: isoDate("Конец периода включительно"),
        limit: limit(500, 200),
      }),
      execute: async ({ from, to, limit }) => {
        // В bookings_log нет created_at (раньше инструмент всегда отвечал
        // ошибкой) — период и сортировка по времени занятия.
        const q = supabase.from("bookings_log").select("*").eq("studio_id", studioId);
        return listResult(
          inPeriod(q, "starts_at", from, to).order("starts_at", { ascending: false }).limit(limit),
        );
      },
    }),

    // ====== АКТИВНЫЕ БРОНИ ======
    list_schedule_bookings: tool({
      description: "Брони в расписании (schedule_bookings).",
      inputSchema: z.object({ limit: limit(500, 200) }),
      execute: async ({ limit }) =>
        listResult(
          supabase
            .from("schedule_bookings")
            .select("id, entry_id, user_id, status, created_at, cancelled_at")
            .eq("studio_id", studioId)
            .order("created_at", { ascending: false })
            .limit(limit),
        ),
    }),

    // ====== НАСТРОЙКИ КЛУБА ======
    get_club_settings: tool({
      description:
        "Контакты и правила мобильного приложения в текущем клубе: ссылки кнопок «Написать» и «Позвонить» и минуты для отмены брони. Кнопка «Фидбэк» — своя форма приложения, обращения — в list_feedback.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("studio_app_settings")
          .select("write_url, call_url, cancel_booking_minutes, updated_at")
          .eq("studio_id", studioId)
          .maybeSingle();
        if (error) return { error: error.message };
        // Строки нет — в приложении значения по умолчанию.
        return (
          data ?? {
            write_url: null,
            call_url: null,
            cancel_booking_minutes: 180,
          }
        );
      },
    }),

    // ====== СВОДКА ======
    counts_overview: tool({
      description:
        "Сводка по клубу: число клиентов, тренеров, шаблонов абонементов, активных клиентских абонементов, продаж за 30 дней, операций кассы, фидбэка, ответов NPS, новостей и услуг в приложении клуба, отправленных пушей.",
      inputSchema: z.object({}),
      execute: async () => {
        const head = { count: "exact" as const, head: true };
        const byStudio = (table: string) =>
          supabase.from(table).select("id", head).eq("studio_id", studioId);
        const queries = {
          clients: byStudio("clients"),
          trainers: supabase
            .from("trainer_studios")
            .select("trainer_id", head)
            .eq("studio_id", studioId),
          workouts: byStudio("workouts"),
          membership_plans: byStudio("memberships"),
          active_client_memberships: byStudio("client_memberships").eq("status", "active"),
          sales_last_30d: byStudio("sales").gte("sold_at", addDays(studioToday(), -30)),
          cash_operations: byStudio("cash_operations"),
          news: supabase.from("news").select("id", head).contains("studio_ids", [studioId]),
          services: supabase.from("services").select("id", head).contains("studio_ids", [studioId]),
          push_sent: supabase
            .from("push_notifications")
            .select("id", head)
            .contains("studio_ids", [studioId])
            .eq("status", "sent"),
          feedback_pending: supabase
            .from("feedback")
            .select("id", head)
            .or(ownOrUnassigned)
            .eq("status", "pending"),
          nps_responses: supabase.from("nps_responses").select("id", head).or(ownOrUnassigned),
        };
        const entries = await Promise.all(
          Object.entries(queries).map(async ([key, q]) => [key, await q] as const),
        );
        // Ошибку не превращаем в 0: модель не должна выдавать её за данные.
        const counts: Record<string, number | null> = {};
        const errors: string[] = [];
        for (const [key, { count, error }] of entries) {
          counts[key] = error ? null : (count ?? 0);
          if (error) errors.push(`${key}: ${error.message}`);
        }
        return errors.length ? { ...counts, errors } : counts;
      },
    }),
  };
}
