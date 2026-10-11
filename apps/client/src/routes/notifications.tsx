import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { useNotifications } from "@/lib/notifications";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Уведомления — Base40" },
      { name: "description", content: "Уведомления Base40." },
    ],
  }),
  component: NotificationsPage,
});

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
  const { items, markRead, markAllRead } = useNotifications();
  const unread = items.filter((i) => !i.read).length;

  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-semibold">Уведомления</h1>
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
            onClick={markAllRead}
            disabled={unread === 0}
            className="text-xs font-semibold text-foreground bg-muted hover:bg-muted/80 active:bg-muted/70 disabled:opacity-60 disabled:cursor-not-allowed rounded-full px-3 py-2.5 transition-colors"
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
                      markRead(n.id);
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
                                markRead(n.id);
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
