import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bell, Gift, ChevronRight, Newspaper } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

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

  return (
    <div className="pt-2">
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
            <div className="text-xs text-muted-foreground">Профиль</div>
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
            className="h-10 w-10 rounded-full flex items-center justify-center bg-accent/60 active:bg-accent transition-colors"
          >
            <Bell className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Подарки"
            className="h-10 w-10 rounded-full flex items-center justify-center bg-accent/60 active:bg-accent transition-colors"
          >
            <Gift className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Announcements */}
      <section className="mt-6">
        <h2 className="px-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Новости
        </h2>
        <div className="mt-3 flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-none">
          {ANNOUNCEMENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`relative shrink-0 snap-start w-44 h-44 rounded-2xl overflow-hidden text-left bg-gradient-to-br ${a.gradient} active:scale-[0.98] transition-transform`}
            >
              <div className="absolute inset-0 bg-black/10" />
              <div className="relative h-full w-full p-4 flex flex-col justify-end text-white">
                <div className="text-xs/4 opacity-90">{a.subtitle}</div>
                <div className="font-semibold text-base mt-1 leading-tight">
                  {a.title}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
