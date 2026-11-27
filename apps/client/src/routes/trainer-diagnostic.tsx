import { createFileRoute } from "@tanstack/react-router";

import { getTranslator } from "@/i18n";
import { APP_BRAND } from "@/lib/terms";
import { DiagnosticFormPage } from "@/formats/packages/diagnostics/form-page";

/**
 * Форма диагностики тела для тренера (пакетное приложение, 2026-11-27):
 * /trainer-diagnostic?entry=<занятие>&client=<карточка>. Кто может её
 * открыть, решает база (RPC trainer_diagnostic_form).
 */
type Search = { entry?: string; client?: string };

export const Route = createFileRoute("/trainer-diagnostic")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.entry === "string" ? { entry: search.entry } : {}),
    ...(typeof search.client === "string" ? { client: search.client } : {}),
  }),
  head: ({ match }) => {
    const t = getTranslator(match.context.locale);
    return { meta: [{ title: `${t("Диагностика тела")} — ${APP_BRAND}` }] };
  },
  component: TrainerDiagnosticRoute,
});

function TrainerDiagnosticRoute() {
  const { entry, client } = Route.useSearch();
  if (!entry || !client) return null;
  return <DiagnosticFormPage key={`${entry}:${client}`} entryId={entry} clientId={client} />;
}
