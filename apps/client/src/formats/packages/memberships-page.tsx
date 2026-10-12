import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AddCircle, Ticket } from "@solar-icons/react";

import { PageShell } from "@/components/page-shell";
import { UnderlineTabs } from "@/components/underline-tabs";
import { Card } from "@/components/ui/card";
import { MembershipCardsSkeleton } from "@/components/content-skeletons";
import { useAuth } from "@/hooks/use-auth";
import { useViewedStudioName, useViewedStudioId } from "@/hooks/use-viewed-studio";
import { FormattedText } from "@/lib/formatted-text";
import { packCatalogQuery, packMyMembershipsQuery, type MyMembership, type Pack } from "./queries";

/**
 * «Абонементы» пакетного приложения (решение владельца 2026-10-11): вкладки
 * «Абонементы» (пакеты тренировок; пробное не показывается) и «Персональные занятия»
 * (номенклатура типа personal), в порядке из админки (memberships.sort_order,
 * перетаскивание в «Номенклатурах»), описание — с разметкой. Покупки в
 * приложении пока нет — только витрина и свои действующие абонементы.
 * Номенклатура — смотримой студии (переключатель на главной).
 */

const TABS = [
  { key: "packages", label: "Абонементы" },
  { key: "personal", label: "Персональные занятия" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function plural(n: number, one: string, few: string, many: string) {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}

function durationLabel(days: number | null) {
  if (!days) return null;
  if (days % 30 === 0) {
    const m = days / 30;
    return `${m} ${plural(m, "месяц", "месяца", "месяцев")}`;
  }
  return `${days} ${plural(days, "день", "дня", "дней")}`;
}

/** «12 октября 2026»; дату YYYY-MM-DD читаем как местную. */
function formatLongDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function PackagesMembershipsPage() {
  const [tab, setTab] = useState<TabKey>("packages");
  const { user, loading: authLoading } = useAuth();
  const { studioId, studioReady } = useViewedStudioId();
  const studioName = useViewedStudioName();

  const catalog = useQuery(packCatalogQuery(studioId, studioReady));
  const mine = useQuery(packMyMembershipsQuery(user?.id ?? null));

  const items = (catalog.data ?? []).filter((m) =>
    // Пробное посещение в приложении не показываем (решение владельца 2026-10-11).
    tab === "personal" ? m.kind === "personal" : (m.kind ?? "package") === "package",
  );

  return (
    // scrollKey не зависит от вкладки: иначе смена вкладки пересоздавала
    // страницу — прокрутка прыгала наверх, подчёркивание табов не перетекало.
    <PageShell
      scrollKey="memberships"
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-semibold">Абонементы</h1>
          <p className="text-sm text-white/70">
            {studioName ? `Пакеты тренировок студии «${studioName}»` : "Пакеты тренировок"}
          </p>
          {(mine.data ?? []).length > 0 && (
            <div className="mt-4 space-y-2">
              {mine.data!.map((m) => (
                <MyMembershipCard key={m.id} m={m} />
              ))}
            </div>
          )}
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

      <div className="space-y-3 p-4 pb-24">
        {!user && !authLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Войдите в аккаунт, чтобы увидеть абонементы.
          </Card>
        ) : catalog.isPending ? (
          <MembershipCardsSkeleton />
        ) : catalog.error ? (
          <Card className="p-4 text-sm text-destructive">
            Не удалось загрузить абонементы. Обновите страницу.
          </Card>
        ) : items.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            {tab === "personal" ? "Пакетов персональных занятий пока нет" : "Абонементов пока нет"}
          </Card>
        ) : (
          <>
            {items.map((m) => (
              <PackCard key={m.id} m={m} />
            ))}
            <p className="px-1 pt-1 text-center text-xs text-muted-foreground">
              Оформить абонемент можно у администратора студии
            </p>
          </>
        )}
      </div>
    </PageShell>
  );
}

