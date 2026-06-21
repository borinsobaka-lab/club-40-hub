import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      { title: "Результаты — CLUB 40" },
      { name: "description", content: "Личные результаты, рекорды и прогресс участника CLUB 40." },
    ],
  }),
  component: ResultsPage,
});

const stats = [
  { label: "Тренировок", value: "42" },
  { label: "За месяц", value: "8" },
  { label: "PR", value: "5" },
];

const records = [
  { name: "Становая тяга", value: "140 кг", date: "12 янв" },
  { name: "Приседания", value: "120 кг", date: "05 янв" },
  { name: "Жим лёжа", value: "90 кг", date: "28 дек" },
];

function ResultsPage() {
  return (
    <PageShell
      header={
        <div className="pt-4 pb-6 px-4">
          <h1 className="text-2xl font-bold">Результаты</h1>
          <p className="text-sm text-muted-foreground">Ваш прогресс и личные рекорды</p>
        </div>
      }
    >
      <div className="p-4 space-y-5">
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="p-3 text-center">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
            </Card>
          ))}
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Личные рекорды</h2>
          <Card className="divide-y divide-border">
            {records.map((r) => (
              <div key={r.name} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.date}</div>
                </div>
                <div className="font-semibold tabular-nums">{r.value}</div>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </PageShell>
  );
}

