import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/*
 * Скелетоны админки — состояние ПЕРВОЙ загрузки: вместо пустоты, нулей или
 * спиннера по центру показываем «болванку» того, что сейчас появится, —
 * раскладка не прыгает, и видно, что именно грузится.
 *
 * Как выбрать (полная инструкция — .interface-design/system.md, «Скелетоны»):
 *   таблица ................. <TableSkeletonRows columns={N} /> в TableBody
 *   карточки / форма ........ <CardSkeleton rows={N} />
 *   плитки показателей ...... <StatCardsSkeleton count={N} />
 *   одно значение ........... <Skeleton className="h-8 w-32" /> (ui/skeleton)
 *   раздел целиком .......... <PageBodySkeleton /> внутри AdminShell
 *   страница до AdminShell .. <PageSkeleton /> (роутер, права, формат студии)
 *   весь каркас ............. <AppShellSkeleton /> (до проверки входа)
 *   меню на тёмной панели ... <MenuSkeleton /> / <RailSkeleton />
 */

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

/**
 * Плитки показателей (подпись + крупное число). Сетку раздел задаёт сам
 * через className — та же, что у настоящих плиток, иначе при загрузке
 * раскладка прыгнет.
 */
export function StatCardsSkeleton({
  count = 4,
  className = "grid grid-cols-2 gap-3 lg:grid-cols-4",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-background p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-7 w-28" />
        </div>
      ))}
    </div>
  );
}

/**
 * Тело типового раздела: плашка фильтров (TableToolbar) и таблица. Для
 * случаев, когда раздел ещё не знает, что покажет: роутер грузит код
 * страницы, права ещё не пришли, формат студии неизвестен.
 */
export function PageBodySkeleton({ columns = 6, rows = 8 }: { columns?: number; rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 sm:px-3">
        <Skeleton className="h-10 w-full max-w-96" />
        <Skeleton className="h-10 w-40 max-sm:hidden" />
        <Skeleton className="h-10 w-40 max-sm:hidden" />
      </div>
      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="flex gap-6 border-b px-4 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-3", c === 0 ? "w-24" : "w-14", c >= 3 && "max-md:hidden")}
            />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-6 border-b px-4 py-3.5 last:border-0">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn("h-4", c === 0 ? "w-40" : "w-16", c >= 3 && "max-md:hidden")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Шапка страницы как в AdminShell (та же высота и поля): заголовок и место
 * под кнопки. Без данных и хуков — можно рисовать до загрузки чего угодно.
 */
function PageHeaderSkeleton() {
  return (
    <header className="flex h-[57px] shrink-0 items-center gap-3 border-b bg-background px-3 lg:h-16 lg:px-4">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="ml-auto h-9 w-24 max-sm:hidden" />
      <Skeleton className="h-9 w-44 max-lg:hidden" />
    </header>
  );
}

/**
 * Страница целиком (шапка + тело) — на месте AdminShell, пока страницы ещё
 * нет: роутер грузит её код (defaultPendingComponent в router.tsx), права
 * сотрудника ещё не пришли (AccessGate). Боковое меню при этом настоящее —
 * оно в layout-роуте.
 */
export function PageSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <main className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6">
        <PageBodySkeleton />
      </main>
    </>
  );
}

/**
 * Пункты бокового меню на тёмной панели. Обычный Skeleton там не виден
 * (серый на тёмном), поэтому заливка — белая полупрозрачная, как подложка
 * активного пункта.
 */
export function MenuSkeleton({ items = 6 }: { items?: number }) {
  return (
    <div className="space-y-1 px-2 py-1" aria-busy="true" aria-label="Загрузка меню">
      <Skeleton className="mx-2 mb-2 mt-1 h-3 w-16 bg-white/10" />
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="size-5 shrink-0 rounded-full bg-white/10" />
          {/* Ширины фиксированные, не случайные: SSR и клиент рисуют одно и то же. */}
          <Skeleton className="h-4 bg-white/10" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Разделы рейки (иконка + подпись) на тёмном фоне — пока не пришли права. */
export function RailSkeleton({ items }: { items: number }) {
  return (
    <>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex w-full flex-col items-center gap-1.5 py-2" aria-hidden="true">
          <Skeleton className="size-5 rounded-full bg-white/10" />
          <Skeleton className="h-2.5 w-10 bg-white/10" />
        </div>
      ))}
    </>
  );
}

/**
 * Весь каркас админки — до того, как известно, что пользователь вошёл и он
 * сотрудник (pendingComponent у `_authenticated`). Повторяет разметку
 * layout-роута: рейка + меню на тёмном фоне, справа скруглённая рабочая
 * область. Хуков с данными здесь нет и быть не должно: запросы до проверки
 * входа закэшировали бы пустые ответы.
 */
export function AppShellSkeleton() {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas md:bg-sidebar md:py-1.5 md:pr-1.5">
      <div className="hidden w-[calc(var(--rail-width)+12rem)] shrink-0 md:flex">
        <div className="flex w-(--rail-width) shrink-0 flex-col border-r border-white/10 bg-rail px-1 py-4">
          <div className="my-auto flex w-full flex-col gap-1">
            <RailSkeleton items={5} />
          </div>
          <div className="flex w-full flex-col gap-1 border-t border-white/10 pt-2">
            <RailSkeleton items={2} />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="px-3 py-4">
            <Skeleton className="h-9 w-32 bg-white/10" />
          </div>
          <MenuSkeleton items={8} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas md:rounded-xl">
        <PageSkeleton />
      </div>
    </div>
  );
}
