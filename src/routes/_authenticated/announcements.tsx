import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/announcements")({
  head: () => ({ meta: [{ title: "Объявления — CLUB 40 Admin" }] }),
  component: () => (
    <PlaceholderPage title="Объявления" description="Рассылка обновлений участникам" />
  ),
});
