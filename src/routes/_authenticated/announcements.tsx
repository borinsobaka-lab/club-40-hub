import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/announcements")({
  head: () => ({ meta: [{ title: "Announcements — CLUB 40 Admin" }] }),
  component: () => (
    <PlaceholderPage title="Announcements" description="Broadcast updates to members" />
  ),
});
