import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Настройки — CLUB 40 Admin" }] }),
  component: () => (
    <PlaceholderPage title="Настройки" description="Настройки рабочего пространства" />
  ),
});
