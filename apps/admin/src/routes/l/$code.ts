import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdmin, hasSupabaseAdmin } from "@/integrations/supabase/client.server";
import { linkRedirectUrl, type LinkTarget } from "@/lib/crm/leads";

// Ссылка с меткой CRM (CRM.md, «Источники»): /l/<код> считает переход и
// ведёт в WhatsApp, к Telegram-боту или на сайт. Адрес открыт всем — это
// ссылка для рекламы, листовок и QR-кодов; куда вести, задано в
// «Настройках» → «Источники» (чужой адрес подставить нельзя).
const CODE = /^[a-z0-9]{4,16}$/i;

const notFound = () =>
  new Response("Ссылка не найдена или выключена", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/l/$code")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!hasSupabaseAdmin() || !CODE.test(params.code)) return notFound();
        const { data, error } = await getSupabaseAdmin().rpc("crm_link_click", {
          p_code: params.code,
        });
        if (error) console.error("[crm] ссылка с меткой:", error.message);
        const url = data ? linkRedirectUrl(data as LinkTarget) : null;
        if (!url) return notFound();
        return new Response(null, {
          status: 302,
          headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
        });
      },
    },
  },
});
