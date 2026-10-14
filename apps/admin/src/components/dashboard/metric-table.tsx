import type { ReactNode } from "react";

import { DashboardTableSkeleton } from "@/components/page-skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Таблица показателей на дашборде: «Тренеры», «Тренировки» («Занятия»),
 * «Источники клиентов» («Маркетинг»). Первая колонка — название, дальше
 * числа по правому краю; пока данных нет — та же шапка с болванками строк
 * (DashboardTableSkeleton). На телефоне строки — карточки (ui/table).
 */

export type MetricColumn = { key: string; label: string; tip?: string };

export type MetricRow = {
  key: string;
  name: ReactNode;
  /** Значения колонок по ключу; нет значения — «—». */
  cells: Record<string, ReactNode>;
  /** Приглушённая строка («Нет ответа», «Без тренера»). */
  muted?: boolean;
};

export function MetricTable({
  nameLabel,
  columns,
  rows,
  loading,
  error,
  emptyText = "Нет данных за период",
}: {
  nameLabel: string;
  columns: MetricColumn[];
  rows: MetricRow[];
  loading: boolean;
  error?: boolean;
  emptyText?: string;
}) {
  if (loading)
    return <DashboardTableSkeleton name={nameLabel} columns={columns.map((c) => c.label)} />;
  if (error || rows.length === 0)
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {error ? "Не удалось загрузить данные" : emptyText}
      </div>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{nameLabel}</TableHead>
          {columns.map((c) => (
            <TableHead key={c.key} tip={c.tip} className="text-right [&>span]:justify-end">
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key} className={cn(row.muted && "text-muted-foreground")}>
            <TableCell className="min-w-40 font-medium">{row.name}</TableCell>
            {columns.map((c) => (
              <TableCell key={c.key} className="text-right tabular-nums">
                {row.cells[c.key] ?? "—"}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Доля со шкалой под числом: заполняемость, доходимость, конверсия. В
 * карточке на телефоне значения ячеек — по левому краю, доля тоже.
 */
export function ShareCell({ value, text, color }: { value: number; text: string; color: string }) {
  return (
    <span className="inline-flex min-w-16 flex-col items-end gap-1 max-md:items-start">
      {text}
      <span className="h-1 w-full rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
        />
      </span>
    </span>
  );
}
