import type { ComponentType, ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export type RowAction = {
  label: string;
  /** Иконка из @/lib/icons — та же, что у кнопки этого действия в строке. */
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
  /** Разрушающее действие уезжает вниз за разделитель и красится destructive. */
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * Контекстное меню строки таблицы (правый клик / долгое нажатие).
 *
 * Зачем: кнопки действий стоят в последней колонке, и на узком экране до них
 * нужно горизонтально прокручивать всю таблицу. Правый клик даёт те же
 * действия из любого места строки. Кнопки в колонке остаются — меню их
 * дублирует, а не заменяет.
 *
 * Если действий нет, компонент отдаёт строку как есть: правый клик тогда
 * работает как обычно в браузере.
 */
export function RowContextMenu({
  actions,
  children,
}: {
  actions: RowAction[];
  children: ReactNode;
}) {
  const items = actions.filter(Boolean);
  if (items.length === 0) return <>{children}</>;

  const regular = items.filter((a) => !a.destructive);
  const destructive = items.filter((a) => a.destructive);

  const renderItem = (a: RowAction) => {
    const Icon = a.icon;
    return (
      <ContextMenuItem
        key={a.label}
        disabled={a.disabled}
        onSelect={a.onSelect}
        className={cn(
          "gap-2",
          a.destructive && "text-destructive focus:bg-destructive/10 focus:text-destructive",
        )}
      >
        {Icon && <Icon className="h-4 w-4" />}
        {a.label}
      </ContextMenuItem>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {regular.map(renderItem)}
        {regular.length > 0 && destructive.length > 0 && <ContextMenuSeparator />}
        {destructive.map(renderItem)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
