import { createFileRoute, Link } from "@tanstack/react-router";
import { Children, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AltArrowLeft, Share } from "@solar-icons/react";
import { toast } from "sonner";

import inviteGift from "@/assets/invite-gift.webp";
import { PageShell } from "@/components/page-shell";
import { useAuth } from "@/hooks/use-auth";
import { useHomeStudioName } from "@/hooks/use-viewed-studio";
import { clientCardQuery } from "@/lib/client-card";

export const Route = createFileRoute("/invite")({
  head: () => ({
    meta: [
      { title: "Пригласи подругу — Base40" },
      {
        name: "description",
        content: "Приведите подругу в студию — и вы обе получите по 2 тренировки в подарок.",
      },
    ],
  }),
  component: InvitePage,
});

/** Сколько тренировок в подарок — и пригласившей, и подруге. */
const GIFT_TRAININGS = 2;

/**
 * «Пригласи подругу» (пакетное приложение, решение владельца 2026-10-12):
 * открывается кнопкой-подарком на главной. Сверху — тёмная зона с огоньками
 * и иллюстрацией подарка, как на онбординге (края картинки растворяются в
 * фоне, .art-fade), ниже — белая панель с описанием акции, она прокручивается
 * поверх шапки (PageShell). Акция: подруга пришла по приглашению и оформила
 * абонемент — обе получают по 2 тренировки. Начисляет администратор студии,
 * в приложении — только описание и «Пригласить» (системное «Поделиться»).
 */
function InvitePage() {
  const { user } = useAuth();
  const studioName = useHomeStudioName();
  const { data: client } = useQuery(clientCardQuery(user?.id ?? null));
  const firstName = client?.first_name?.trim() || client?.full_name?.trim().split(/\s+/)[0] || "";

  const share = async () => {
    const studio = studioName ? `в студии «${studioName}»` : "в студии растяжки";
    const text = [
      `Привет! Я занимаюсь ${studio} — приходи со мной!`,
      `Скажи администратору, что ты от меня${firstName ? ` (${firstName})` : ""}: когда оформишь абонемент, мы обе получим по ${GIFT_TRAININGS} тренировки в подарок.`,
    ].join(" ");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Пойдём на тренировку вместе", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success("Приглашение скопировано — отправьте его подруге");
    } catch (e) {
      // Закрытое окно «Поделиться» — не ошибка.
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error("Не удалось поделиться. Расскажите подруге о студии сами — подарок тот же.");
    }
  };

  return (
    <PageShell
      header={
        <div className="pb-8">
          <div className="px-4 pt-2">
            <Link
              to="/"
              className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full px-2 text-sm font-medium text-white/80 transition-colors active:bg-white/10"
            >
              <AltArrowLeft className="h-5 w-5" />
              Назад
            </Link>
          </div>
          <div className="mx-auto h-60 w-60">
            <img src={inviteGift} alt="" className="art-fade h-full w-full object-contain" />
          </div>
          <div className="px-4">
            <h1 className="text-3xl font-semibold leading-tight">Пригласи подругу</h1>
            <p className="mt-1 text-sm text-white/70">
              Вам и подруге — по {GIFT_TRAININGS} тренировки в подарок
            </p>
          </div>
        </div>
      }
    >
      <Blocks>
        <Block>
          <p className="text-[15px] leading-relaxed text-foreground/90">
            Тренироваться вместе веселее. Приведите подругу в студию — и, когда она оформит
            абонемент, мы подарим по {GIFT_TRAININGS} тренировки и ей, и вам.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Reward who="вам" />
            <Reward who="подруге" />
          </div>
        </Block>

        <Block title="Как это работает">
          <ol className="space-y-4">
            <Step n={1} title="Пригласите подругу">
              Нажмите «Пригласить» и отправьте ей приглашение — или просто расскажите о студии.
            </Step>
            <Step n={2} title="Подруга приходит в студию">
              Пусть скажет администратору, что пришла от вас, — назовёт ваше имя.
            </Step>
            <Step n={3} title="Подарок обеим" last>
              Когда подруга оформит абонемент, вам и ей начислят по {GIFT_TRAININGS} бесплатные
              тренировки.
            </Step>
          </ol>
        </Block>

        <Block title="Условия">
          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <Dot />
              Подарок начисляется, когда приглашённая подруга оформит абонемент.
            </li>
            <li className="flex gap-2">
              <Dot />
              Подруга — новая клиентка студии: раньше у нас не занималась.
            </li>
            <li className="flex gap-2">
              <Dot />
              Тренировки добавляет администратор студии — подробности можно уточнить у него.
            </li>
          </ul>
          <button
            type="button"
            onClick={share}
            className="mt-6 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-bold text-primary-foreground transition active:scale-[0.99]"
          >
            <Share className="h-5 w-5" weight="BoldDuotone" />
            Пригласить подругу
          </button>
        </Block>
      </Blocks>
    </PageShell>
  );
}

/** Смысловые блоки с серыми разделителями — как на главной и в анкете. */
function Blocks({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <div className="overflow-hidden rounded-t-3xl bg-muted">
      {items.map((child, i) => {
        const first = i === 0;
        const last = i === items.length - 1;
        return (
          <div
            key={i}
            className={`bg-background ${first ? "" : "mt-3 rounded-t-[14px]"} ${
              last ? "" : "rounded-b-[14px]"
            }`}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}

function Block({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="px-4 pb-5 pt-5">
      {title && <h2 className="mb-4 text-xl font-semibold leading-tight">{title}</h2>}
      {children}
    </section>
  );
}

function Reward({ who }: { who: string }) {
  return (
    <div className="rounded-2xl bg-primary/10 p-4">
      <div className="text-4xl font-black leading-none text-primary tabular-nums">
        +{GIFT_TRAININGS}
      </div>
      <div className="mt-2 text-sm font-medium leading-snug">тренировки {who}</div>
    </div>
  );
}

function Step({
  n,
  title,
  last = false,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-3">
      {/* Линия к следующему шагу. */}
      {!last && (
        <span
          aria-hidden="true"
          className="absolute bottom-[-1rem] left-[15px] top-9 w-0.5 rounded-full bg-primary/20"
        />
      )}
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0 pt-1">
        <div className="font-semibold leading-tight">{title}</div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function Dot() {
  return <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />;
}
