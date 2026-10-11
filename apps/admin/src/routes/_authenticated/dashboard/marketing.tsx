import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin-shell";
import { DashboardSoon, DashboardMarketingPageSkeleton } from "@/components/page-skeletons";
import { DASHBOARD_TITLES } from "@/lib/dashboard-stats";

// Подраздел дашборда — показатели владелец опишет отдельно; пока заглушка.
export const Route = createFileRoute("/_authenticated/dashboard/marketing")({
  head: () => ({ meta: [{ title: "Маркетинг — Дашборд — Base40 Admin" }] }),
  pendingComponent: DashboardMarketingPageSkeleton,
  component: MarketingPage,
});

function MarketingPage() {
  return (
    <AdminShell title={DASHBOARD_TITLES.marketing}>
      <DashboardSoon />
    </AdminShell>
  );
}
