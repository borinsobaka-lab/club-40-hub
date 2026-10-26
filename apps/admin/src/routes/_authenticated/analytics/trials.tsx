import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AnalyticsShell, type AnalyticsView } from "@/components/analytics/analytics-shell";
import { EmptyBlock, KpiGrid, KpiTile, TableCard } from "@/components/analytics/parts";
import {
  AnalyticsTrialsBodySkeleton,
  AnalyticsTrialsPageSkeleton,
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
import { useTableSort, type TableSortState } from "@/hooks/use-table-sort";
import { trialsQuery } from "@/lib/analytics/data";
import { ANALYTICS_TITLES, TRIALS_TILES } from "@/lib/analytics/labels";
import { formatRate, trialLines, trialsSummary, type TrialsSummary } from "@/lib/analytics/logic";
import { formatNumber } from "@/lib/format";
import { sortRows } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/analytics/trials")({
  head: () => ({ meta: [{ title: "Воронка пробных — Аналитика — Base40 Admin" }] }),
  pendingComponent: AnalyticsTrialsPageSkeleton,
  component: TrialsPage,
});

const num = "text-right [&>span]:justify-end";
const OPEN_TIP =
  "Пришли на пробное, ещё не купили, а 14 дней ещё не прошли — конверсия за 14 дней по ним может вырасти.";

function TrialsPage() {
  return (
    <AnalyticsShell title={ANALYTICS_TITLES.trials} skeleton={<AnalyticsTrialsBodySkeleton />}>
      {(view) => <TrialsBody {...view} />}
    </AnalyticsShell>
  );
}

/** Строка таблицы воронки: пробные → пришли → купили в день → за 14 дней. */
function FunnelCells({ x }: { x: TrialsSummary | null }) {
  return (
    <>
      <TableCell className="text-right">{formatNumber(x?.trials ?? 0)}</TableCell>
      <TableCell className="text-right">{formatNumber(x?.attended ?? 0)}</TableCell>
      <TableCell className="text-right">{formatRate(x?.attendance ?? null, 1)}</TableCell>
      <TableCell className="text-right">
        {formatNumber(x?.day0 ?? 0)}{" "}
        <span className="text-muted-foreground">· {formatRate(x?.day0Rate ?? null, 1)}</span>
      </TableCell>
      <TableCell className="text-right">
        {formatNumber(x?.d14 ?? 0)}{" "}
        <span className="text-muted-foreground">· {formatRate(x?.d14Rate ?? null, 1)}</span>
      </TableCell>
      <TableCell className="text-right">{formatNumber(x?.open ?? 0)}</TableCell>
    </>
  );
}

function FunnelHead({
  first,
  sort,
}: {
  first: string;
  sort: Pick<TableSortState, "sort" | "head">;
}) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead {...sort.head("name")}>{first}</TableHead>
        <TableHead className={num} tip={TRIALS_TILES.trials.tip} {...sort.head("trials")}>
          Пробных
        </TableHead>
        <TableHead className={num} tip={TRIALS_TILES.attended.tip} {...sort.head("attended")}>
          Пришли
        </TableHead>
        <TableHead className={num} {...sort.head("attendance")}>
          Доходимость
        </TableHead>
        <TableHead className={num} tip={TRIALS_TILES.day0.tip} {...sort.head("day0")}>
          В день
        </TableHead>
        <TableHead className={num} tip={TRIALS_TILES.d14.tip} {...sort.head("d14")}>
          За 14 дней
        </TableHead>
        <TableHead className={num} tip={OPEN_TIP} {...sort.head("open")}>
          Окно открыто
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

const getters = <T,>(name: (r: T) => string, x: (r: T) => TrialsSummary | null) => ({
  name,
  trials: (r: T) => x(r)?.trials,
  attended: (r: T) => x(r)?.attended,
  attendance: (r: T) => x(r)?.attendance,
  day0: (r: T) => x(r)?.day0Rate,
  d14: (r: T) => x(r)?.d14Rate,
  open: (r: T) => x(r)?.open,
});

function TrialsBody({ studios, ids, idSet, period }: AnalyticsView) {
  const q = useQuery(trialsQuery(ids, period, "month"));
  const clubSort = useTableSort();
  const kindSort = useTableSort();
  if (q.isError)
    return <InfoNote variant="warning">Не удалось загрузить пробные. Обновите страницу.</InfoNote>;
  const loading = q.isLoading;
  const s = q.data && trialsSummary(q.data.rows, idSet);
  const clubs = studios.map((st) => ({
    studio: st,
    x: q.data ? trialsSummary(q.data.rows, new Set([st.id])) : null,
  }));
  const kinds = q.data ? trialLines(q.data.rows, q.data.names, idSet) : [];

  return (
    <div className="space-y-3">
      <KpiGrid>
        <KpiTile {...TRIALS_TILES.trials} loading={loading} value={s && formatNumber(s.trials)} />
        <KpiTile
          {...TRIALS_TILES.attended}
          loading={loading}
          value={s && formatNumber(s.attended)}
          note={s && `${formatRate(s.attendance, 1)} от пробных`}
        />
        <KpiTile
          {...TRIALS_TILES.day0}
          loading={loading}
          value={s && formatRate(s.day0Rate, 1)}
          note={s && `${formatNumber(s.day0)} из ${formatNumber(s.attended)}`}
        />
        <KpiTile
          {...TRIALS_TILES.d14}
          loading={loading}
          value={s && formatRate(s.d14Rate, 1)}
          note={
            s &&
            `${formatNumber(s.d14)} из ${formatNumber(s.attended)}${s.open ? ` · окно открыто у ${formatNumber(s.open)}` : ""}`
          }
        />
      </KpiGrid>
      {s && s.open > 0 && (
        <InfoNote>
          У {formatNumber(s.open)} пришедших 14 дней ещё не прошли — конверсия за 14 дней
          предварительная и может вырасти.
        </InfoNote>
      )}
      <TableCard title="По клубам">
        <Table>
          <FunnelHead first="Клуб" sort={clubSort} />
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={7} rows={Math.min(studios.length, 6)} />
            ) : (
              sortRows(
                clubs,
                clubSort.sort,
                getters<(typeof clubs)[number]>(
                  (r) => r.studio.name,
                  (r) => r.x,
                ),
              ).map(({ studio, x }) => (
                <TableRow key={studio.id}>
                  <TableCell className="font-medium">{studio.name}</TableCell>
                  <FunnelCells x={x} />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      <TableCard title="Виды пробных" tip="Номенклатуры пробного занятия.">
        {!loading && kinds.length === 0 ? (
          <EmptyBlock>Пробных за период нет</EmptyBlock>
        ) : (
          <Table>
            <FunnelHead first="Пробное" sort={kindSort} />
            <TableBody>
              {loading ? (
                <TableSkeletonRows columns={7} rows={3} />
              ) : (
                sortRows(
                  kinds,
                  kindSort.sort,
                  getters<(typeof kinds)[number]>(
                    (r) => r.name,
                    (r) => r,
                  ),
                ).map((k) => (
                  <TableRow key={k.key}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <FunnelCells x={k} />
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
