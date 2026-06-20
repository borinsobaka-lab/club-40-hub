import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Users, CalendarDays, Music2, TrendingUp } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Панель — CLUB 40 Admin" },
      { name: "description", content: "Обзор админ-панели CLUB 40." },
    ],
  }),
  component: Dashboard,
});

interface Activity {
  id: number;
  text: string;
  time: string;
}

const initialActivity: Activity[] = [
  { id: 1, text: "Новый участник Алекс Картер присоединился", time: "2 мин назад" },
  { id: 2, text: "Опубликовано мероприятие «Saturday Night Live»", time: "1 ч назад" },
  { id: 3, text: "DJ Mira добавлен в лайн-ап", time: "3 ч назад" },
  { id: 4, text: "Объявление отправлено 412 участникам", time: "Вчера" },
];

function Dashboard() {
  const [activity] = useState<Activity[]>(initialActivity);

  const stats = [
    { label: "Участники", value: "1 284", icon: Users, delta: "+24 за неделю" },
    { label: "Ближайшие мероприятия", value: "7", icon: CalendarDays, delta: "Ближайшее: пт 23:00" },
    { label: "Треки в библиотеке", value: "342", icon: Music2, delta: "+12 сегодня" },
    { label: "Вовлечённость", value: "87%", icon: TrendingUp, delta: "+4.2% м/м" },
  ];

  return (
    <AdminShell
      title="Панель"
      description="Обзор вашего клуба"
      actions={<Badge variant="secondary">Локальный предпросмотр</Badge>}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {s.label}
                </CardTitle>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{s.value}</div>
                <p className="text-xs text-muted-foreground">{s.delta}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Последние события</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-3 text-sm">
                    <span>{a.text}</span>
                    <span className="text-xs text-muted-foreground">{a.time}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Бэкенд</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Бэкенд пока не подключён. Подключите ваш внешний проект Supabase и
                замените тестовые данные на этой странице.
              </p>
              <Badge variant="outline">Ожидается внешний Supabase</Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
