import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

/**
 * Строки-скелетоны для состояния загрузки таблицы: вместо одиночного спиннера
 * показываем «болванку» таблицы — высота списка не скачет, и видно, что грузится
 * именно таблица.
 *
 * Использование вместо спиннера:
 *   {loading ? <TableSkeletonRows columns={11} /> : ...}
 */
export function TableSkeletonRows({ columns, rows = 8 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <TableCell key={c} className="py-3">
              {/* Первая колонка шире — обычно это имя/название. */}
              <Skeleton className={c === 0 ? "h-4 w-40" : "h-4 w-16"} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * Скелетон для карточных списков и форм (разделы без таблицы).
 */
export function CardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mb-3 rounded-lg border bg-background p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
