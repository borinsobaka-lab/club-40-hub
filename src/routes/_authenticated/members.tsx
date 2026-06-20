import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/members")({
  head: () => ({ meta: [{ title: "Members — CLUB 40 Admin" }] }),
  component: () => <PlaceholderPage title="Members" description="Manage your club members" />,
});
