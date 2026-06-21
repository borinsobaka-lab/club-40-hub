import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bell, Gift, ChevronRight, Newspaper, Ghost, CalendarDays, BarChart3, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { mediaUrl } from "@/lib/media";
import { PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Главное — CLUB 40" },
      { name: "description", content: "Главная страница CLUB 40: новости, акции и быстрый доступ к профилю." },
    ],
  }),
  component: HomePage,
});

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}


type News = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  position: number;
};

function HomePage() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState<string>("Участник");
  const [news, setNews] = useState<News[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("clients")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = data as { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null;
        const composed = [row?.last_name, row?.first_name].filter(Boolean).join(" ").trim();
        const name =
          composed ||
          (row?.full_name as string | undefined) ||
          (user.user_metadata?.full_name as string | undefined) ||
          "Участник";
        setFullName(name);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      supabase
        .from("news")
        .select("id,title,description,image_url,position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          if (!cancelled) setNews((data as News[] | null) ?? []);
        });
    load();
    const channel = supabase
      .channel("news-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "news" },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <PageShell
      header={
        <div className="pt-2 pb-6">
          {/* Header */}
          <div className="px-4 flex items-center justify-between">
            <Link
              to="/profile"
              className="flex items-center gap-3 min-w-0 flex-1 -ml-1 rounded-xl px-1 py-1 active:bg-accent/50 transition-colors"
            >
              <Avatar className="h-11 w-11">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                  {initials(fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="font-semibold truncate">{fullName}</span>
                  <ChevronRight className="h-4 w-4 text-white/70 shrink-0" />
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                aria-label="Уведомления"
                className="h-10 w-10 rounded-full flex items-center justify-center bg-white/10 active:bg-white/20 transition-colors"
              >
                <Bell className="h-5 w-5 text-white" />
              </button>
              <button
                type="button"
                aria-label="Подарки"
                className="h-10 w-10 rounded-full flex items-center justify-center bg-white/10 active:bg-white/20 transition-colors"
              >
                <Gift className="h-5 w-5 text-white" />
              </button>
            </div>
          </div>

          {/* News */}
          <section className="mt-3">
            {news === null ? (
              <div className="flex gap-3 overflow-hidden px-4 pb-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="shrink-0 w-32 h-44 rounded-2xl bg-background/60 animate-pulse"
                  />
                ))}
              </div>
            ) : news.length === 0 ? (
              <div className="mx-4 h-44 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground gap-2 bg-background/40">
                <Newspaper className="h-6 w-6" />
                <span className="text-sm">Пока нет новостей</span>
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory no-scrollbar scroll-pl-4 scroll-pr-4">
                {news.map((n) => (
                  <Link
                    key={n.id}
                    to="/news/$newsId"
                    params={{ newsId: n.id }}
                    className="relative shrink-0 snap-start w-32 h-44 rounded-2xl overflow-hidden text-left bg-muted active:scale-[0.98] transition-transform"
                  >
                    {(() => {
                      const url = mediaUrl(n.image_url);
                      return url ? (
                        <img
                          src={url}
                          alt={n.title}
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-primary" />
                      );
                    })()}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                    <div className="absolute inset-0 flex flex-col justify-end p-2.5">
                      <div className="text-white text-xs font-semibold leading-tight">
                        {n.title}
                      </div>
                      {n.description && (
                        <div className="text-white/80 text-[10px] leading-tight mt-0.5">
                          {n.description}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      }
    >
      <div className="px-4 pt-6 pb-8 space-y-8">
        {/* Быстрые действия */}
        <section className="rounded-2xl bg-[#25262A] p-4">
          <div className="flex items-stretch justify-between gap-2">
            {[
              { icon: CalendarDays, label: "Расписание" },
              { icon: BarChart3, label: "Прогресс" },
              { icon: Target, label: "Цели" },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                className="flex flex-1 flex-col items-center gap-2 rounded-xl bg-background/50 px-2 py-3 active:bg-background/70 transition-colors"
              >
                <item.icon className="h-6 w-6 text-white" />
                <span className="text-xs text-white/80">{item.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Тренировки */}
        <section>
          <h2 className="text-2xl font-bold italic uppercase mb-3">
            Тренировки
          </h2>
          <div className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center text-center gap-3">
            <Ghost className="h-14 w-14 text-muted-foreground" strokeWidth={1.5} />
            <div className="text-sm text-muted-foreground">
              Тренировок на сегодня нет
            </div>
            <Button asChild>
              <Link to="/schedule">Забронировать тренировку</Link>
            </Button>
          </div>
        </section>

        {/* Услуги */}
        <section className="-mx-4">
          <h2 className="px-4 text-2xl font-bold italic uppercase mb-3">
            Услуги
          </h2>
          {news === null ? (
            <div className="flex gap-3 overflow-hidden pb-2">
              <div className="w-1 shrink-0" aria-hidden="true" />
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="shrink-0 w-56 h-32 rounded-2xl bg-muted animate-pulse"
                />
              ))}
              <div className="w-1 shrink-0" aria-hidden="true" />
            </div>
          ) : news.length === 0 ? (
            <div className="mx-4 h-32 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Newspaper className="h-6 w-6" />
              <span className="text-sm">Пока нет услуг</span>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar scroll-pl-4 scroll-pr-4">
              <div className="w-1 shrink-0 snap-none" aria-hidden="true" />
              {news.map((n) => (
                <div
                  key={n.id}
                  className="relative shrink-0 snap-start w-56 h-32 rounded-2xl overflow-hidden bg-muted"
                >
                  {(() => {
                    const url = mediaUrl(n.image_url);
                    return url ? (
                      <img
                        src={url}
                        alt={n.title}
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-primary" />
                    );
                  })()}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-end p-3">
                    <div className="text-white text-sm font-semibold leading-tight">
                      {n.title}
                    </div>
                    {n.description && (
                      <div className="text-white/80 text-[11px] leading-tight mt-0.5 line-clamp-1">
                        {n.description}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="w-1 shrink-0 snap-none" aria-hidden="true" />
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}

