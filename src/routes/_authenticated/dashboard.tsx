import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type Stat = {
  key: string;
  label: string;
  value: string;
  hint?: string;
};

const PLACEHOLDER_STATS: Stat[] = [
  { key: "revenue", label: "Выручка", value: "—", hint: "за период" },
  { key: "expenses", label: "Расходы", value: "—", hint: "за период" },
  { key: "signups", label: "Новые регистрации", value: "—" },
  { key: "clients", label: "Клиенты", value: "—", hint: "активные" },
  { key: "app_installs", label: "Установлено приложений", value: "—" },
  { key: "expiring", label: "Заканчивается абонементов", value: "—" },
  { key: "visits", label: "Посещений", value: "—" },
  { key: "avg_membership", label: "Средний чек за абонементы", value: "—" },
  { key: "avg_services", label: "Средний чек за услуги", value: "—" },
  { key: "avg_total", label: "Средний чек общий", value: "—" },
  { key: "debt_period", label: "Задолженность за период", value: "—" },
  { key: "debt_total", label: "Общая задолженность", value: "—" },
];

function formatRange(range: DateRange | undefined) {
  if (!range?.from) return "Выберите период";
  const from = format(range.from, "d MMM yyyy", { locale: ru });
  const to = range.to ? format(range.to, "d MMM yyyy", { locale: ru }) : from;
  return `${from} — ${to}`;
}

function DashboardPage() {
  const today = useMemo(() => new Date(), []);
  const [range, setRange] = useState<DateRange | undefined>({
    from: startOfMonth(today),
    to: endOfMonth(today),
  });
  const [open, setOpen] = useState(false);

  return (
    <AdminShell title="Дашборд" subtitle="Сводная статистика за выбранный период">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "min-w-[260px] justify-start text-left font-normal",
                  !range?.from && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {formatRange(range)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={range}
                onSelect={setRange}
                defaultMonth={range?.from ?? today}
                initialFocus
                locale={ru}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setRange({ from: startOfMonth(today), to: endOfMonth(today) })
            }
          >
            Текущий месяц
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {PLACEHOLDER_STATS.map((stat) => (
            <Card key={stat.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{stat.value}</div>
                {stat.hint && (
                  <div className="mt-1 text-xs text-muted-foreground">{stat.hint}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Графики</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-64 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              Здесь появятся графики — добавим, когда вы пришлёте список.
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
