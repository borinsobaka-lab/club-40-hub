import { createFileRoute } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";

export const Route = createFileRoute("/_authenticated/push-triggers")({
  head: () => ({ meta: [{ title: "Триггерные уведомления — CLUB 40 Admin" }] }),
  component: PushTriggersPage,
});

function PushTriggersPage() {
  return (
    <AdminShell title="Триггерные уведомления">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-background p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Zap className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-lg font-medium">Скоро здесь появятся триггерные уведомления</div>
          <div className="max-w-md text-sm text-muted-foreground">
            Автоматические пуш-уведомления по событиям (например, окончание абонемента, новая запись).
            Раздел в разработке.
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
