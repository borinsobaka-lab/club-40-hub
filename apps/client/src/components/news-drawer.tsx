import { useEffect, useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mediaUrl } from "@/lib/media";

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

  useEffect(() => {
    if (!open || !newsId) return;
    let cancelled = false;
    setLoading(true);
    setItem(null);
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
              <div className="flex justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {hero && (
                  <div className="px-4 pt-3">
                    <img
                      src={hero}
                      alt={title}
                      className="w-full h-auto rounded-2xl"
                    />
                  </div>
                )}
                <div className="px-4 pt-5 space-y-3">
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
