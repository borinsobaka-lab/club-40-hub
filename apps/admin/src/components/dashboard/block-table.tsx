import type { ReactNode } from "react";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { DashboardTableSkeleton } from "@/components/page-skeletons";
import type { MetricRow } from "@/components/dashboard/metric-table";
import { FieldHint } from "@/components/ui/field-hint";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/use-table-sort";
import type { TrainerBlock } from "@/lib/dashboard-stats";
import { sortRows } from "@/lib/table-sort";
import { cn } from "@/lib/utils";

/**
 * Таблица показателей по блокам — «Тренеры» дашборда «Занятия», её
 * разбирают на созвонах. Шапка в две строки: сверху блоки («Конверсия»,
 * «Заполняемость»…), под ними столбцы блока. Свёрнутый блок — один итог
 * (доля со шкалой); нажатие на блок раскрывает столбцы, из которых итог
 * сложился, — слева от итога, на подложке блока. Блоки разделены линией.
 *
 * `summary` — строка «Весь клуб» над тренерами: на неё равняются, в
 * сортировке не участвует. Строки — как у MetricTable (`cells` / `values` по
 * ключу столбца), сортировка по клику на столбец.
 *
 * На телефоне — та же таблица с прокруткой вбок (не карточки: тренеров
 * сравнивают по столбцам), имя закреплено слева.
 */
export function BlockTable({
  nameLabel,
  blocks,
  open,
  onToggle,
  rows,
  summary,
  loading,
  error,
  emptyText = "Нет данных за период",
}: {
  nameLabel: string;
  blocks: TrainerBlock[];
  /** Раскрытые блоки. */
  open: ReadonlySet<string>;
  onToggle: (block: string) => void;
  rows: MetricRow[];
  summary?: MetricRow;
  loading: boolean;
  error?: boolean;
  emptyText?: string;
}) {
  const sort = useTableSort();
  const sortable = (key: string) => rows.some((r) => r.values && key in r.values);
  const head = (key: string) => (sortable(key) ? sort.head(key) : {});
  const active = sort.sort;
  const sorted = active
    ? [
        ...sortRows(
          rows.filter((r) => !r.muted),
          active,
          { [active.key]: (r: MetricRow) => r.values?.[active.key] },
        ),
        ...rows.filter((r) => r.muted),
      ]
    : rows;

  if (loading)
    return <DashboardTableSkeleton name={nameLabel} columns={blocks.map((b) => b.label)} />;
  if (error || rows.length === 0)
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {error ? "Не удалось загрузить данные" : emptyText}
      </div>
    );

  /** Столбцы блока по порядку: раскрытые числа, затем итог. */
  const columnsOf = (b: TrainerBlock) =>
    (open.has(b.key) ? b.details : [])
      .map((d) => ({ ...d, detail: true }))
      .concat({
        ...b.main,
        tip: "",
        detail: false,
      });

  const cellClass = (b: TrainerBlock, i: number, detail: boolean) =>
    cn(
      "text-right tabular-nums",
      i === 0 && BLOCK_EDGE,
      detail && "bg-muted/40 text-muted-foreground",
    );

  const renderRow = (row: MetricRow, isSummary = false) => (
    <TableRow
      key={row.key}
      className={cn(
        "group",
        row.muted && "text-muted-foreground",
        isSummary && "bg-muted/60 font-medium hover:bg-muted/60 [&>td]:py-2.5",
      )}
    >
      <TableCell className={cn("min-w-44 font-medium", STICKY_CELL, isSummary && "bg-muted")}>
        {row.name}
      </TableCell>
      {blocks.flatMap((b) =>
        columnsOf(b).map((c, i) => (
          <TableCell key={`${b.key}:${c.key}`} className={cellClass(b, i, c.detail)}>
            {!c.detail && b.details.length > 0 && row.cells[c.key] != null ? (
              // Итог нажимается так же, как блок в шапке, — раскрывает числа.
              <button
                type="button"
                onClick={() => onToggle(b.key)}
                aria-expanded={open.has(b.key)}
                aria-label={`${open.has(b.key) ? "Свернуть" : "Раскрыть"} блок «${b.label}»`}
                className="-m-1 rounded p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row.cells[c.key]}
              </button>
            ) : (
              (row.cells[c.key] ?? "—")
            )}
          </TableCell>
        )),
      )}
    </TableRow>
  );

  return (
    <Table mobileCards={false} className="text-[0.9rem]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead rowSpan={2} {...head("name")} className={cn("align-bottom", STICKY_CELL)}>
            {nameLabel}
          </TableHead>
          {blocks.map((b) => {
            const columns = columnsOf(b);
            const canOpen = b.details.length > 0;
            const isOpen = open.has(b.key);
            if (!canOpen)
              return (
                <TableHead
                  key={b.key}
                  rowSpan={2}
                  tip={b.tip}
                  className={cn("text-right align-bottom [&>span]:justify-end", BLOCK_EDGE)}
                  {...head(b.main.key)}
                >
                  {b.label}
                </TableHead>
              );
            return (
              <th
                key={b.key}
                colSpan={columns.length}
                className={cn(
                  "h-10 whitespace-nowrap px-2 text-right align-middle font-semibold text-foreground",
                  BLOCK_EDGE,
                  isOpen && "bg-muted/40",
                )}
              >
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToggle(b.key)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Свернуть" : "Раскрыть"} блок «${b.label}»`}
                    className="-mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isOpen ? (
                      <ChevronRight aria-hidden className="size-4" />
                    ) : (
                      <ChevronLeft aria-hidden className="size-4" />
                    )}
                    {b.label}
                  </button>
                  <FieldHint>{b.tip}</FieldHint>
                </span>
              </th>
            );
          })}
        </TableRow>
        <TableRow className="hover:bg-transparent">
          {blocks
            .filter((b) => b.details.length > 0)
            .flatMap((b) =>
              columnsOf(b).map((c, i) => (
                <TableHead
                  key={`${b.key}:${c.key}`}
                  tip={c.tip || undefined}
                  className={cn(
                    "h-8 text-right text-xs [&>span]:justify-end",
                    i === 0 && BLOCK_EDGE,
                    open.has(b.key) && "bg-muted/40",
                  )}
                  {...head(c.key)}
                >
                  {c.label}
                </TableHead>
              )),
            )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {summary && renderRow(summary, true)}
        {sorted.map((row) => renderRow(row))}
      </TableBody>
    </Table>
  );
}

