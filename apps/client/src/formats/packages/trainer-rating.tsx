import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AltArrowRight, HandHeart, Star } from "@solar-icons/react";
import { toast } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useT, type Translator } from "@/i18n";
import { untypedDb } from "@/lib/untyped-db";
import { cn } from "@/lib/utils";
import { myTrainerReviewsQuery } from "./trainer-comments-data";

/**
 * Рейтинг тренера и чаевые в пакетном приложении (решение владельца
 * 2026-10-11). Рейтинг — trainers.rating_avg (до сотых) и rating_count:
 * оценки из прежнего сервиса + оценки клиентов (trainer_reviews), считает
 * база (db/migrations/2026-10-11_zzzzzzzzzzzzz_trainer_ratings.sql). В
 * скобках — число оценок; «отзывы клиентов» — текстовые комментарии
 * (client_trainer_comments), их число — строкой ниже в списке тренеров
 * (решение владельца 2026-11-15). Клиент
 * ставит одну оценку тренеру и может её изменить. Чаевые — внешняя ссылка
 * trainers.tip_url (задаётся в админке, «Сотрудники»).
 */

/** 4,99 · 5 · 4,8 — до сотых, без лишних нулей (разделитель — по языку). */
export function formatRating(avg: number, t: Translator) {
  return t.number(avg, { maximumFractionDigits: 2 });
}

function ratingsLabel(n: number, t: Translator) {
  return t.plural(n, "{n} оценка|{n} оценки|{n} оценок");
}

function clientReviewsLabel(n: number, t: Translator) {
  return t.plural(n, "{n} отзыв клиента|{n} отзыва клиентов|{n} отзывов клиентов");
}

/** Золотые звёзды; дробная часть заполняет звезду частично (4,5 — половинка). */
export function RatingStars({
  value,
  className = "h-4 w-4",
}: {
  value: number;
  className?: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className={`relative inline-block shrink-0 ${className}`}>
            <Star
              weight="Bold"
              className="absolute inset-0 h-full w-full text-muted-foreground/25"
            />
            {fill > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star weight="Bold" className={`text-amber-400 ${className}`} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Строка «★★★★★ 4,99 (56 оценок)» — в списке тренеров и в карточке. С
 * `reviews` (список тренеров) — строкой ниже «N отзывов клиентов»; 0 и
 * undefined (гость, ещё грузится, ошибка) — строки нет: «нет отзывов» о
 * тренере не пишем (решение владельца 2026-11-15).
 */
export function TrainerRatingLine({
  avg,
  count,
  reviews,
  starClass,
  textClass = "text-sm",
}: {
  avg: number | null;
  count: number;
  reviews?: number;
  starClass?: string;
  textClass?: string;
}) {
  const t = useT();
  const reviewsLine = !reviews ? null : (
    <div className={`${textClass} mt-0.5 text-muted-foreground`}>
      {clientReviewsLabel(reviews, t)}
    </div>
  );
  if (avg == null || count === 0) {
    return (
      <>
        <div className={`${textClass} text-muted-foreground`}>{t("Пока нет оценок")}</div>
        {reviewsLine}
      </>
    );
  }
  return (
    <>
      <div
        className="flex items-center gap-2"
        aria-label={t("Рейтинг {value} из 5, {reviews}", {
          value: formatRating(avg, t),
          reviews: ratingsLabel(count, t),
        })}
      >
        <RatingStars value={avg} className={starClass} />
        <span className={`${textClass} text-muted-foreground tabular-nums`}>
          {formatRating(avg, t)} ({ratingsLabel(count, t)})
        </span>
      </div>
      {reviewsLine}
    </>
  );
}

/** «Поблагодарить тренера» (администратора, массажиста) — ссылка на внешний сервис чаевых. */
export function TipButton({ url, label }: { url: string; label: string }) {
  const t = useT();
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <HandHeart className="h-6 w-6" weight="BoldDuotone" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-sm text-muted-foreground">{t("Оставить чаевые")}</span>
      </span>
      <AltArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </a>
  );
}

/** Место блока «Оцените тренера», пока своя оценка не пришла, — того же размера. */
function RateTrainerSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4" aria-hidden="true">
      <Skeleton className="h-6 w-2/5" />
      <div className="mt-3 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className="p-1">
            <Skeleton className="h-9 w-9 rounded-full" />
          </span>
        ))}
      </div>
      <Skeleton className="mt-4 h-12 w-full rounded-full" />
    </div>
  );
}

