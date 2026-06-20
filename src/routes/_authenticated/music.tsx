import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/music")({
  head: () => ({ meta: [{ title: "Music — CLUB 40 Admin" }] }),
  component: () => <PlaceholderPage title="Music" description="Your tracks and lineups" />,
});
