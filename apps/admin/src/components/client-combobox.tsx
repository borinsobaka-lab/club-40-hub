import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { clientName, phoneSearchTerm, sanitizeSearch } from "@/lib/format";
import { unwrap } from "@/lib/query";
import { SearchableCombobox } from "@/components/searchable-combobox";

/** Клиент в выпадающем списке: имя и контакты — для подписи и поиска. */
export type ClientOption = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};

const PAGE = 50;

/**
 * Выбор клиента студии (диалоги продаж). Поиск серверный: без запроса —
 * последние зарегистрированные клиенты, с запросом — совпадения по «Фамилия
 * Имя», телефону и почте (search_name во вью clients_with_status, как в
 * разделе «Клиенты»). Целиком список клиентов не грузим: у PostgREST лимит
 * строк, и при большой базе часть клиентов в список просто не попала бы.
 *
 * `clearable` — под списком ссылка «Убрать клиента» (продажа без клиента).
 */
export function ClientCombobox({
  studioId,
  value,
  onChange,
  placeholder = "Выбрать клиента",
  clearable = false,
  initialClient = null,
}: {
  studioId: string | null;
  value: string;
  onChange: (id: string, client: ClientOption | null) => void;
  placeholder?: string;
  clearable?: boolean;
  /** Клиент, выбранный заранее: его имя видно, даже если его нет в первой странице списка. */
  initialClient?: ClientOption | null;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<ClientOption | null>(initialClient);
  const term = sanitizeSearch(useDebouncedValue(search, 250));

  const { data: clients = [], isFetching } = useQuery({
    queryKey: ["clients", studioId, "options", term],
    queryFn: () => {
      let q = supabase
        .from("clients_with_status")
        .select("id, full_name, first_name, last_name, phone, email")
        .eq("studio_id", studioId!);
      if (term) {
        q = q
          .or(
            `search_name.ilike.%${term}%,phone.ilike.%${phoneSearchTerm(term)}%,email.ilike.%${term}%`,
          )
          .order("full_name", { ascending: true });
      } else {
        q = q.order("created_at", { ascending: false });
      }
      return unwrap<ClientOption[]>(q.limit(PAGE));
    },
    enabled: !!studioId,
    placeholderData: keepPreviousData,
    meta: { errorMessage: "Не удалось загрузить клиентов" },
  });

  const options = clients.map((c) => ({
    value: c.id,
    label: clientName(c),
    hint: c.phone ?? c.email ?? "",
    searchText: "",
  }));

  return (
    <SearchableCombobox
      placeholder={placeholder}
      searchPlaceholder="Поиск по имени, телефону, email"
      emptyText={isFetching ? "Загрузка…" : "Ничего не найдено"}
      value={value}
      selectedLabel={picked && picked.id === value ? clientName(picked) : undefined}
      onSearchChange={setSearch}
      onChange={(id) => {
        const client = clients.find((c) => c.id === id) ?? null;
        setPicked(client);
        onChange(id, client);
      }}
      options={options}
      onClear={
        clearable
          ? () => {
              setPicked(null);
              onChange("", null);
            }
          : undefined
      }
    />
  );
}
