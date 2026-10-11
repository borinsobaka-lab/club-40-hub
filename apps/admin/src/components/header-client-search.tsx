import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { clientName, phoneSearchTerm, sanitizeSearch } from "@/lib/format";
import { unwrap } from "@/lib/query";
import type { ClubStatus } from "@/lib/client-status";
import { cn } from "@/lib/utils";
import { fieldClass } from "@/components/ui/field-styles";
import { InputClearButton, SearchIcon } from "@/components/ui/search-input";
import { ClientCardDialog, type ClientLike } from "@/components/client-card-dialog";
import { ClubStatusBadge } from "@/components/club-status-badge";

type FoundClient = ClientLike & { club_status: ClubStatus | null };

// Те же колонки, что у раздела «Клиенты»: найденная строка сразу уходит в
// карточку клиента, второй запрос за ней не нужен.
const COLUMNS =
  "id, studio_id, user_id, full_name, first_name, last_name, phone, email, birthday, gender, " +
  "notes, registration_date, last_visit_date, crm_link, photo_url, club_status";

const LIMIT = 8;

/**
 * Условие PostgREST `.or()` для поиска клиента. Слова имени ищутся каждое
 * по отдельности: search_name — «Фамилия Имя», а набирают и «Имя Фамилия».
 */
function clientSearchFilter(term: string) {
  const words = term.split(" ");
  const name =
    words.length > 1
      ? `and(${words.map((w) => `search_name.ilike.%${w}%`).join(",")})`
      : `search_name.ilike.%${term}%`;
  return `${name},phone.ilike.%${phoneSearchTerm(term)}%,email.ilike.%${term}%`;
}

/**
 * Поиск клиента в шапке AdminShell: имя, фамилия, телефон или почта в
 * активном клубе. Выбор (клик или Enter) открывает карточку клиента — как
 * клик по имени в любой таблице. Стрелки ↑/↓ — по списку, Esc — очистить.
 */
export function HeaderClientSearch({ className }: { className?: string }) {
  const studioId = useActiveStudioId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [client, setClient] = useState<FoundClient | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const term = sanitizeSearch(useDebouncedValue(query, 250));

  const { data: found = [], isFetching } = useQuery({
    queryKey: ["clients_with_status", studioId, "header-search", term],
    queryFn: () =>
      unwrap<FoundClient[]>(
        supabase
          .from("clients_with_status")
          .select(COLUMNS)
          .eq("studio_id", studioId!)
          .or(clientSearchFilter(term))
          .order("full_name", { ascending: true })
          .limit(LIMIT),
      ),
    enabled: !!studioId && !!term,
    placeholderData: keepPreviousData,
    meta: { errorMessage: "Не удалось найти клиентов" },
  });

  const open = focused && !!sanitizeSearch(query);
  // Пока ответ по новому запросу не пришёл, keepPreviousData держит прошлый
  // список — «никого не нашли» показываем только по актуальному ответу.
  const settled = !isFetching && term === sanitizeSearch(query);

  const pick = (id: string) => {
    const c = found.find((f) => f.id === id);
    if (!c) return;
    setClient(c);
    setCardOpen(true);
    setQuery("");
    inputRef.current?.blur();
  };

  return (
    <>
      <CommandPrimitive
        shouldFilter={false}
        // Esc: сначала стирает запрос, по пустому — уводит фокус из поиска.
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          if (query) setQuery("");
          else inputRef.current?.blur();
        }}
        className={cn("relative", className)}
      >
        <SearchIcon />
        <CommandPrimitive.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={!studioId}
          inputMode="search"
          aria-label="Поиск клиента"
          placeholder={studioId ? "Поиск клиента: имя, телефон, почта" : "Сначала выберите клуб"}
          data-field=""
          // Поле как все (field-styles), только на сером: в шапке без плашки
          // фильтров иначе не видно границ поиска.
          className={cn(fieldClass, "flex bg-muted/40 pl-9 pr-9 focus-visible:bg-background")}
        />
        {query && (
          <InputClearButton onClear={() => setQuery("")}>
            {isFetching ? <Loader2 className="animate-spin" /> : undefined}
          </InputClearButton>
        )}

        {open && (
          <CommandPrimitive.List
            // Клик по строке не должен сначала снять фокус с поля: blur
            // спрятал бы список раньше, чем дошёл click.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-[min(24rem,60vh)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {found.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {settled ? "Никого не нашли" : "Ищем…"}
              </div>
            )}
            {found.map((c) => (
              <CommandPrimitive.Item
                key={c.id}
                value={c.id}
                onSelect={pick}
                className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{clientName(c)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.phone, c.email].filter(Boolean).join(" · ") || "Нет контактов"}
                  </span>
                </span>
                {c.club_status && <ClubStatusBadge status={c.club_status} className="shrink-0" />}
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
        )}
      </CommandPrimitive>

      <ClientCardDialog open={cardOpen} onOpenChange={setCardOpen} client={client} />
    </>
  );
}
