import { createFileRoute } from "@tanstack/react-router";

import { KbNodePage } from "@/components/kb/kb-node-page";
import { KbNodePageSkeleton } from "@/components/page-skeletons";

// Главная базы знаний: описание и разделы верхнего уровня; дерево — в меню слева.
export const Route = createFileRoute("/_authenticated/kb/$baseId/")({
  head: () => ({ meta: [{ title: "База знаний — Base40 Admin" }] }),
  pendingComponent: KbNodePageSkeleton,
  component: KbBaseHome,
});

function KbBaseHome() {
  const { baseId } = Route.useParams();
  return <KbNodePage key={baseId} baseId={baseId} nodeId={null} />;
}
