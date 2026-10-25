import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin-shell";
import { CoursePlayer } from "@/components/academy/course-player";
import { AcademyCoursePageSkeleton } from "@/components/page-skeletons";

// Прохождение курса; ?step= — открытый шаг (иначе первый непройденный).
export const Route = createFileRoute("/_authenticated/academy/my/$courseId")({
  head: () => ({ meta: [{ title: "Курс — Академия — Base40 Admin" }] }),
  validateSearch: (search: Record<string, unknown>): { step?: string } =>
    typeof search.step === "string" ? { step: search.step } : {},
  pendingComponent: AcademyCoursePageSkeleton,
  component: CoursePage,
});

function CoursePage() {
  const { courseId } = Route.useParams();
  const { step } = Route.useSearch();
  return (
    <AdminShell title="Курс">
      <CoursePlayer key={courseId} courseId={courseId} stepId={step} />
    </AdminShell>
  );
}
