import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarMinimalistic, WalletMoney } from "@solar-icons/react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedSwitch } from "@/components/segmented-switch";
import { useAuth } from "@/hooks/use-auth";
import { useFormatStudios } from "@/hooks/use-viewed-studio";
import { useLocalize, useT } from "@/i18n";
import { daysBetween, localDay } from "./format";
import { AdminPayoutsView } from "./payouts";
import { ADMIN_SHIFTS_DAYS, adminMeQuery, adminShiftsQuery, type AdminShift } from "./queries";

/** Сколько смен видно сразу и сколько добавляет «Показать ещё». */
const SHIFTS_STEP = 7;

/**
 * Блок администратора на главной (решение владельца 2026-11-26) — тому,
 * кому в карточке клиента в админке указан администратор (app_admin_links).
 * Две вкладки, как у тренера: «Мои смены» — смены из «Графика» админки с
 * сегодняшней на 60 дней вперёд (студия, кто ещё в смене), и «Выплаты» —
 * начисления периода, смены, бонус с продаж по проценту администратора,
 * платежи по продажам и день выплаты (./payouts.tsx, RPC admin_payouts).
 * Не администратор — блока нет.
 */
export function AdminHome() {
  const { user } = useAuth();
  const t = useT();
  const { data: me } = useQuery(adminMeQuery(user?.id ?? null));
  const [tab, setTab] = useState<"shifts" | "payouts">("shifts");

  if (!me) return null;

  return (
    <>
      <section className="bg-background rounded-b-[14px] pb-5">
        <SegmentedSwitch
          aria-label={t("Раздел администратора")}
          options={[
            { key: "shifts", label: t("Мои смены"), icon: CalendarMinimalistic },
            { key: "payouts", label: t("Выплаты"), icon: WalletMoney },
          ]}
          value={tab}
          onChange={setTab}
          className="mx-4 mb-4"
        />
        <div
          key={tab}
          className={`animate-in fade-in-0 duration-300 ease-out motion-reduce:animate-none ${
            tab === "payouts" ? "slide-in-from-right-4" : "slide-in-from-left-4"
          }`}
        >
          {tab === "payouts" ? (
            <AdminPayoutsView adminId={me.trainer_id} />
          ) : (
            <MyShifts adminId={me.trainer_id} />
          )}
        </div>
      </section>
      <div className="h-3 bg-muted" />
    </>
  );
}

/** Ближайшие смены из «Графика»: день, студия, кто ещё в смене. */
function MyShifts({ adminId }: { adminId: string }) {
  const t = useT();
  const loc = useLocalize();
  const { data: studios = [] } = useFormatStudios();
  const { data, isLoading, isError } = useQuery(adminShiftsQuery(adminId));
  const [limit, setLimit] = useState(SHIFTS_STEP);

  if (isError) {
    return (
      <Card className="mx-4 p-4 text-sm text-destructive">
        {t("Не удалось загрузить ваши смены. Обновите страницу.")}
      </Card>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="px-4 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="mx-4 rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
        {t("В графике на ближайшие {n} дней смен нет", { n: ADMIN_SHIFTS_DAYS })}
      </div>
    );
  }

  const shown = data.slice(0, limit);
  const studioName = (id: string) => loc(studios.find((s) => s.id === id))?.name ?? null;

  return (
    <div className="px-4 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">
        {t.plural(data.length, "Впереди {n} смена|Впереди {n} смены|Впереди {n} смен")}
      </div>
      {shown.map((s) => (
        <ShiftCard
          key={`${s.shift_date}-${s.studio_id}`}
          shift={s}
          studio={studioName(s.studio_id)}
        />
      ))}
      {data.length > shown.length && (
        <Button
          className="w-full bg-muted text-foreground hover:bg-muted/80"
          onClick={() => setLimit((n) => n + SHIFTS_STEP)}
        >
          {t("Показать ещё")}
        </Button>
      )}
    </div>
  );
}

function ShiftCard({ shift: s, studio }: { shift: AdminShift; studio: string | null }) {
  const t = useT();
  const d = localDay(s.shift_date);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi" }).format(new Date());
  const inDays = daysBetween(today, s.shift_date);
  const when = inDays === 0 ? t("Сегодня") : inDays === 1 ? t("Завтра") : null;
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-3 ${
        inDays === 0 ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-muted py-1.5">
        <span className="text-lg font-semibold leading-none tabular-nums">{d.getDate()}</span>
        <span className="mt-0.5 text-[11px] text-muted-foreground">
          {t.date(d, { month: "short" })}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {t.capitalize(t.date(d, { weekday: "long" }))}
          {when && <span className="font-normal text-primary"> · {when}</span>}
        </div>
        {studio && <div className="truncate text-xs text-muted-foreground">{studio}</div>}
        {s.colleagues.length > 0 && (
          <div className="truncate text-xs text-muted-foreground">
            {t("Вместе с: {names}", {
              names: s.colleagues.map((c) => c.full_name ?? "—").join(", "),
            })}
          </div>
        )}
      </div>
    </div>
  );
}
