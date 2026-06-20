import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/events")({
  head: () => ({ meta: [{ title: "Мероприятия — CLUB 40 Admin" }] }),
  component: () => (
    <PlaceholderPage title="Мероприятия" description="Планирование и публикация мероприятий" />
  ),
});
