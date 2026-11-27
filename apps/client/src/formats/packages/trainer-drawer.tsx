import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer as DrawerPrimitive } from "vaul";

import { Button } from "@/components/ui/button";
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
import {
  MASSAGE_BOOKING_URL,
  STAFF_ROLE_TEXT,
  staffHasRating,
  staffRole,
  staffRoleLabel,
  trainerCardQuery,
  type StudioTrainer,
} from "./queries";
import { RateTrainer, TipButton, TrainerRatingLine } from "./trainer-rating";
import { TrainerComments } from "./trainer-comments";
import { myTrainerCommentQuery, publishedTrainerCommentsQuery } from "./trainer-comments-data";
import { UnderlineTabs } from "@/components/underline-tabs";
import { useAuth } from "@/hooks/use-auth";

/**
 * Карточка сотрудника пакетного приложения — шторка: фото, роль, имя,
 * рейтинг, «Поблагодарить …» (чаевые), под ними «Оцените …» (решение
 * владельца 2026-10-12: оценка выше биографии), под ней вкладки «О тренере»
 * (биография) и «Отзывы клиентов (N)» — комментарии после модерации и
 * «Оставить комментарий» (2026-11-14, trainer-comments.tsx; вкладки — там
 * же, где оценка, и только вошедшему; иначе — просто биография). У администратора
 * (2026-10-12) — без рейтинга и оценки: только описание и чаевые; массажист
 * — как тренер, плюс закреплённая внизу «Записаться на массаж» (2026-10-15,
 * MASSAGE_BOOKING_URL). Открывается из вкладок «Студии» и из окна тренировки (там —
 * вложенной шторкой, nested, поверх окна).
 *
 * Данные — trainerCardQuery по id; из списка тренеров приходят сразу
 * (initial), из окна тренировки — из уже загруженного списка сотрудников
 * (кэш «Студии»), иначе догружаются под скелетоном карточки.
 *
 * Без скачков (замечание владельца 2026-11-27): у тех, кого оценивают,
 * шторка постоянной высоты — смена вкладки и подгрузка оценки не двигают её
 * верхний край; своя оценка и отзывы запрашиваются заранее.
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
  const queryClient = useQueryClient();
  const query = useQuery({
    ...trainerCardQuery(shown.id),
    placeholderData: () =>
      shown.initial ??
      queryClient
        .getQueriesData<StudioTrainer[]>({ queryKey: ["studio-trainers"] })
        .flatMap(([, list]) => list ?? [])
        .find((x) => x.id === shown.id),
  });
  const trainer = query.data ?? null;
  const masseur = !!trainer && staffRole(trainer) === "masseur";
  // Администратора не оценивают — карточка короткая, по содержимому.
  const tall = !trainer || !!STAFF_ROLE_TEXT[staffRole(trainer)].rate;
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
          className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none ${
            tall ? "h-[90vh]" : ""
          }`}
          aria-describedby={undefined}
        >
          <div className="mx-auto mb-1 mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div
            className={
              masseur
                ? "min-h-0 grow overflow-y-auto overscroll-contain px-4 pb-6 pt-3"
                : "min-h-0 grow overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-3"
            }
          >
            {trainer ? (
              <TrainerCard key={trainer.id} trainer={trainer} />
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
                <TrainerCardSkeleton />
              </>
            )}
          </div>
          {masseur && (
            <div className="shrink-0 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button asChild className="w-full">
                <a href={MASSAGE_BOOKING_URL} target="_blank" rel="noopener noreferrer">
                  {t("Записаться на массаж")}
                </a>
              </Button>
            </div>
          )}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </Root>
  );
}

/** Болванка карточки: фото, имя и рейтинг, оценка, вкладки, текст — на своих местах. */
function TrainerCardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex items-center gap-4">
        <Skeleton className="h-[88px] w-[88px] shrink-0 rounded-3xl" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="mt-2 h-7 w-2/3" />
          <Skeleton className="mt-2.5 h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="mt-5 h-[178px] w-full rounded-2xl" />
      <div className="mt-6 flex gap-6 pt-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-36" />
      </div>
      <div className="mt-5 space-y-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