/** Линия между блоками. */
const BLOCK_EDGE = "border-l";

/**
 * Закреплённое имя — непрозрачный фон и линия справа; подсветка строки при
 * наведении — тенью внутрь (как STICKY_CELL у MetricTable), без md: — на
 * телефоне таблица тоже прокручивается вбок.
 */
const STICKY_CELL =
  "sticky left-0 z-10 border-r bg-background " +
  "group-hover:shadow-[inset_0_0_0_100vmax_color-mix(in_oklab,var(--muted)_50%,transparent)]";

/**
 * Доля со шкалой и отметкой «весь клуб» на шкале: видно, выше тренер
 * среднего по клубу или ниже, не читая цифр.
 */
export function ShareMarkCell({
  value,
  text,
  color,
  mark,
}: {
  value: number;
  text: ReactNode;
  color: string;
  /** Значение клуба, % — тонкая риска на шкале. */
  mark?: number | null;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return (
    <span className="inline-flex min-w-20 flex-col items-end gap-1.5 font-medium">
      {text}
      <span className="relative h-2.5 w-full rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${clamp(value)}%`, backgroundColor: color }}
        />
        {mark != null && (
          <span
            aria-hidden
            title="Весь клуб"
            className="absolute -top-1 h-4.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/60"
            style={{ left: `${clamp(mark)}%` }}
          />
        )}
      </span>
    </span>
  );
}
