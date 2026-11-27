import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OptionButton } from "@/components/onboarding";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useT } from "@/i18n";

import {
  TRAINER_COMMENT_MAX,
  isPendingError,
  myTrainerCommentQuery,
  publishedTrainerCommentsQuery,
  sendTrainerComment,
} from "./trainer-comments-data";

/**
 * Комментарии клиентов о тренере — вкладка «Отзывы клиентов» его карточки
 * (решение владельца 2026-11-14; вкладки — trainer-drawer.tsx): «Оставить комментарий» — от своего имени или анонимно;
 * комментарий уходит на модерацию в «Обратную связь» админки и появляется
 * здесь, когда его опубликуют. Ниже — опубликованные, новые сверху. Схема и
 * права — db/migrations/2026-11-14_client_trainer_comments.sql. Гостю не
 * показывается (опубликованные читает только вошедший, как и тренеров).
 */
export function TrainerComments({ trainerId }: { trainerId: string }) {
  const t = useT();
  const { user } = useAuth();
  const [shown, setShown] = useState(PAGE);
  const published = useQuery({ ...publishedTrainerCommentsQuery(trainerId), enabled: !!user });

  if (!user) return null;

  const items = published.data ?? [];

  return (
    <section aria-label={t("Отзывы клиентов")}>
      <CommentComposer key={trainerId} trainerId={trainerId} />

      {published.isPending ? (
        <CommentsSkeleton />
      ) : published.isError ? (
        <p className="mt-3 text-sm text-destructive">
          {t("Не удалось загрузить отзывы. Попробуйте ещё раз.")}
        </p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("Отзывов пока нет — ваш может быть первым.")}
        </p>
      ) : (
        <>
          <ul className="content-enter mt-3 space-y-2">
            {items.slice(0, shown).map((c) => (
              <li key={c.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-semibold">
                    {c.author ?? t("Анонимно")}
                  </span>
                  <time
                    dateTime={c.created_at}
                    className="shrink-0 text-muted-foreground tabular-nums"
                  >
                    {t.date(c.created_at, { day: "numeric", month: "long", year: "numeric" })}
                  </time>
                </div>
                <p className="mt-1.5 whitespace-pre-line break-words text-[15px] leading-relaxed text-foreground/90">
                  {c.message}
                </p>
              </li>
            ))}
          </ul>
          {items.length > shown && (
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() => setShown((n) => n + PAGE)}
            >
              {t("Показать ещё")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

const PAGE = 5;

/** Болванки отзывов — той же формы, что карточка отзыва: имя, дата, текст. */
function CommentsSkeleton() {
  return (
    <ul className="mt-3 space-y-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className={`mt-2 h-4 ${i === 1 ? "w-1/2" : "w-4/5"}`} />
        </li>
      ))}
    </ul>
  );
}

/**
 * «Оставить комментарий»: свёрнуто — кнопка; развёрнуто — текст, «От своего
 * имени / Анонимно», «Отправить». Пока предыдущий на модерации — вместо
 * кнопки плашка «Ваш комментарий на модерации» (второй база не примет).
 */
function CommentComposer({ trainerId }: { trainerId: string }) {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = useQuery(myTrainerCommentQuery(trainerId, user?.id ?? null));

  const send = useMutation({
    mutationFn: () => sendTrainerComment({ trainerId, message, anonymous }),
    onSuccess: () => {
      setOpen(false);
      setMessage("");
      setAnonymous(false);
      toast.success(t("Спасибо! Комментарий появится в карточке после проверки."));
    },
    onError: (e) => {
      if (isPendingError(e)) {
        setOpen(false);
        toast.error(t("Предыдущий комментарий об этом тренере ещё на модерации."));
        return;
      }
      toast.error(t("Не удалось отправить комментарий. Попробуйте ещё раз."));
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["trainer-comment-mine", trainerId] }),
  });

  // Место кнопки «Оставить комментарий» занято сразу — список под ней не прыгает.
  if (mine.isPending) return <Skeleton className="h-12 w-full rounded-full" aria-hidden="true" />;

  if (mine.data?.status === "pending") {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm">
        <div className="font-semibold">{t("Ваш комментарий на модерации")}</div>
        <p className="mt-1 text-muted-foreground">
          {t("Он появится в карточке тренера, как только его проверят.")}
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        {t("Оставить комментарий")}
      </Button>
    );
  }

  const submit = () => {
    if (!message.trim()) {
      setError(t("Напишите комментарий"));
      return;
    }
    setError(null);
    send.mutate();
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="content-enter rounded-2xl border border-border bg-card p-4"
    >
      <label htmlFor={`trainer-comment-${trainerId}`} className="font-semibold">
        {t("Ваш комментарий")}
      </label>
      <Textarea
        id={`trainer-comment-${trainerId}`}
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          if (error) setError(null);
        }}
        maxLength={TRAINER_COMMENT_MAX}
        rows={4}
        autoFocus
        placeholder={t("Что вам понравилось в тренировках, что хотелось бы изменить")}
        aria-invalid={!!error}
        aria-describedby={error ? `trainer-comment-error-${trainerId}` : undefined}
        className="mt-2 text-base"
      />
      {error && (
        <p id={`trainer-comment-error-${trainerId}`} className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={t("Подпись")}>
        <OptionButton soft active={!anonymous} onClick={() => setAnonymous(false)}>
          {t("От своего имени")}
        </OptionButton>
        <OptionButton soft active={anonymous} onClick={() => setAnonymous(true)}>
          {t("Анонимно")}
        </OptionButton>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {anonymous
          ? t(
              "Комментарий опубликуется без имени: его не будет ни в карточке тренера, ни у студии.",
            )
          : t("Под комментарием будет ваше имя и первая буква фамилии.")}{" "}
        {t("Перед публикацией комментарий проверит студия.")}
      </p>

      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={send.isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          {t("Отмена")}
        </Button>
        <Button type="submit" className="flex-1" disabled={send.isPending}>
          {send.isPending ? t("Отправляем…") : t("Отправить")}
        </Button>
      </div>
    </form>
  );
}
