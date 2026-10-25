import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin-shell";
import { CourseBuilder, type BuilderTab } from "@/components/academy/course-builder";
import { AcademyBuilderPageSkeleton } from "@/components/page-skeletons";

const TABS: BuilderTab[] = ["content", "learners", "errors"];

// Конструктор курса; ?tab= — «Ученики» / «Ошибки» (без — «Содержание»).
export const Route = createFileRoute("/_authenticated/academy/courses/$courseId/")({
  head: () => ({ meta: [{ title: "Курс — Академия — Base40 Admin" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: BuilderTab } =>
    TABS.includes(search.tab as BuilderTab) && search.tab !== "content"
      ? { tab: search.tab as BuilderTab }
      : {},
  pendingComponent: AcademyBuilderPageSkeleton,
  component: BuilderPage,
});

function BuilderPage() {
  const { courseId } = Route.useParams();
  const { tab } = Route.useSearch();
  return (
    <AdminShell title="Курс">
      <CourseBuilder key={courseId} courseId={courseId} tab={tab ?? "content"} />
    </AdminShell>
  );
}
