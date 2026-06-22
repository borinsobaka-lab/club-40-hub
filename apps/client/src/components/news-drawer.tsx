import { useEffect, useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { supabase } from "@/integrations/supabase/client";
import { mediaUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

type NewsFull = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  banner_url: string | null;
  full_title: string | null;
  full_text: string | null;
};

export function NewsDrawer({
  newsId,
  open,
  onOpenChange,
}: {
  newsId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [item, setItem] = useState<NewsFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (!open || !newsId) return;
    let cancelled = false;
    setLoading(true);
    setItem(null);
    setImgLoaded(false);
    supabase
      .from("news")
      .select("id,title,description,image_url,banner_url,full_title,full_text")
      .eq("id", newsId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setItem((data as NewsFull | null) ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, newsId]);

  const hero = mediaUrl(item?.banner_url) || mediaUrl(item?.image_url);
  const title = item?.full_title || item?.title || "";

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DrawerPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex h-[88vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
          aria-describedby={undefined}
        >
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="flex-1 overflow-y-auto overscroll-contain pb-10">
            {loading || !item ? (
              <>
                <div className="px-3 pt-1">
                  <div className="w-full aspect-[4/3] rounded-2xl bg-muted animate-pulse" />
                </div>
                <div className="px-3 pt-4 space-y-3">
                  <div className="h-7 w-3/4 rounded-md bg-muted animate-pulse" />
                  <div className="h-4 w-full rounded-md bg-muted animate-pulse" />
                  <div className="h-4 w-5/6 rounded-md bg-muted animate-pulse" />
                  <div className="h-4 w-2/3 rounded-md bg-muted animate-pulse" />
                </div>
              </>
            ) : (
              <>
                {hero && (
                  <div className="px-3 pt-1">
                    <div className="relative w-full">
                      {!imgLoaded && (
                        <div className="w-full aspect-[4/3] rounded-2xl bg-muted animate-pulse" />
                      )}
                      <img
                        src={hero}
                        alt={title}
                        onLoad={() => setImgLoaded(true)}
                        onError={() => setImgLoaded(true)}
                        className={cn(
                          "w-full h-auto rounded-2xl transition-opacity duration-200",
                          imgLoaded ? "opacity-100" : "opacity-0 absolute inset-0",
                        )}
                      />
                    </div>
                  </div>
                )}
                <div className="px-3 pt-3 space-y-3">
                  <DrawerPrimitive.Title className="text-2xl font-bold leading-tight">
                    {title}
                  </DrawerPrimitive.Title>
                  {item.full_text && (
                    <div className="text-foreground text-[15px] whitespace-pre-wrap leading-relaxed pt-2">
                      {item.full_text}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
