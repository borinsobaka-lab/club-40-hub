import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/events")({
  head: () => ({ meta: [{ title: "Events — CLUB 40 Admin" }] }),
  component: () => <PlaceholderPage title="Events" description="Plan and publish events" />,
});
