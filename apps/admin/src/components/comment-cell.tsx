import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
          className="line-clamp-2 min-w-[160px] max-w-[260px] cursor-pointer whitespace-pre-wrap break-words text-left text-muted-foreground hover:text-foreground"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Комментарий</div>
        <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm">{value}</p>
      </PopoverContent>
    </Popover>
  );
}
