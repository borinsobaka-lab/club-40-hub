import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin-shell";
import { KateChat } from "@/components/kate-chat";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({ meta: [{ title: "Kate — AI ассистент" }] }),
  component: AssistantPage,
});

function AssistantPage() {
  return (
    <AdminShell title="KATE — AI АССИСТЕНТ">
      <KateChat />
    </AdminShell>
  );
}
