import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bell, Gift, ChevronRight, Newspaper } from "lucide-react";
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
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const name =
          (data?.full_name as string | undefined) ||
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
                <div className="text-xs text-white/70">Профиль</div>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="font-semibold truncate">{fullName}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                aria-label="Уведомления"
                className="h-10 w-10 rounded-full flex items-center justify-center bg-background/70 active:bg-background transition-colors"
              >
                <Bell className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Подарки"
                className="h-10 w-10 rounded-full flex items-center justify-center bg-background/70 active:bg-background transition-colors"
              >
                <Gift className="h-5 w-5" />
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
      <div />
    </PageShell>
  );
}

