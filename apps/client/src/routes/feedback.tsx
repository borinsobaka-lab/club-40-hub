import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AltArrowLeft, Refresh } from "@solar-icons/react";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { OptionButton } from "@/components/onboarding";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useViewedStudioId } from "@/hooks/use-viewed-studio";
import { clientCardQuery } from "@/lib/client-card";
import {
  FEEDBACK_LIMITS,
  FEEDBACK_MOODS,
  FEEDBACK_TOPICS,
  feedbackStudiosQuery,
  parseFeedbackSearch,
  submitFeedback,
  type FeedbackMood,
  type FeedbackTopic,
} from "@/lib/feedback";
import { IS_PACKAGES } from "@/lib/terms";
import { cn } from "@/lib/utils";
import { getTranslator, useLocalize, useT } from "@/i18n";

/**
 * Обратная связь (решение владельца 2026-10-15) — своя форма вместо внешнего
 * сервиса: кнопка «Фидбэк» на главной. Открывается и без входа — по ссылке
 * или QR-коду клуба из админки (`/feedback?studio=<id>`, PUBLIC_ROUTES в
 * __root.tsx); студия из ссылки подставляется, выбор студии не показывается.
 * Обращение уходит в раздел «Обратная связь» админки (lib/feedback.ts).
 * Язык — языка приложения; переключатель — только без входа (посетитель по
 * QR-коду ещё не выбирал язык).
 */
export const Route = createFileRoute("/feedback")({
  validateSearch: parseFeedbackSearch,
  head: ({ match }) => {
    const t = getTranslator(match.context.locale);
    return {
      meta: [
        { title: t("Обратная связь — Base40") },
        {
          name: "description",
          content: t("Расскажите, что понравилось и что можно улучшить."),
        },
      ],
    };
  },
  component: FeedbackPage,
});

type Errors = Partial<Record<"studio" | "topic" | "message", string>>;

