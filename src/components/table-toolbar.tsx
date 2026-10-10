import { type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Единая плашка поиска и фильтров над таблицей — один вид во всех разделах.
// Правила (см. .interface-design/system.md):
//  - одна строка, на узком экране фильтры переносятся (flex-wrap); поиск
//    тянется, фильтры фиксированной ширины, никаких лейблов над контролами;
//  - высоту контролов НЕ задаём на месте: она одна на всю админку и приходит
//    из Input / SelectTrigger / Button (см. .interface-design/system.md);
//  - плашка стоит первой в контейнере страницы, сразу над таблицей;
//  - фильтры в шапку AdminShell не выносим (слот filters удалён);
//  - на телефоне (до sm) поиск — на всю ширину, фильтры — по два в строку
//    (правило .table-toolbar в styles.css: фиксированные w-40/w-48 там не
//    помещались парой и вставали по одному в неровную колонку).
export function TableToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="table-toolbar flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 sm:px-3">
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
    <div className="toolbar-search relative w-full max-w-96">
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

/**
 * «Сбросить» фильтры — одна на все плашки: ghost с крестиком, видна только
 * когда есть что сбрасывать (раньше в одном разделе показывалась всегда, в
 * другом — только при фильтре, в третьем была маленькой).
 */
export function ToolbarReset({ active, onReset }: { active: boolean; onReset: () => void }) {
  if (!active) return null;
  return (
    <Button variant="ghost" onClick={onReset}>
      <X />
      Сбросить
    </Button>
  );
}
