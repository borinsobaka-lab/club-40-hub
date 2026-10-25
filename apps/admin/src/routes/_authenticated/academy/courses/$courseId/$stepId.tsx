import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin-shell";
import { StepEditor } from "@/components/academy/step-editor";
import { AcademyStepPageSkeleton } from "@/components/page-skeletons";

// Шаг курса в конструкторе: урок (текст) или тест (вопросы).
export const Route = createFileRoute("/_authenticated/academy/courses/$courseId/$stepId")({
  head: () => ({ meta: [{ title: "Шаг курса — Академия — Base40 Admin" }] }),
  pendingComponent: AcademyStepPageSkeleton,
  component: StepPage,
});

function StepPage() {
  const { courseId, stepId } = Route.useParams();
  return (
    <AdminShell title="Шаг курса">
      <StepEditor key={stepId} courseId={courseId} stepId={stepId} />
    </AdminShell>
  );
}
