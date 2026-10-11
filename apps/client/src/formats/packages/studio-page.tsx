import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Drawer as DrawerPrimitive } from "vaul";
import { AltArrowRight, MapPoint, UsersGroupRounded } from "@solar-icons/react";

import { PageShell } from "@/components/page-shell";
import { UnderlineTabs } from "@/components/underline-tabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import { untypedDb } from "@/lib/untyped-db";
import { useViewedStudioName, useViewedStudioId } from "@/hooks/use-viewed-studio";
import { FormattedText } from "@/lib/formatted-text";
import { mediaUrl } from "@/lib/media";
import { trainerInitials } from "./entries";
import { RateTrainer, TipButton, TrainerRatingLine } from "./trainer-rating";

/**
 * «Студия» пакетного приложения (до 2026-10-11 — заглушка «Клуб»): вкладки
 * «Информация» (фото, описание, карты, Instagram — studio_app_settings,
 * правятся в админке: «Мобильное приложение» → «Контакты и правила») и
 * «Тренеры» (тренеры студии с биографией, рейтингом и чаевыми —
 * «Сотрудники» в админке; рейтинг и оценка — trainer-rating.tsx).
 * Студия — смотримая (переключатель на главной).
 */

type StudioInfo = {
  about: string | null;
  photo_path: string | null;
  google_maps_url: string | null;
  yandex_maps_url: string | null;
  instagram_url: string | null;
};

type StudioTrainer = {
  id: string;
  full_name: string;
  photo_url: string | null;
  bio: string | null;
  role: string | null;
  rating_avg: number | null;
  rating_count: number;
  tip_url: string | null;
};

