import { type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

// Единая плашка поиска и фильтров над таблицей — один вид во всех разделах.
// Правила (см. .interface-design/system.md):
//  - всегда ОДНА строка: контролы компактные (h-8), поиск тянется, фильтры
//    фиксированной ширины; никаких лейблов над контролами;
//  - плашка стоит первой в контейнере страницы, сразу над таблицей;
//  - фильтры в шапку AdminShell не выносим (слот filters удалён).
export function TableToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      {children}
    </div>
  );
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full max-w-96">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8"
      />
    </div>
  );
}
