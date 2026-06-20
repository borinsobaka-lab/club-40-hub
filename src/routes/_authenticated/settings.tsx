import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — CLUB 40 Admin" }] }),
  component: () => (
    <PlaceholderPage title="Settings" description="Configure your admin workspace" />
  ),
});