const TABS = [
  { key: "info", label: "Информация" },
  { key: "trainers", label: "Тренеры" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function PackagesStudioPage() {
  const [tab, setTab] = useState<TabKey>("info");
  const studioName = useViewedStudioName();

  return (
    <PageShell
      scrollKey={tab}
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-semibold">Студия</h1>
          <p className="text-sm text-white/70">{studioName ?? "О студии и тренерах"}</p>
        </div>
      }
    >
      <UnderlineTabs
        tabs={TABS}
        value={tab}
        onChange={setTab}
        className="px-4 pt-4"
        gapClass="gap-6"
      />
      <div className="p-4">{tab === "info" ? <StudioInfoTab /> : <TrainersTab />}</div>
    </PageShell>
  );
}

function StudioInfoTab() {
  const { studioId, studioReady } = useViewedStudioId();
  const { data, isPending, error } = useQuery({
    queryKey: ["studio-info", studioId],
    queryFn: async (): Promise<StudioInfo | null> => {
      const { data, error } = await untypedDb
        .from("studio_app_settings")
        .select("about, photo_path, google_maps_url, yandex_maps_url, instagram_url")
        .eq("studio_id", studioId)
        .maybeSingle();
      if (error) throw error;
      return (data as StudioInfo | null) ?? null;
    },
    enabled: studioReady && !!studioId,
  });

  if (!studioReady || (isPending && !!studioId)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (error) {
    return (
      <Card className="p-4 text-sm text-destructive">
        Не удалось загрузить информацию о студии. Обновите страницу.
      </Card>
    );
  }

  const photo = mediaUrl(data?.photo_path, "studio-photos");
  const links = [
    {
      label: "Google Карты",
      href: data?.google_maps_url,
      icon: <MapPoint className="h-5 w-5" weight="BoldDuotone" />,
    },
    {
      label: "Яндекс Карты",
      href: data?.yandex_maps_url,
      icon: <MapPoint className="h-5 w-5" weight="BoldDuotone" />,
    },
    { label: "Instagram", href: data?.instagram_url, icon: <InstagramIcon className="h-5 w-5" /> },
  ].filter((l) => !!l.href?.trim());

  if (!photo && !data?.about?.trim() && links.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Информация о студии скоро появится
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {photo && (
        <img
          src={photo}
          alt=""
          className="aspect-[16/10] w-full rounded-2xl bg-muted object-cover"
          loading="lazy"
        />
      )}
      {data?.about && (
        <FormattedText
          text={data.about}
          className="text-[15px] leading-relaxed text-foreground/90"
          linkClass="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-2"
        />
      )}
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href!.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition active:scale-[0.99]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {l.icon}
              </span>
              <span className="flex-1 font-semibold">{l.label}</span>
              <AltArrowRight className="h-5 w-5 text-muted-foreground" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function TrainersTab() {
  const { studioId, studioReady } = useViewedStudioId();
  // id, а не строка: после оценки список перезагружается с новым рейтингом.
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ["studio-trainers", studioId],
    queryFn: async (): Promise<StudioTrainer[]> => {
      const { data, error } = await untypedDb
        .from("trainer_studios")
        .select(
          "trainer:trainers(id, full_name, photo_url, bio, role, rating_avg, rating_count, tip_url)",
        )
        .eq("studio_id", studioId);
      if (error) throw error;
      return (
        ((data as unknown as { trainer: StudioTrainer | null }[] | null) ?? [])
          .map((r) => r.trainer)
          .filter((t): t is StudioTrainer => !!t && t.role !== "admin")
          // numeric приходит строкой.
          .map((t) => ({ ...t, rating_avg: t.rating_avg == null ? null : Number(t.rating_avg) }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"))
      );
    },
    enabled: studioReady && !!studioId,
  });

  if (!studioReady || (isPending && !!studioId)) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-14 w-14 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </Card>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <Card className="p-4 text-sm text-destructive">
        Не удалось загрузить тренеров. Обновите страницу.
      </Card>
    );
  }
  const open = data?.find((t) => t.id === openId) ?? null;
  if (!data || data.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <UsersGroupRounded className="h-10 w-10" weight="BoldDuotone" />
        Тренеры студии скоро появятся
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {data.map((t) => {
          const photo = mediaUrl(t.photo_url, "trainer-photos");
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenId(t.id)}
              className="w-full text-left transition active:scale-[0.99]"
            >
              <Card className="flex items-center gap-3 p-3">
                <SquircleAvatar size={56} className="shrink-0">
                  {photo && <SquircleAvatarImage src={photo} alt={t.full_name} />}
                  <SquircleAvatarFallback className="bg-muted text-base font-semibold text-muted-foreground">
                    {trainerInitials(t.full_name)}
                  </SquircleAvatarFallback>
                </SquircleAvatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">{t.full_name}</div>
                  <div className="mt-1">
                    <TrainerRatingLine
                      avg={t.rating_avg}
                      count={t.rating_count}
                      starClass="h-3.5 w-3.5"
                      textClass="text-xs"
                    />
                  </div>
                </div>
                <AltArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </Card>
            </button>
          );
        })}
      </div>

      <DrawerPrimitive.Root
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
        shouldScaleBackground
      >
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <DrawerPrimitive.Content
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
            aria-describedby={undefined}
          >
            <div className="mx-auto mb-1 mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
            {open && (
              <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-3">
                <div className="flex items-center gap-4">
                  <SquircleAvatar size={88} className="shrink-0">
                    {mediaUrl(open.photo_url, "trainer-photos") && (
                      <SquircleAvatarImage
                        src={mediaUrl(open.photo_url, "trainer-photos")!}
                        alt={open.full_name}
                      />
                    )}
                    <SquircleAvatarFallback className="bg-muted text-2xl font-semibold text-muted-foreground">
                      {trainerInitials(open.full_name)}
                    </SquircleAvatarFallback>
                  </SquircleAvatar>
                  <div className="min-w-0">
                    <div className="text-sm text-muted-foreground">Тренер</div>
                    <DrawerPrimitive.Title className="text-2xl font-semibold leading-tight">
                      {open.full_name}
                    </DrawerPrimitive.Title>
                    <div className="mt-1.5">
                      <TrainerRatingLine
                        avg={open.rating_avg}
                        count={open.rating_count}
                        starClass="h-4 w-4"
                      />
                    </div>
                  </div>
                </div>
                {/^https?:\/\//i.test(open.tip_url?.trim() ?? "") && (
                  <div className="mt-5">
                    <TipButton url={open.tip_url!.trim()} />
                  </div>
                )}
                {open.bio?.trim() ? (
                  <FormattedText
                    text={open.bio}
                    className="mt-5 text-[15px] leading-relaxed text-foreground/90"
                    linkClass="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-2"
                  />
                ) : (
                  <p className="mt-5 text-sm text-muted-foreground">
                    Рассказ о тренере скоро появится.
                  </p>
                )}
                <div className="mt-6">
                  <RateTrainer key={open.id} trainerId={open.id} />
                </div>
              </div>
            )}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
