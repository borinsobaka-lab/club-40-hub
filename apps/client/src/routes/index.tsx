import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Расписание — CLUB 40" },
      { name: "description", content: "Расписание тренировок CLUB 40 на ближайшие дни." },
    ],
  }),
  component: SchedulePage,
});

const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const mockClasses = [
  { id: 1, time: "07:30", title: "Утренняя силовая", coach: "Иван П.", slots: "6 / 12" },
  { id: 2, time: "12:00", title: "Функциональная", coach: "Анна К.", slots: "3 / 10" },
  { id: 3, time: "18:30", title: "CLUB 40 Classic", coach: "Дмитрий Л.", slots: "Полно" },
  { id: 4, time: "20:00", title: "Растяжка", coach: "Мария В.", slots: "5 / 14" },
];

function SchedulePage() {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Расписание</h1>
        <p className="text-sm text-muted-foreground">Выберите день и забронируйте тренировку</p>
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
        {days.map((d, i) => (
          <button
            key={d}
            className={`flex flex-col items-center justify-center min-w-14 h-16 rounded-xl border text-sm transition-colors ${
              i === 0 ? "bg-primary text-primary-foreground border-primary" : "border-border"
            }`}
          >
            <span className="text-xs opacity-70">{d}</span>
            <span className="font-semibold">{20 + i}</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {mockClasses.map((c) => (
          <Card key={c.id} className="p-4 flex items-center gap-4">
            <div className="text-center">
              <div className="text-lg font-bold tabular-nums">{c.time}</div>
              <div className="text-[10px] uppercase text-muted-foreground">60 мин</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{c.title}</div>
              <div className="text-xs text-muted-foreground">{c.coach}</div>
              <Badge variant="secondary" className="mt-1 text-[10px]">{c.slots}</Badge>
            </div>
            <Button size="sm" disabled={c.slots === "Полно"}>
              {c.slots === "Полно" ? "Лист" : "Записаться"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
