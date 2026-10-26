import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AnalyticsShell, type AnalyticsView } from "@/components/analytics/analytics-shell";
import { EmptyBlock, KpiGrid, KpiTile, TableCard } from "@/components/analytics/parts";
import {
  AnalyticsClassesBodySkeleton,
  AnalyticsClassesPageSkeleton,
} from "@/components/page-skeletons";
import { TableSkeletonRows } from "@/components/skeletons";
import { InfoNote } from "@/components/ui/form-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/use-table-sort";
import { classesQuery } from "@/lib/analytics/data";
import { ANALYTICS_TITLES, CLASSES_TILES } from "@/lib/analytics/labels";
import {
  change,
  classesSummary,
  formatAvg,
  formatRate,
  shiftPeriod,
  workoutLines,
  type ClassesSummary,
} from "@/lib/analytics/logic";
import { formatNumber } from "@/lib/format";
import { sortRows } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/analytics/classes")({
  head: () => ({ meta: [{ title: "Занятия — Аналитика — Base40 Admin" }] }),
  pendingComponent: AnalyticsClassesPageSkeleton,
  component: ClassesPage,
});

const num = "text-right [&>span]:justify-end";

function ClassesPage() {
  return (
    <AnalyticsShell title={ANALYTICS_TITLES.classes} skeleton={<AnalyticsClassesBodySkeleton />}>
      {(view) => <ClassesBody {...view} />}
    </AnalyticsShell>
  );
}

function ClassesBody({ studios, ids, idSet, period }: AnalyticsView) {
  const cur = useQuery(classesQuery(ids, period, "month"));
  const pm = useQuery(classesQuery(ids, shiftPeriod(period, -1), "month"));
  const py = useQuery(classesQuery(ids, shiftPeriod(period, -12), "month"));
  const clubSort = useTableSort();
  const workoutSort = useTableSort();

  if (cur.isError)
    return <InfoNote variant="warning">Не удалось загрузить занятия. Обновите страницу.</InfoNote>;

  const loading = cur.isLoading;
  const s = cur.data && classesSummary(cur.data.rows, idSet);
  const sm = pm.data && classesSummary(pm.data.rows, idSet);
  const sy = py.data && classesSummary(py.data.rows, idSet);
  // Доли и средние — относительное изменение, как у Lady Stretch (не п. п.).
  const tile = (k: keyof typeof CLASSES_TILES, show: (x: ClassesSummary) => string) => (
    <KpiTile
      key={k}
      {...CLASSES_TILES[k]}
      loading={loading}
      value={s && show(s)}
      deltas={[
        { label: "к пр. месяцу", value: s && sm ? change(s[k], sm[k]) : null },
        { label: "к пр. году", value: s && sy ? change(s[k], sy[k]) : null },
      ]}
    />
  );

  const clubs = studios.map((st) => ({
    studio: st,
    x: cur.data ? classesSummary(cur.data.rows, new Set([st.id])) : null,
  }));
  const sortedClubs = clubSort.sort
    ? sortRows(clubs, clubSort.sort, {
        name: (r) => r.studio.name,
        classes: (r) => r.x?.classes,
        booked: (r) => r.x?.booked,
        attended: (r) => r.x?.attended,
        avg: (r) => r.x?.avgAttended,
        attendance: (r) => r.x?.attendance,
        fill: (r) => r.x?.fill,
        personal: (r) => r.x?.personal,
      })
    : clubs;
  const workouts = cur.data ? workoutLines(cur.data.rows, cur.data.names, idSet) : [];
  const sortedWorkouts = workoutSort.sort
    ? sortRows(workouts, workoutSort.sort, {
        name: (w) => w.name,
        classes: (w) => w.classes,
        booked: (w) => w.booked,
        attended: (w) => w.attended,
        avg: (w) => w.avgAttended,
        attendance: (w) => w.attendance,
      })
    : workouts;

  return (
    <div className="space-y-3">
      <KpiGrid cols={6}>
        {tile("classes", (x) => formatNumber(x.classes))}
        {tile("booked", (x) => formatNumber(x.booked))}
        {tile("attended", (x) => formatNumber(x.attended))}
        {tile("avgBooked", (x) => formatAvg(x.avgBooked))}
        {tile("avgAttended", (x) => formatAvg(x.avgAttended))}
        {tile("attendance", (x) => formatRate(x.attendance, 1))}
      </KpiGrid>
      <TableCard title="По клубам">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead {...clubSort.head("name")}>Клуб</TableHead>
              <TableHead
                className={num}
                tip={CLASSES_TILES.classes.tip}
                {...clubSort.head("classes")}
              >
                Занятий
              </TableHead>
              <TableHead
                className={num}
                tip={CLASSES_TILES.booked.tip}
                {...clubSort.head("booked")}
              >
                Записей
              </TableHead>
              <TableHead
                className={num}
                tip={CLASSES_TILES.attended.tip}
                {...clubSort.head("attended")}
              >
                Посещений
              </TableHead>
              <TableHead
                className={num}
                tip={CLASSES_TILES.avgAttended.tip}
                {...clubSort.head("avg")}
              >
                На занятии
              </TableHead>
              <TableHead
                className={num}
                tip={CLASSES_TILES.attendance.tip}
                {...clubSort.head("attendance")}
              >
                Доходимость
              </TableHead>
              <TableHead
                className={num}
                tip="Пришли / мест на занятиях с лимитом мест."
                {...clubSort.head("fill")}
              >
                Заполняемость
              </TableHead>
              <TableHead
                className={num}
                tip="Прошедшие персональные занятия."
                {...clubSort.head("personal")}
              >
                Персональные
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={8} rows={Math.min(studios.length, 6)} />
            ) : (
              sortedClubs.map(({ studio, x }) => (
                <TableRow key={studio.id}>
                  <TableCell className="font-medium">{studio.name}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.classes ?? 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.booked ?? 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.attended ?? 0)}</TableCell>
                  <TableCell className="text-right">{formatAvg(x?.avgAttended ?? null)}</TableCell>
                  <TableCell className="text-right">
                    {formatRate(x?.attendance ?? null, 1)}
                  </TableCell>
                  <TableCell className="text-right">{formatRate(x?.fill ?? null, 1)}</TableCell>
                  <TableCell className="text-right">{formatNumber(x?.personal ?? 0)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      <TableCard
        title="Направления"
        tip="Групповые занятия по тренировкам — сколько провели, записались и пришли."
      >
        {!loading && workouts.length === 0 ? (
          <EmptyBlock />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead {...workoutSort.head("name")}>Тренировка</TableHead>
                <TableHead className={num} {...workoutSort.head("classes")}>
                  Занятий
                </TableHead>
                <TableHead className={num} {...workoutSort.head("booked")}>
                  Записей
                </TableHead>
                <TableHead className={num} {...workoutSort.head("attended")}>
                  Посещений
                </TableHead>
                <TableHead className={num} {...workoutSort.head("avg")}>
                  На занятии
                </TableHead>
                <TableHead className={num} {...workoutSort.head("attendance")}>
                  Доходимость
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeletonRows columns={6} rows={5} />
              ) : (
                sortedWorkouts.map((w) => (
                  <TableRow key={w.key}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="text-right">{formatNumber(w.classes)}</TableCell>
                    <TableCell className="text-right">{formatNumber(w.booked)}</TableCell>
                    <TableCell className="text-right">{formatNumber(w.attended)}</TableCell>
                    <TableCell className="text-right">{formatAvg(w.avgAttended)}</TableCell>
                    <TableCell className="text-right">{formatRate(w.attendance, 1)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
