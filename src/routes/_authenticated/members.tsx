import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/members")({
  head: () => ({ meta: [{ title: "Участники — CLUB 40 Admin" }] }),
  component: () => (
    <PlaceholderPage title="Участники" description="Управление участниками клуба" />
  ),
});