function TrainerCard({ trainer: row }: { trainer: StudioTrainer }) {
  const t = useT();
  const loc = useLocalize();
  const trainer = loc(row);
  const role = staffRole(row);
  const text = STAFF_ROLE_TEXT[role];
  const photo = mediaUrl(trainer.photo_url, "trainer-photos");
  const tipUrl = trainer.tip_url?.trim() ?? "";
  const hasTip = /^https?:\/\//i.test(tipUrl);
  const { user } = useAuth();
  // Вкладки «О тренере» / «Отзывы клиентов (N)» — там, где есть оценка, и
  // только вошедшему (отзывы читает вошедший). Число — опубликованные; тот
  // же запрос показывает их во вкладке.
  const withReviews = !!text.rate && !!user;
  const [tab, setTab] = useState<"about" | "reviews">("about");
  const reviews = useQuery({ ...publishedTrainerCommentsQuery(row.id), enabled: withReviews });
  // Свой комментарий («на модерации») — заранее: вкладка «Отзывы» откроется
  // уже с кнопкой или плашкой, без подгрузки.
  useQuery({ ...myTrainerCommentQuery(row.id, user?.id ?? null), enabled: withReviews });
  return (
    <div className="content-enter">
      <div className="flex items-center gap-4">
        <SquircleAvatar size={88} className="shrink-0">
          {photo && <SquircleAvatarImage src={photo} alt={trainer.full_name} />}
          <SquircleAvatarFallback className="bg-muted text-2xl font-semibold text-muted-foreground">
            {trainerInitials(trainer.full_name)}
          </SquircleAvatarFallback>
        </SquircleAvatar>
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{t(staffRoleLabel(row))}</div>
          <DrawerPrimitive.Title className="text-2xl font-semibold leading-tight">
            {trainer.full_name}
          </DrawerPrimitive.Title>
          {staffHasRating(role) && (
            <div className="mt-1.5">
              <TrainerRatingLine
                avg={trainer.rating_avg}
                count={trainer.rating_count}
                starClass="h-4 w-4"
              />
            </div>
          )}
        </div>
      </div>
      {hasTip && (
        <div className="mt-5">
          <TipButton url={tipUrl} label={t(text.tip)} />
        </div>
      )}
      {text.rate && (
        <div className={hasTip ? "mt-3" : "mt-5"}>
          <RateTrainer key={trainer.id} trainerId={trainer.id} title={t(text.rate)} />
        </div>
      )}
      {withReviews && (
        <UnderlineTabs
          className="mt-6"
          tabs={[
            { key: "about", label: t(text.about) },
            {
              key: "reviews",
              label:
                reviews.data === undefined
                  ? t("Отзывы клиентов")
                  : t("Отзывы клиентов ({n})", { n: reviews.data.length }),
            },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {/* key — содержимое вкладки проявляется заново при переключении. */}
      <div key={withReviews ? tab : "about"} className={withReviews ? "content-enter" : undefined}>
        {withReviews && tab === "reviews" ? (
          <div className="mt-4">
            <TrainerComments trainerId={trainer.id} />
          </div>
        ) : trainer.bio?.trim() ? (
          <FormattedText
            text={trainer.bio}
            className={
              withReviews
                ? "mt-4 text-[15px] leading-relaxed text-foreground/90"
                : "mt-5 text-[15px] leading-relaxed text-foreground/90"
            }
            linkClass="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-2"
          />
        ) : (
          <p
            className={
              withReviews
                ? "mt-4 text-sm text-muted-foreground"
                : "mt-5 text-sm text-muted-foreground"
            }
          >
            {t(text.noBio)}
          </p>
        )}
      </div>
    </div>
  );
}
