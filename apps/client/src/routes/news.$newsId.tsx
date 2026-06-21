import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mediaUrl } from "@/lib/media";

export const Route = createFileRoute("/news/$newsId")({
  head: () => ({
    meta: [
      { title: "Новость — CLUB 40" },
      { name: "description", content: "Новость CLUB 40." },
    ],
  }),
  component: NewsDetailPage,
});

type NewsItem = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  banner_url: string | null;
  full_title: string | null;
  full_text: string | null;
};

function NewsDetailPage() {
  const { newsId } = Route.useParams();
  const [item, setItem] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("news")
      .select("id,title,description,image_url,banner_url,full_title,full_text")
      .eq("id", newsId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setItem((data as NewsItem | null) ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [newsId]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="p-6 text-center space-y-3">
        <div className="text-lg font-semibold">Новость не найдена</div>
        <Link to="/" className="text-sm text-primary underline">
          Вернуться на главную
        </Link>
      </div>
    );
  }

  const hero = mediaUrl(item.banner_url) || mediaUrl(item.image_url);
  const title = item.full_title || item.title;

  return (
    <div className="pb-8">
      <div className="relative">
        {hero ? (
          <img
            src={hero}
            alt={title}
            className="w-full aspect-[4/3] object-cover"
          />
        ) : (
          <div className="w-full aspect-[4/3] bg-gradient-to-br from-primary/80 to-primary" />
        )}
        <Link
          to="/"
          aria-label="Назад"
          className="absolute top-3 left-3 h-9 w-9 rounded-full flex items-center justify-center bg-background/85 backdrop-blur active:bg-background transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      </div>

      <div className="px-4 mt-5 space-y-3">
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        {item.description && (
          <p className="text-muted-foreground text-base">{item.description}</p>
        )}
        {item.full_text && (
          <div className="text-foreground text-[15px] whitespace-pre-wrap leading-relaxed pt-2">
            {item.full_text}
          </div>
        )}
      </div>
    </div>
  );
}
