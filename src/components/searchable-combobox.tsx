import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useFieldControl } from "@/components/ui/field-context";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComboOption = { value: string; label: string; hint?: string; searchText: string };

/**
 * Выбор из списка с поиском (клиент, абонемент, позиция каталога).
 * Собран на Command + Popover: клавиатура, фокус и позиционирование — из
 * примитивов, а не руками. Раньше компонент был скопирован в «Продажи» и
 * «Прочие продажи» — теперь один на оба раздела.
 *
 * По умолчанию фильтрует переданные options сам. С `onSearchChange` поиск
 * серверный: строка поиска уходит наверх, options — уже найденное.
 */
export function SearchableCombobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  onSearchChange,
  selectedLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  onSearchChange?: (search: string) => void;
  /** Подпись выбранного, если его нет в текущих options (серверный поиск). */
  selectedLabel?: string;
}) {
  const [open, setOpenState] = useState(false);
  const field = useFieldControl({});
  // Поле поиска при закрытии очищается (Command размонтируется) — и строку
  // серверного поиска сбрасываем вместе с ним.
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) onSearchChange?.("");
  };
  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? (value ? selectedLabel : undefined);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          {...field}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !label && "text-muted-foreground")}>
            {label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          shouldFilter={!onSearchChange}
          filter={(itemValue, search) => {
            const opt = options.find((o) => o.value === itemValue);
            if (!opt) return 0;
            return opt.searchText.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} onValueChange={onSearchChange} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={(v) => {
                    onChange(v);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">{o.hint}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
