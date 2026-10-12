import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { useViewedStudioName, useViewedStudioId } from "@/hooks/use-viewed-studio";
import { FormattedText } from "@/lib/formatted-text";
import { mediaUrl } from "@/lib/media";
import { trainerInitials } from "./entries";
import { studioInfoQuery, studioTrainersQuery } from "./queries";
import { TrainerDrawer } from "./trainer-drawer";
import { TrainerRatingLine } from "./trainer-rating";

/**
 * «Студия» пакетного приложения (до 2026-10-11 — заглушка «Клуб»): вкладки
 * «Тренеры» (тренеры студии с биографией, рейтингом и чаевыми —
 * «Сотрудники» в админке; карточка — trainer-drawer.tsx) и «О студии» (до
 * 2026-10-12 — «Информация», вторая вкладка: фото, описание, карты,
 * Instagram, WhatsApp, Messenger — studio_app_settings, правятся в админке:
 * «Мобильное приложение» → «Контакты и правила»).
 * Студия — смотримая (переключатель на главной).
 */

const TABS = [
  { key: "trainers", label: "Тренеры" },
  { key: "info", label: "О студии" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function PackagesStudioPage() {
  const [tab, setTab] = useState<TabKey>("trainers");
  const studioName = useViewedStudioName();

  return (
    // scrollKey не зависит от вкладки: иначе смена вкладки пересоздавала
    // страницу — прокрутка прыгала наверх, подчёркивание табов не перетекало.
    <PageShell
      scrollKey="studio"
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
      <div className="p-4">{tab === "trainers" ? <TrainersTab /> : <StudioInfoTab />}</div>
    </PageShell>
  );
}

function StudioInfoTab() {
  const { studioId, studioReady } = useViewedStudioId();
  const { data, isPending, error } = useQuery(studioInfoQuery(studioId, studioReady));

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
    { label: "WhatsApp", href: data?.whatsapp_url, icon: <WhatsAppIcon className="h-5 w-5" /> },
    {
      label: "Messenger",
      href: data?.messenger_url,
      icon: <MessengerIcon className="h-5 w-5" />,
    },
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
          decoding="async"
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
  const { data, isPending, error } = useQuery(studioTrainersQuery(studioId, studioReady));

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

      <TrainerDrawer trainerId={openId} initial={open} onClose={() => setOpenId(null)} />
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

function WhatsAppIcon({ className }: { className?: string }) {
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
      <path d="M3.5 20.5l1.3-4A8.5 8.5 0 1 1 8 19.6z" />
      <path d="M9 8.5c0 3.3 3.2 6.5 6.5 6.5l1-1.5-2-1-1 .8a5 5 0 0 1-2.8-2.8l.8-1-1-2z" />
    </svg>
  );
}

function MessengerIcon({ className }: { className?: string }) {
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
      <path d="M12 3c-5 0-9 3.7-9 8.4 0 2.6 1.2 4.9 3.2 6.4V21l3-1.6c.9.2 1.8.4 2.8.4 5 0 9-3.7 9-8.4S17 3 12 3z" />
      <path d="M7.5 13.5l3-3 2.2 2 3.8-2.5-3 3-2.2-2z" />
    </svg>
  );
}
