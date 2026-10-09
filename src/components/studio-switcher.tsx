import { setActiveStudioId, useActiveStudioId } from "@/hooks/use-active-studio";
import { useStudios } from "@/hooks/use-studios";
import { STUDIO_FORMAT_LABEL } from "@/lib/studio-formats";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Переключатель студий в шапке. Список — студии, где пользователь
 * сотрудник; выбор по умолчанию и брендинг держит StudioBranding в layout.
 */
export function StudioSwitcher() {
  const { data: studios = [], isLoading } = useStudios();
  const active = useActiveStudioId();

  return (
    <Select
      value={studios.some((s) => s.id === active) ? (active ?? undefined) : undefined}
      onValueChange={setActiveStudioId}
      disabled={isLoading || studios.length === 0}
    >
      {/* Тип студии — только в выпадающем списке, в шапке хватает названия. */}
      <SelectTrigger className="h-9 w-[200px] text-sm [&_.studio-format]:hidden">
        <SelectValue
          placeholder={
            isLoading ? "Загрузка…" : studios.length === 0 ? "Нет студий" : "Выберите студию"
          }
        />
      </SelectTrigger>
      <SelectContent>
        {studios.map((s) => (
          <SelectItem key={s.id} value={s.id} textValue={s.name}>
            <span className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.brand_color }}
              />
              <span className="truncate">{s.name}</span>
              {studios.length > 1 && (
                <span className="studio-format truncate text-xs text-muted-foreground">
                  {STUDIO_FORMAT_LABEL[s.format]}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
