import { type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

// Единая плашка поиска и фильтров над таблицей — один вид во всех разделах.
// Правила (см. .interface-design/system.md):
//  - всегда ОДНА строка: поиск тянется, фильтры фиксированной ширины,
//    никаких лейблов над контролами;
//  - высоту контролов НЕ задаём на месте: она одна на всю админку и приходит
//    из Input / SelectTrigger / Button (см. .interface-design/system.md);
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
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  );
}
