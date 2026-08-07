import { cloneElement, type ComponentType, type ReactElement } from "react";

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
  /** Иконка из lucide-react — по смыслу действия (Pencil, Trash2, Copy, …). */
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
  /** Разрушающее действие уезжает вниз за разделитель и красится destructive. */
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * Контекстное меню строки таблицы (правый клик / долгое нажатие).
 *
 * Единственное место, где живут действия со строкой: колонки с кнопками в
 * конце строки нет — на узком экране до неё пришлось бы горизонтально
 * прокручивать всю таблицу.
 *
 * Раз видимых кнопок нет, строке нужен признак, что с ней вообще что-то можно
 * сделать: вешаем `cursor-pointer` — палец читается как «здесь есть действие»
 * и выглядит спокойнее системного курсора `context-menu`. Класс подмешивается
 * первым, поэтому собственный курсор строки его перебивает: twMerge оставляет
 * последний из конфликтующих.
 *
 * Если действий нет, компонент отдаёт строку как есть — без курсора и без
 * меню, правый клик тогда работает как обычно в браузере.
 */
export function RowContextMenu({
  actions,
  children,
}: {
  actions: RowAction[];
  children: ReactElement<{ className?: string }>;
}) {
  const items = actions.filter(Boolean);
  if (items.length === 0) return children;

  const row = cloneElement(children, {
    className: cn("cursor-pointer", children.props.className),
  });

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
        {/*
          Иконка приглушена, как в плашке фильтров: она подсказка к пункту, а
          не второй акцент рядом с текстом. У разрушающего пункта цвет не
          трогаем — иконка наследует destructive от самого пункта.
        */}
        {Icon && <Icon className={cn("h-4 w-4", !a.destructive && "text-muted-foreground")} />}
        {a.label}
      </ContextMenuItem>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {regular.map(renderItem)}
        {regular.length > 0 && destructive.length > 0 && <ContextMenuSeparator />}
        {destructive.map(renderItem)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
