import { ChevronDown, MapPin } from "lucide-react";

import { CheckboxOption } from "@/components/ui/form-field";
import { fieldTriggerClass } from "@/components/ui/field-styles";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AaLocation } from "@/lib/audio/types";
import { cn } from "@/lib/utils";

/**
 * Фильтр «Точки»: все точки или несколько. Пусто — все (в том числе новые,
 * заведённые позже). Закрытые точки — с пометкой.
 */
export function LocationsFilter({
  locations,
  selected,
  onChange,
  className,
}: {
  locations: AaLocation[];
  selected: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const picked = locations.filter((l) => selected.includes(l.id));
  const label =
    picked.length === 0
      ? "Все точки"
      : picked.length === 1
        ? picked[0].name
        : `Точки: ${picked.length}`;
  const toggle = (id: string) => {
    const ids = picked.map((l) => l.id);
    onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-field=""
          aria-label={`Точки продажи: ${label}`}
          title={picked.map((l) => l.name).join(", ") || label}
          className={cn(fieldTriggerClass, "w-48", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50 max-sm:hidden" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="space-y-0.5">
          <CheckboxOption
            checked={picked.length === 0}
            onCheckedChange={() => onChange([])}
            className="rounded-md px-2 py-1.5 font-medium hover:bg-accent"
          >
            Все точки
          </CheckboxOption>
          {locations.map((l) => (
            <CheckboxOption
              key={l.id}
              checked={selected.includes(l.id)}
              onCheckedChange={() => toggle(l.id)}
              className="rounded-md px-2 py-1.5 pl-6 hover:bg-accent"
            >
              <span className="truncate">
                {l.name}
                {!l.active && <span className="text-muted-foreground"> · закрыта</span>}
              </span>
            </CheckboxOption>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
