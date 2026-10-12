import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AltArrowRight, UsersGroupRounded } from "@solar-icons/react";

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
import { mediaUrl } from "@/lib/media";
import { trainerInitials } from "./entries";
import { AboutTab } from "./about-page";
import { studioTrainersQuery } from "./queries";
import { TrainerDrawer } from "./trainer-drawer";
import { TrainerRatingLine } from "./trainer-rating";

/**
 * «Студия» пакетного приложения (до 2026-10-11 — заглушка «Клуб»): вкладки
 * «Тренеры» (тренеры смотримой студии — переключатель на главной — с
 * биографией, рейтингом и чаевыми; «Сотрудники» в админке; карточка —
 * trainer-drawer.tsx) и «О нас» (история бренда Lady Stretch, общая для
 * студий — about-page.tsx; до 2026-10-12 здесь была «О студии» с фото,
 * картами и соцсетями каждой студии).
 */

const TABS = [
  { key: "trainers", label: "Тренеры" },
  { key: "about", label: "О нас" },
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
          <p className="text-sm text-white/70">
            {tab === "about" ? "Наша история" : (studioName ?? "Тренеры студии")}
          </p>
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
      {tab === "trainers" ? (
        <div className="p-4">
          <TrainersTab />
        </div>
      ) : (
        <AboutTab />
      )}
    </PageShell>
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