function FeedbackPage() {
  const t = useT();
  const loc = useLocalize();
  const { session, user } = useAuth();
  const search = Route.useSearch();
  const { studioId: viewedStudioId } = useViewedStudioId();
  const { data: studios = [], isLoading: studiosLoading } = useQuery(feedbackStudiosQuery);
  const { data: card } = useQuery(clientCardQuery(user?.id ?? null));

  // Студия из ссылки — если она этого приложения; иначе выбор, как без ссылки.
  const linkStudio = studios.find((s) => s.id === search.studio) ?? null;
  const onlyStudio = studios.length === 1 ? studios[0] : null;
  const fixedStudio = linkStudio ?? onlyStudio;
  const defaultStudioId =
    fixedStudio?.id ?? (studios.some((s) => s.id === viewedStudioId) ? viewedStudioId : null);

  const [picked, setPicked] = useState<string | null>(null);
  const [topic, setTopic] = useState<FeedbackTopic | null>(null);
  const [message, setMessage] = useState("");
  const [mood, setMood] = useState<FeedbackMood | null>(null);
  // null — поле не трогали: подставляем имя и телефон из карточки клиента.
  const [name, setName] = useState<string | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const studioId = fixedStudio?.id ?? picked ?? defaultStudioId;
  const cardName =
    card?.full_name?.trim() || [card?.first_name, card?.last_name].filter(Boolean).join(" ");
  const nameValue = name ?? cardName ?? "";
  const contactValue = contact ?? card?.phone ?? "";

  const reset = () => {
    setTopic(null);
    setMessage("");
    setMood(null);
    setName(null);
    setContact(null);
    setErrors({});
    setSent(false);
  };

  const submit = async () => {
    const next: Errors = {};
    if (!studioId) next.studio = IS_PACKAGES ? t("Выберите студию") : t("Выберите клуб");
    if (!topic) next.topic = t("Выберите тему");
    if (!message.trim()) next.message = t("Напишите сообщение");
    setErrors(next);
    if (Object.keys(next).length > 0 || !studioId || !topic) return;
    setSending(true);
    try {
      await submitFeedback({
        studioId,
        topic,
        message,
        mood,
        name: nameValue,
        contact: contactValue,
      });
      setSent(true);
    } catch {
      toast.error(t("Не удалось отправить обращение. Попробуйте ещё раз."));
    } finally {
      setSending(false);
    }
  };

  const studioName = fixedStudio && studios.length > 1 ? loc(fixedStudio).name : null;

  return (
    <PageShell
      scrollKey={sent ? "sent" : "form"}
      header={
        <div className="px-4 pt-4 pb-8">
          <div className="flex items-center gap-3">
            {session && (
              <Link
                to="/"
                aria-label={t("Назад")}
                className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center bg-white/10 active:bg-white/20 transition-colors"
              >
                <AltArrowLeft className="h-5 w-5" weight="BoldDuotone" />
              </Link>
            )}
            <h1 className="flex-1 text-2xl font-semibold leading-tight">{t("Обратная связь")}</h1>
            {!session && <LanguageSwitcher />}
          </div>
          <p className="mt-2 text-sm text-white/70">
            {studioName
              ? IS_PACKAGES
                ? t("Студия {name}. Расскажите, что понравилось и что можно улучшить.", {
                    name: studioName,
                  })
                : t("Клуб {name}. Расскажите, что понравилось и что можно улучшить.", {
                    name: studioName,
                  })
              : t("Расскажите, что понравилось и что можно улучшить.")}
          </p>
        </div>
      }
    >
      {sent ? (
        <div className="px-4 pt-12 pb-10 flex flex-col items-center text-center">
          <div className="text-6xl" aria-hidden="true">
            💌
          </div>
          <h2 className="mt-4 text-2xl font-semibold">{t("Спасибо!")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Мы получили ваше обращение и обязательно его рассмотрим.")}
          </p>
          <div className="mt-8 w-full space-y-2">
            <Button className="w-full" onClick={reset}>
              {t("Отправить ещё одно обращение")}
            </Button>
            {session && (
              <Button asChild variant="outline" className="w-full">
                <Link to="/">{t("На главную")}</Link>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="px-4 pt-6 pb-10 space-y-7"
        >
          {!fixedStudio && (studiosLoading || studios.length > 1) && (
            <Block title={IS_PACKAGES ? t("Студия") : t("Клуб")} required error={errors.studio}>
              {studiosLoading ? (
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {studios.map((s) => (
                    <OptionButton
                      key={s.id}
                      active={studioId === s.id}
                      onClick={() => {
                        setPicked(s.id);
                        setErrors((e) => ({ ...e, studio: undefined }));
                      }}
                    >
                      {loc(s).name}
                    </OptionButton>
                  ))}
                </div>
              )}
            </Block>
          )}

          <Block title={t("Тема")} required error={errors.topic}>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_TOPICS.map((o) => (
                <OptionButton
                  key={o.key}
                  active={topic === o.key}
                  onClick={() => {
                    setTopic(o.key);
                    setErrors((e) => ({ ...e, topic: undefined }));
                  }}
                >
                  <span className="flex flex-col gap-1 text-sm leading-snug">
                    <span className="text-xl" aria-hidden="true">
                      {o.emoji}
                    </span>
                    {t(o.label)}
                  </span>
                </OptionButton>
              ))}
            </div>
          </Block>

          <Block title={t("Сообщение")} required error={errors.message}>
            <Textarea
              rows={5}
              value={message}
              maxLength={FEEDBACK_LIMITS.message}
              placeholder={t("Расскажите подробнее")}
              aria-invalid={!!errors.message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (e.target.value.trim()) setErrors((er) => ({ ...er, message: undefined }));
              }}
            />
          </Block>

          <Block title={t("Настроение после визита")}>
            <div className="flex gap-3">
              {FEEDBACK_MOODS.map((m) => {
                const active = mood === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    aria-label={t(m.label)}
                    aria-pressed={active}
                    // Повторное нажатие снимает выбор.
                    onClick={() => setMood(active ? null : m.key)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1 rounded-2xl py-3 transition active:scale-[0.97]",
                      active ? "bg-primary/15 ring-2 ring-primary" : "bg-field",
                    )}
                  >
                    <span
                      className={cn("text-3xl transition", mood && !active && "opacity-40")}
                      aria-hidden="true"
                    >
                      {m.emoji}
                    </span>
                    <span className="text-xs text-muted-foreground">{t(m.label)}</span>
                  </button>
                );
              })}
            </div>
          </Block>

          <Block title={t("Как к вам обращаться")}>
            <div className="space-y-2">
              <Input
                value={nameValue}
                maxLength={FEEDBACK_LIMITS.name}
                autoComplete="name"
                placeholder={t("Ваше имя")}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                value={contactValue}
                maxLength={FEEDBACK_LIMITS.contact}
                placeholder={t("Телефон или Instagram")}
                onChange={(e) => setContact(e.target.value)}
              />
              <p className="px-1 text-xs text-muted-foreground">
                {t("Если хотите получить ответ. Можно оставить пустым.")}
              </p>
            </div>
          </Block>

          <Button type="submit" className="w-full" disabled={sending}>
            {sending ? (
              <Refresh className="h-5 w-5 animate-spin" weight="BoldDuotone" />
            ) : (
              t("Отправить")
            )}
          </Button>
        </form>
      )}
    </PageShell>
  );
}

/** Блок формы: заголовок, поле и ошибка проверки красным под ним. */
function Block({
  title,
  required,
  error,
  children,
}: {
  title: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">
        {title}
        {!required && (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {t("необязательно")}
          </span>
        )}
      </h2>
      {children}
      {error && <p className="px-1 text-sm text-destructive">{error}</p>}
    </section>
  );
}
