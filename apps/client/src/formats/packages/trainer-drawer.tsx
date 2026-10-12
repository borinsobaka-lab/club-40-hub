import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Drawer as DrawerPrimitive } from "vaul";

import { Skeleton } from "@/components/ui/skeleton";
import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import { useLocalize, useT } from "@/i18n";
import { FormattedText } from "@/lib/formatted-text";
import { mediaUrl } from "@/lib/media";
import { trainerInitials } from "./entries";
import { trainerCardQuery, type StudioTrainer } from "./queries";
import { RateTrainer, TipButton, TrainerRatingLine } from "./trainer-rating";

/**
 * Карточка тренера пакетного приложения — шторка: фото, имя, рейтинг,
 * «Поблагодарить тренера» (чаевые), под ними «Оцените тренера» (решение
 * владельца 2026-10-12: оценка выше биографии), биография. Открывается из
 * «Студии» → «Тренеры» и из окна тренировки (там — вложенной шторкой,
 * nested, поверх окна).
 *
 * Данные — trainerCardQuery по id; из списка тренеров приходят сразу
 * (initial), из окна тренировки догружаются.
 */
export function TrainerDrawer({
  trainerId,
  initial,
  onClose,
  nested = false,
}: {
  trainerId: string | null;
  initial?: StudioTrainer | null;
  onClose: () => void;
  nested?: boolean;
}) {
  const t = useT();
  // Пока шторка закрывается (анимация), в ней остаётся последний тренер.
  const [shown, setShown] = useState<{ id: string | null; initial?: StudioTrainer | null }>({
    id: trainerId,
    initial,
  });
  if (trainerId && trainerId !== shown.id) setShown({ id: trainerId, initial });
  const query = useQuery({
    ...trainerCardQuery(shown.id),
    placeholderData: shown.initial ?? undefined,
  });
  const trainer = query.data ?? null;
  const Root = nested ? DrawerPrimitive.NestedRoot : DrawerPrimitive.Root;

  return (
    <Root
      open={trainerId !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      {...(nested ? {} : { shouldScaleBackground: true })}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DrawerPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
          aria-describedby={undefined}
        >
          <div className="mx-auto mb-1 mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-3">
            {trainer ? (
              <TrainerCard trainer={trainer} />
            ) : query.isError ? (
              <>
                <DrawerPrimitive.Title className="sr-only">{t("Тренер")}</DrawerPrimitive.Title>
                <p className="py-6 text-center text-sm text-destructive">
                  {t("Не удалось загрузить карточку тренера. Попробуйте ещё раз.")}
                </p>
              </>
            ) : (
              <>
                <DrawerPrimitive.Title className="sr-only">{t("Тренер")}</DrawerPrimitive.Title>
                <div className="flex items-center gap-4">
                  <Skeleton className="h-[88px] w-[88px] rounded-3xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-6 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
                <Skeleton className="mt-5 h-16 w-full rounded-2xl" />
              </>
            )}
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </Root>
  );
}

function TrainerCard({ trainer: row }: { trainer: StudioTrainer }) {
  const t = useT();
  const loc = useLocalize();
  const trainer = loc(row);
  const photo = mediaUrl(trainer.photo_url, "trainer-photos");
  const tipUrl = trainer.tip_url?.trim() ?? "";
  return (
    <>
      <div className="flex items-center gap-4">
        <SquircleAvatar size={88} className="shrink-0">
          {photo && <SquircleAvatarImage src={photo} alt={trainer.full_name} />}
          <SquircleAvatarFallback className="bg-muted text-2xl font-semibold text-muted-foreground">
            {trainerInitials(trainer.full_name)}
          </SquircleAvatarFallback>
        </SquircleAvatar>
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{t("Тренер")}</div>
          <DrawerPrimitive.Title className="text-2xl font-semibold leading-tight">
            {trainer.full_name}
          </DrawerPrimitive.Title>
          <div className="mt-1.5">
            <TrainerRatingLine
              avg={trainer.rating_avg}
              count={trainer.rating_count}
              starClass="h-4 w-4"
            />
          </div>
        </div>
      </div>
      {/^https?:\/\//i.test(tipUrl) && (
        <div className="mt-5">
          <TipButton url={tipUrl} />
        </div>
      )}
      <div className={/^https?:\/\//i.test(tipUrl) ? "mt-3" : "mt-5"}>
        <RateTrainer key={trainer.id} trainerId={trainer.id} />
      </div>
      {trainer.bio?.trim() ? (
        <FormattedText
          text={trainer.bio}
          className="mt-5 text-[15px] leading-relaxed text-foreground/90"
          linkClass="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-2"
        />
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          {t("Рассказ о тренере скоро появится.")}
        </p>
      )}
    </>
  );
}
