import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/_authenticated/music")({
  head: () => ({ meta: [{ title: "Музыка — CLUB 40 Admin" }] }),
  component: () => (
    <PlaceholderPage title="Музыка" description="Треки и лайн-апы" />
  ),
});