/**
 * «Оцените тренера» (массажиста — title): ещё не оценивал — звёзды и
 * «Отправить»; оценил — своя оценка и «Изменить». Гостю не показывается.
 */
export function RateTrainer({ trainerId, title }: { trainerId: string; title: string }) {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState(0);

  const reviewsQuery = myTrainerReviewsQuery(user?.id ?? null);
  const { data: reviews, isPending } = useQuery(reviewsQuery);
  const mine = reviews?.[trainerId] ?? null;

  const save = useMutation({
    mutationFn: async (rating: number) => {
      const { error } = await untypedDb
        .from("trainer_reviews")
        .upsert(
          { trainer_id: trainerId, user_id: user!.id, rating },
          { onConflict: "trainer_id,user_id" },
        );
      if (error) throw error;
    },
    onSuccess: (_, rating) => {
      queryClient.setQueryData(reviewsQuery.queryKey, (old) => ({
        ...(old ?? {}),
        [trainerId]: rating,
      }));
      // Рейтинг пересчитывает база — обновляем все места, где он виден.
      queryClient.invalidateQueries({ queryKey: ["studio-trainers"] });
      queryClient.invalidateQueries({ queryKey: ["trainer-card", trainerId] });
      queryClient.invalidateQueries({ queryKey: ["pack-schedule"] });
      setEditing(false);
      toast.success(mine == null ? t("Спасибо за оценку!") : t("Оценка изменена"));
    },
    onError: () => toast.error(t("Не удалось отправить оценку. Попробуйте ещё раз.")),
  });

  if (!user) return null;
  if (isPending) return <RateTrainerSkeleton />;

  const rated = mine != null;
  const showForm = !rated || editing;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="font-semibold">{rated ? t("Ваша оценка") : title}</div>
      {showForm ? (
        <div key="form" className={editing ? "content-enter" : undefined}>
          <div
            className="mt-3 flex justify-center gap-2"
            role="radiogroup"
            aria-label={t("Оценка")}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={picked === n}
                aria-label={t("{n} из 5", { n })}
                onClick={() => setPicked(n)}
                className="p-1 active:scale-90"
              >
                {/* Звёзды загораются по очереди, слева направо. */}
                <Star
                  weight="Bold"
                  style={{ transitionDelay: n <= picked ? `${(n - 1) * 35}ms` : "0ms" }}
                  className={`h-9 w-9 transition-[color,scale] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                    n <= picked ? "scale-110 text-amber-400" : "text-muted-foreground/25"
                  }`}
                />
              </button>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            {rated && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={save.isPending}
                className={cn(buttonVariants({ variant: "outline" }), "flex-1 disabled:opacity-60")}
              >
                {t("Отмена")}
              </button>
            )}
            <button
              type="button"
              onClick={() => save.mutate(picked)}
              disabled={picked === 0 || save.isPending || (rated && picked === mine)}
              className={cn(buttonVariants(), "flex-1 disabled:opacity-60")}
            >
              {save.isPending ? t("Отправляем…") : rated ? t("Сохранить") : t("Отправить")}
            </button>
          </div>
        </div>
      ) : (
        <div key="mine" className="content-enter mt-2 flex items-center justify-between gap-3">
          <RatingStars value={mine} className="h-6 w-6" />
          <button
            type="button"
            onClick={() => {
              setPicked(mine);
              setEditing(true);
            }}
            className="text-sm font-semibold text-primary"
          >
            {t("Изменить")}
          </button>
        </div>
      )}
    </div>
  );
}
