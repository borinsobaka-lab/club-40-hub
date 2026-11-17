import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdmin, hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { isBotLead, leadProblem, parseLead } from "@/lib/crm/leads";

// Приём заявок с форм сайта (CRM.md, «Источники»): форма шлёт сюда поля
// (JSON, обычная форма или multipart — свой сайт, Tilda и другие
// конструкторы), сервер заводит контакт и сделку (crm_lead_submit).
// Адрес формы с её ключом — «Настройки» → «Источники». Открыт для любого
// сайта (CORS *): ключ формы и есть разрешение; от потока — предел частоты
// с одного адреса и скрытое поле-ловушка.
const MAX_BODY_BYTES = 32 * 1024;
const TOKEN = /^[0-9a-f]{32}$/;
const PER_MINUTE = 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

// Заявки с одного адреса: не больше PER_MINUTE в минуту (память процесса —
// от случайного потока; настоящую защиту даёт прокси).
const hits = new Map<string, number[]>();
function tooMany(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000)
    for (const [k, v] of hits) if (now - v[v.length - 1] > 60_000) hits.delete(k);
  return recent.length > PER_MINUTE;
}

async function readFields(request: Request): Promise<Record<string, unknown> | null> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of form) if (typeof v === "string") out[k] = v;
    return out;
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  if (type.includes("application/json") || text.trimStart().startsWith("{")) {
    try {
      const json: unknown = JSON.parse(text);
      return json && typeof json === "object" && !Array.isArray(json)
        ? (json as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export const Route = createFileRoute("/api/crm/lead/$token")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request, params }) => {
        if (!hasSupabaseAdmin()) return reply({ error: "not_configured" }, 503);
        if (!TOKEN.test(params.token)) return reply({ error: "not_found" }, 404);
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
          return reply({ error: "too_large" }, 413);
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("x-real-ip")?.trim() ||
          "unknown";
        if (tooMany(ip)) return reply({ error: "too_many_requests" }, 429);

        let fields: Record<string, unknown> | null;
        try {
          fields = await readFields(request);
        } catch {
          fields = null;
        }
        if (!fields) return reply({ error: "bad_request" }, 400);
        // Проверка адреса конструктором (Tilda шлёт test=test) и роботы —
        // «принято», сделки нет.
        if (fields.test === "test" || isBotLead(fields)) return reply({ ok: true });
        const lead = parseLead(fields);
        // Страница не пришла полем — берём, откуда отправлена форма.
        lead.page ??= request.headers.get("referer")?.slice(0, 1000) ?? null;
        const problem = leadProblem(lead);
        if (problem) return reply({ error: "invalid", message: problem }, 400);

        const { error } = await getSupabaseAdmin().rpc("crm_lead_submit", {
          p_token: params.token,
          p_data: lead,
        });
        if (error) {
          if (/crm_form_not_found/.test(error.message)) return reply({ error: "not_found" }, 404);
          if (/crm_lead_empty/.test(error.message))
            return reply({ error: "invalid", message: "Укажите телефон или почту" }, 400);
          console.error("[crm] заявка с формы:", error.message);
          return reply({ error: "server_error" }, 503);
        }
        return reply({ ok: true });
      },
    },
  },
});
