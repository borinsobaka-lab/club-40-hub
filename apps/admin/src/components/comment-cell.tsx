import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Заметка или комментарий в таблице и списке — едва тёплая подложка без
 * рамки и тени (решение владельца 2026-10-11: в таблице заметка не должна
 * перетягивать на себя внимание, только отличаться от остального текста).
 */
export const noteChipClass = "rounded-md bg-note-soft px-2 py-1";

/** Заметка в окне (обработка обратной связи) — тон поля заметки, с рамкой, без тени. */
export const noteBoxClass =
  "rounded-md border border-note-border bg-note px-3 py-2.5 text-note-foreground";

/** Заметка, которую ищут глазами (карточка клиента), — как поле заметки, с лёгкой тенью. */
export const noteCardClass = `${noteBoxClass} shadow-[var(--note-shadow)]`;

/**
 * Комментарий в ячейке таблицы: в строке — первые две строки текста, по
 * клику — весь комментарий во всплывающем окне (переносы строк сохраняются).
 * Кнопка, а не просто текст: касание по ней на телефоне не открывает меню
 * строки (RowContextMenu пропускает интерактивные элементы).
 */
export function CommentCell({ text }: { text: string | null | undefined }) {
  const value = text?.trim();
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Показать комментарий целиком"
          className={cn(
            noteChipClass,
            "line-clamp-2 min-w-[160px] max-w-[260px] cursor-pointer whitespace-pre-wrap break-words text-left hover:bg-note",
          )}
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Комментарий</div>
        <p
          className={cn(
            noteBoxClass,
            "max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm",
          )}
        >
          {value}
        </p>
      </PopoverContent>
    </Popover>
  );
}
