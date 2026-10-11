import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin-shell";
import { DashboardSoon, DashboardClassesPageSkeleton } from "@/components/page-skeletons";
import { DASHBOARD_TITLES } from "@/lib/dashboard-stats";

// Подраздел дашборда — показатели владелец опишет отдельно; пока заглушка.
export const Route = createFileRoute("/_authenticated/dashboard/classes")({
  head: () => ({ meta: [{ title: "Занятия — Дашборд — Base40 Admin" }] }),
  pendingComponent: DashboardClassesPageSkeleton,
  component: ClassesPage,
});

function ClassesPage() {
  return (
    <AdminShell title={DASHBOARD_TITLES.classes}>
      <DashboardSoon />
    </AdminShell>
  );
}
