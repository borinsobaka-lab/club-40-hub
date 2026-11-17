import { Building2, ChevronDown } from "lucide-react";

import { CheckboxOption } from "@/components/ui/form-field";
import { fieldTriggerClass } from "@/components/ui/field-styles";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Studio } from "@/hooks/use-studios";
import { clubsLabel, toggleAll, toggleClub } from "@/lib/dashboard-clubs";
import { cn } from "@/lib/utils";

/**
 * Фильтр «Клубы» дашборда: поле со списком клубов. Отметить можно несколько
 * клубов или «Все клубы» (логика — lib/dashboard-clubs.ts).
 */
export function ClubsFilter({
  clubs,
  selected,
  activeId,
  onChange,
}: {
  /** Клубы, где сотруднику открыт дашборд. */
  clubs: Studio[];
  selected: string[];
  /** Клуб из шапки — остаётся, когда снимают «Все клубы». */
  activeId: string | null;
  onChange: (ids: string[]) => void;
}) {
  const first = clubs.find((c) => c.id === selected[0]);
  const label = clubsLabel(clubs, selected);
  const all = clubs.length > 0 && clubs.every((c) => selected.includes(c.id));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-field=""
          aria-label={`Клубы: ${label}`}
          title={label}
          className={cn(fieldTriggerClass, "w-full")}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected.length === 1 && first ? (
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: first.brand_color }}
              />
            ) : (
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50 max-sm:hidden" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="space-y-0.5">
          {/* Один клуб — «все» не нужны: это он сам. */}
          {clubs.length > 1 && (
            <CheckboxOption
              checked={all}
              onCheckedChange={() => onChange(toggleAll(clubs, selected, activeId))}
              className="rounded-md px-2 py-1.5 font-medium hover:bg-accent"
            >
              Все клубы
            </CheckboxOption>
          )}
          {clubs.map((club) => (
            <CheckboxOption
              key={club.id}
              checked={selected.includes(club.id)}
              onCheckedChange={() => onChange(toggleClub(clubs, selected, club.id))}
              className={cn("rounded-md px-2 py-1.5 hover:bg-accent", clubs.length > 1 && "pl-6")}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: club.brand_color }}
                />
                <span className="truncate">{club.name}</span>
              </span>
            </CheckboxOption>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
