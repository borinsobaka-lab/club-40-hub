import { SearchableCombobox, type ComboOption } from "@/components/searchable-combobox";
import type { AudioPerson } from "@/hooks/use-audio-people";

/** Выбор человека портала (поиск по имени и почте). */
export function PersonPicker({
  people,
  value,
  onChange,
  selectedLabel,
}: {
  people: AudioPerson[];
  value: string;
  onChange: (userId: string) => void;
  selectedLabel?: string;
}) {
  const options: ComboOption[] = people
    .slice()
    .sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""))
    .map((p) => ({
      value: p.user_id,
      label: p.full_name || p.email || "Без имени",
      hint: p.full_name && p.email ? p.email : undefined,
      searchText: `${p.full_name ?? ""} ${p.email ?? ""}`,
    }));
  return (
    <SearchableCombobox
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Выберите сотрудника"
      searchPlaceholder="Имя или почта"
      emptyText="Никого не нашли"
      selectedLabel={selectedLabel}
      onClear={() => onChange("")}
    />
  );
}
