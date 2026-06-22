import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Уведомления — CLUB 40" },
      { name: "description", content: "Уведомления CLUB 40." },
    ],
  }),
  component: NotificationsPage,
});

type Notification = {
  id: string;
  title: string;
  body: string;
  receivedAt: string; // ISO
  read: boolean;
};

const MOCK: Notification[] = [
  {
    id: "1",
    title: "🎉 Добро пожаловать в CLUB 40!",
    body: "Привет! Мы рады видеть тебя в клубе.\nЗагляни в раздел «Бронь» — там уже доступно расписание на ближайшие дни.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    read: false,
  },
  {
    id: "2",
    title: "🔥 Новая тренировка в расписании",
    body: "В среду в 19:00 — функциональная тренировка с Анной.\nОсталось 4 места, успей записаться!",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    read: false,
  },
  {
    id: "3",
    title: "💳 Абонемент скоро закончится",
    body: "Осталось 3 занятия по текущему абонементу.\nПродли его в разделе «Абонементы», чтобы не прерывать тренировки.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    read: true,
  },
  {
    id: "4",
    title: "📣 Новость клуба",
    body: "В эти выходные — открытая тренировка на свежем воздухе.\nПодробности в разделе новостей на главной.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    read: true,
  },
];

function formatReceivedAt(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>(MOCK);
  const unread = items.filter((i) => !i.read).length;

  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-black italic uppercase">Уведомления</h1>
          <p className="text-sm text-white/70">
            {unread > 0 ? `Непрочитанных: ${unread}` : "Все уведомления прочитаны"}
          </p>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setItems((prev) => prev.map((n) => ({ ...n, read: true })))}
            disabled={unread === 0}
            className="text-sm font-semibold text-[#1B1C1F] disabled:text-muted-foreground disabled:cursor-not-allowed active:opacity-70 transition-opacity"
          >
            Прочитать все
          </button>
        </div>

        {items.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Уведомлений пока нет
          </Card>
        ) : (
          <ul className="space-y-2">
            {items.map((n) => (
              <li key={n.id}>
                <Card
                  className={`p-4 transition-colors ${
                    n.read ? "" : "border-[#FFE500] bg-[#FFE500]/5"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#FFE500]" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold leading-snug break-words">
                        {n.title}
                      </div>
                      <p className="mt-1 text-sm text-foreground/80 whitespace-pre-line break-words">
                        {n.body}
                      </p>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {formatReceivedAt(n.receivedAt)}
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
