import * as React from "react";

import { FieldHint } from "@/components/ui/field-hint";
import { cn } from "@/lib/utils";

/**
 * Подписи колонок для карточного вида на телефоне. На узком экране таблица
 * перестраивается в стопку карточек (styles.css, `table[data-mobile-cards]`):
 * шапка прячется, а каждая ячейка показывает подпись своей колонки из
 * `data-label`. Подписи ставим здесь, по DOM, а не пропом в каждой из сотни
 * ячеек: так их получают все таблицы админки сразу, и новая колонка не
 * может остаться без подписи. React эти атрибуты не трогает — он не знает
 * о них, — поэтому следим за изменениями строк MutationObserver-ом.
 */
function labelCells(table: HTMLTableElement) {
  const heads = table.tHead?.rows[0]?.cells;
  if (!heads) return;
  const labels: string[] = [];
  for (const th of Array.from(heads)) {
    const text = th.textContent?.trim() ?? "";
    for (let i = 0; i < th.colSpan; i++) labels.push(text);
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        // Ячейка на всю строку — «Ничего не найдено», заглушка загрузки.
        const full = cell.colSpan >= labels.length && labels.length > 1;
        const label = full ? "" : (labels[col] ?? "");
        if (cell.dataset.label !== label) cell.dataset.label = label;
        if (full) cell.dataset.full = "";
        else delete cell.dataset.full;
        col += cell.colSpan;
      }
    }
  }
}

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & {
    /**
     * Карточки вместо строк на телефоне (по умолчанию). false — оставить
     * таблицу с горизонтальной прокруткой: для сеток, где важно сравнение по
     * колонкам.
     */
    mobileCards?: boolean;
  }
>(({ className, mobileCards = true, ...props }, ref) => {
  const innerRef = React.useRef<HTMLTableElement>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLTableElement);

  React.useEffect(() => {
    const table = innerRef.current;
    if (!mobileCards || !table) return;
    labelCells(table);
    const observer = new MutationObserver(() => labelCells(table));
    observer.observe(table, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [mobileCards]);

  return (
    <div className="relative w-full overflow-auto">
      <table
        ref={innerRef}
        data-mobile-cards={mobileCards ? "" : undefined}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
});
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  // Светло-серая заливка шапки: отделяет заголовки от строк с контентом.
  // Скругляем верхние углы, чтобы заливка не выходила за рамку обёртки таблицы.
  <thead
    ref={ref}
    className={cn(
      "bg-background [&_tr]:border-b [&>tr:first-child>th:first-child]:rounded-tl-lg [&>tr:first-child>th:last-child]:rounded-tr-lg",
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-background font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

/**
 * tip — подсказка «?» у заголовка колонки, тот же текст, что у поля формы
 * (FormField tip). Значок без текста, поэтому подпись колонки для карточек
 * на телефоне (labelCells, textContent) он не портит.
 */
const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { tip?: React.ReactNode }
>(({ className, tip, children, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 whitespace-nowrap px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  >
    {tip ? (
      <span className="inline-flex items-center gap-1">
        {children}
        <FieldHint>{tip}</FieldHint>
      </span>
    ) : (
      children
    )}
  </th>
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
