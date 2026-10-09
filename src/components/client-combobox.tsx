import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { clientName } from "@/lib/format";
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

/**
 * Выбор клиента студии (диалоги продаж). Список грузится, только когда
 * компонент смонтирован, то есть когда открыт диалог: раньше страницы тянули
 * всех клиентов студии при каждой загрузке и каждом «Обновить» ради диалога,
 * который могут и не открыть.
 *
 * Сортировка — по full_name: это «Фамилия Имя» (так его собирают и админка,
 * и регистрация в приложении), то есть тот же порядок, что видно в списке.
 *
 * `clearable` — под списком ссылка «Убрать клиента» (продажа без клиента).
 */
export function ClientCombobox({
  studioId,
  value,
  onChange,
  placeholder = "Выбрать клиента",
  clearable = false,
}: {
  studioId: string | null;
  value: string;
  onChange: (id: string, client: ClientOption | null) => void;
  placeholder?: string;
  clearable?: boolean;
}) {
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients", studioId, "options"],
    queryFn: () =>
      unwrap<ClientOption[]>(
        supabase
          .from("clients")
          .select("id, full_name, first_name, last_name, phone, email")
          .eq("studio_id", studioId!)
          .order("full_name", { ascending: true }),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить клиентов" },
  });

  const options = useMemo(
    () =>
      clients.map((c) => ({
        value: c.id,
        label: clientName(c),
        hint: c.phone ?? c.email ?? "",
        searchText: `${clientName(c)} ${c.phone ?? ""} ${c.email ?? ""}`,
      })),
    [clients],
  );

  return (
    <>
      <SearchableCombobox
        placeholder={placeholder}
        searchPlaceholder="Поиск по имени, телефону, email"
        emptyText={isLoading ? "Загрузка…" : "Ничего не найдено"}
        value={value}
        onChange={(id) => onChange(id, clients.find((c) => c.id === id) ?? null)}
        options={options}
      />
      {clearable && value && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onChange("", null)}
        >
          Убрать клиента
        </button>
      )}
    </>
  );
}
