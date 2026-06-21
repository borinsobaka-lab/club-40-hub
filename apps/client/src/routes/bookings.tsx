import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/bookings")({
  head: () => ({
    meta: [
      { title: "Мои брони — CLUB 40" },
      { name: "description", content: "Активные и прошедшие бронирования тренировок CLUB 40." },
    ],
  }),
  component: BookingsPage,
});

const upcoming = [
  { id: 1, date: "Сегодня, 18:30", title: "CLUB 40 Classic", coach: "Дмитрий Л." },
  { id: 2, date: "Ср, 22 янв · 07:30", title: "Утренняя силовая", coach: "Иван П." },
];

function BookingsPage() {
  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-2xl font-bold">Мои брони</h1>
          <p className="text-sm text-white/70">Управляйте записями на тренировки</p>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Предстоящие</h2>
          {upcoming.map((b) => (
            <Card key={b.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{b.title}</div>
                  <div className="text-xs text-muted-foreground">{b.coach}</div>
                </div>
                <Badge>Подтверждено</Badge>
              </div>
              <div className="text-sm">{b.date}</div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="flex-1">Отменить</Button>
              </div>
            </Card>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">История</h2>
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Завершённые тренировки появятся здесь
          </Card>
        </section>
      </div>
    </PageShell>
  );
}

