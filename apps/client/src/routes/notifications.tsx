import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Уведомления — Base40" },
      { name: "description", content: "Уведомления Base40." },
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
  link?: string;
};

const MOCK: Notification[] = [
  {
    id: "1",
    title: "🎉 Добро пожаловать в Base40!",
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
    id: "5",
    title: "🎁 Партнёрская акция",
    body: "Скидка 20% на спортивное питание для участников Base40.\nПодробности и промокод — на сайте партнёра.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    read: false,
    link: "https://example.com/promo",
  },
  {
    id: "3",
    title: "💳 Абонемент скоро закончится",
    body: "Осталось 3 занятия по текущему абонементу.\nПродли его в разделе «Абонементы», чтобы не прерывать тренировки.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    read: true,
  },
  {
    id: "6",
    title: "📺 Новое видео на YouTube",
    body: "Разбор техники приседаний от тренера клуба.\nСмотрите по ссылке ниже.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    read: true,
    link: "https://youtube.com",
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
          <h1 className="text-3xl font-black">Уведомления</h1>
          <p className="text-sm text-white/70">
            {unread > 0 ? `Непрочитанных: ${unread}` : "Все уведомления прочитаны"}
          </p>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <div className="flex justify-end py-2">
          <button
            type="button"
            onClick={() => setItems((prev) => prev.map((n) => ({ ...n, read: true })))}
            disabled={unread === 0}
            className="text-xs font-semibold text-primary-foreground bg-muted hover:bg-muted/80 active:bg-muted/70 disabled:opacity-60 disabled:cursor-not-allowed rounded-full px-3 py-2.5 transition-colors"
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
                  onClick={() => {
                    if (!n.read) {
                      setItems((prev) =>
                        prev.map((it) => (it.id === n.id ? { ...it, read: true } : it)),
                      );
                    }
                  }}
                  className={`p-4 transition-colors ${
                    n.read ? "" : "border-primary bg-primary/5 cursor-pointer active:opacity-80"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold leading-snug break-words">{n.title}</div>
                      <p className="mt-1 text-sm text-foreground/80 whitespace-pre-line break-words">
                        {n.body}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                          {formatReceivedAt(n.receivedAt)}
                        </div>
                        {n.link && (
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!n.read) {
                                setItems((prev) =>
                                  prev.map((it) => (it.id === n.id ? { ...it, read: true } : it)),
                                );
                              }
                            }}
                            className="shrink-0 text-xs font-bold text-primary-foreground bg-primary hover:bg-primary/90 active:bg-primary/80 rounded-full px-3 py-1.5 transition-colors"
                          >
                            Перейти
                          </a>
                        )}
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