/**
 * Карточка пакета (вёрстка по прайсу студии, решение владельца 2026-10-12):
 * название и тег справа (бледный / яркий — у яркого и рамка карточки),
 * описание — под названием до цены, «Что входит» (тренировки, рассрочка),
 * тёмный блок «В подарок» (текст из админки) и срок действия внизу.
 * Подарочные персональные в «Что входит» не пишутся — их пишут в «В подарок».
 */
function PackCard({ m }: { m: Pack }) {
  const visits = m.visits_count ?? 0;
  const personal = m.personal_count ?? 0;
  const features = [
    m.kind === "personal"
      ? `${personal} ${plural(personal, "персональная тренировка", "персональные тренировки", "персональных тренировок")}`
      : m.kind === "trial"
        ? "Пробное посещение"
        : `${visits} ${plural(visits, "тренировка", "тренировки", "тренировок")}`,
    (m.max_payments ?? 1) > 1 ? `Можно оплатить частями — до ${m.max_payments} платежей` : null,
  ].filter(Boolean) as string[];
  const tag = m.tag_text?.trim();
  const bright = !!tag && m.tag_style === "bright";
  const duration = durationLabel(m.duration_days);

  return (
    <Card
      className={`overflow-hidden rounded-2xl p-5 ${bright ? "border-primary ring-1 ring-primary" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-xl font-semibold leading-tight">{m.name}</h3>
        {tag && (
          <span
            className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
              bright ? "bg-primary text-primary-foreground" : "bg-primary/15 text-foreground"
            }`}
          >
            {tag}
          </span>
        )}
      </div>
      {m.description?.trim() && (
        <FormattedText
          text={m.description}
          className="mt-1.5 text-sm leading-snug text-muted-foreground"
          linkClass="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-2"
        />
      )}
      <div className="mt-3 text-4xl font-black tracking-tight tabular-nums">
        {Number(m.price).toLocaleString("ru-RU")} ₾
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <div className="text-sm font-semibold">Что входит:</div>
        <ul className="mt-2 space-y-1.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <AddCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" weight="Bold" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
      {m.gift_text?.trim() && (
        <div className="mt-4 rounded-xl bg-[#2A2B2F] p-4 text-white">
          <div className="text-xs text-white/60">В подарок</div>
          <FormattedText
            text={m.gift_text}
            className="mt-1.5 text-sm leading-snug"
            linkClass="font-medium text-white underline decoration-primary decoration-2 underline-offset-2"
          />
        </div>
      )}
      {duration && (
        <div className="mt-4 text-sm text-muted-foreground">Срок действия — {duration}</div>
      )}
    </Card>
  );
}

function MyMembershipCard({ m }: { m: MyMembership }) {
  const isPersonal = m.balance_kind === "personal";
  const left = isPersonal ? (m.personal_left ?? 0) : (m.visits_left ?? 0);
  const balance = isPersonal
    ? `${left} ${plural(left, "персональная", "персональные", "персональных")}`
    : `${left} ${plural(left, "тренировка", "тренировки", "тренировок")}`;
  const gift =
    !isPersonal && (m.personal_left ?? 0) > 0
      ? ` + ${m.personal_left} ${plural(m.personal_left!, "персональная", "персональные", "персональных")}`
      : "";
  const status =
    m.status === "pending"
      ? "Продление — начнётся, когда закончится текущий"
      : m.status === "frozen"
        ? "Заморожен"
        : m.ends_at
          ? `Действует до ${formatLongDate(m.ends_at)}`
          : "Срок — с первого посещения";
  return (
    <Card className="flex items-center gap-3 border-0 bg-background p-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15">
        <Ticket className="h-7 w-7 text-primary" weight="BoldDuotone" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold text-foreground">
          {m.memberships?.name ?? "Абонемент"}
        </div>
        <div className="text-sm font-medium text-foreground">
          Осталось: {balance}
          {gift}
        </div>
        <div className="text-xs text-muted-foreground">{status}</div>
      </div>
    </Card>
  );
}
