/** Переключатель периода для статистики: готовые отрезки и две даты. */
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { activePreset, daysAgo, PERIOD_PRESETS, type Period } from "@/lib/scripts/period";

export function PeriodFilter({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  const preset = activePreset(value);
  return (
    <>
      {/* Даты заданы руками — ни один отрезок не подсвечен. */}
      <Tabs
        value={preset}
        onValueChange={(key) => {
          const p = PERIOD_PRESETS.find((x) => x.key === key);
          if (p) onChange({ from: p.from(), to: daysAgo(0) });
        }}
        className="toolbar-full"
      >
        <TabsList aria-label="Период">
          {PERIOD_PRESETS.map((p) => (
            <TabsTrigger key={p.key} value={p.key}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Input
        type="date"
        aria-label="С даты"
        className="w-40"
        value={value.from}
        max={value.to || undefined}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
      />
      <Input
        type="date"
        aria-label="По дату"
        className="w-40"
        value={value.to}
        min={value.from || undefined}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
      />
    </>
  );
}
