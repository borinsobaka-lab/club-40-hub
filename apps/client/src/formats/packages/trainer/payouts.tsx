import { useState } from "react";
import { useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { AltArrowLeft, AltArrowRight, CheckCircle, UsersGroupRounded } from "@solar-icons/react";

import { BottomDrawer } from "@/components/bottom-drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFormatStudios } from "@/hooks/use-viewed-studio";
import { msg, useLocalize, useT } from "@/i18n";
import { entryName, isOtherActivity } from "../entries";
import {
  clientDisplayName,
  localDay,
  payoutDays,
  payoutIn,
  payoutMoney,
  payoutPeriodLabel,
} from "./format";
import {
  adminPayoutsQuery,
  trainerEntryClientsQuery,
  trainerPayoutsQuery,
  type AdminPayouts,
  type EntryClient,
  type PayoutExtra,
  type PayoutLesson,
  type PayoutSalePayment,
  type TrainerPayouts as Payouts,
} from "./queries";

/** Сколько последних дней с начислениями видно сразу — остальные под «Показать весь период». */
const DAYS_SHOWN = 3;

/**
 * «Выплаты» на главной тренера (решение владельца 2026-11-24): период
 * выплаты (листается назад), сколько начислено и когда выплата, сколько
 * занятий ещё впереди, и начисления по дням — за что и сколько: занятия
 * (сколько людей было и сколько за занятие), смены, бонус с продаж,
 * абонементы после пробного, вычеты и надбавки из «Графика» админки. Для
 * любой ставки — классической и прогрессивной. Список не бесконечный: один
 * период, сразу — три последних дня. По нажатию на занятие — кто был. Суммы считает база теми же правилами,
 * что «Зарплаты» админки (RPC trainer_payouts).
 */
export function TrainerPayouts({ trainerId }: { trainerId: string }) {
  return <PayoutsView queryFor={(shift) => trainerPayoutsQuery(trainerId, shift)} />;
}

/**
 * «Выплаты» администратора (решение владельца 2026-11-26): то же, что у
 * тренера, плюс смены периода (отработано и сколько впереди, прогноз с
 * оставшимися сменами), ставка смены и процент с продаж (классический — 5 %,
 * прогрессивный — свой, выплаты 11-го и 26-го), платежи по продажам за день
 * — по нажатию на «Бонус с продаж» (RPC admin_payouts).
 */
export function AdminPayoutsView({ adminId }: { adminId: string }) {
  return <PayoutsView queryFor={(shift) => adminPayoutsQuery(adminId, shift)} />;
}

type PayoutsQuery<P extends Payouts, K extends QueryKey> = (
  shift: number,
) => UseQueryOptions<P | null, Error, P | null, K>;

/** Ответ администратора — со сменами периода. */
function asAdmin(p: Payouts | AdminPayouts): AdminPayouts | null {
  return "shifts" in p ? p : null;
}

function PayoutsView<P extends Payouts, K extends QueryKey>({
  queryFor,
}: {
  queryFor: PayoutsQuery<P, K>;
}) {
  const t = useT();
  // null — период по умолчанию: текущий, а в день выплаты — тот, за который
  // платят сегодня (26-го — 11–25; замечание владельца 2026-11-26). День
  // выплаты — первый день нового периода, поэтому смотрим на его начало.
  const [picked, setPicked] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<PayoutLesson | null>(null);
  const [salesDay, setSalesDay] = useState<string | null>(null);
  const current = useQuery(queryFor(0));
  const payDay = !!current.data && current.data.period_from === current.data.today;
  const shift = picked ?? (payDay ? -1 : 0);
  const shown = useQuery(queryFor(shift));
  const waiting = picked === null && !current.data && !current.isError;
  const { data, isError, isFetching } = shown;
  const isLoading = waiting || shown.isLoading;
  const setShift = setPicked;

  const move = (next: number) => {
    setShift(next);
    setShowAll(false);
  };

  if (isError) {
    return (
      <Card className="mx-4 p-4 text-sm text-destructive">
        {t("Не удалось загрузить выплаты. Обновите страницу.")}
      </Card>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="px-4 space-y-2">
        <div className="h-36 animate-pulse rounded-2xl bg-muted" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const admin = asAdmin(data);
  const allDays = payoutDays(data.lessons, data.extras, data.adjustments);
  const days = showAll ? allDays : allDays.slice(0, DAYS_SHOWN);
  const hidden = allDays.length - days.length;

  return (
    <div className={`px-4 space-y-3 ${isFetching ? "opacity-70" : ""}`}>
      {/* Период: назад — прошлые выплаты, вперёд — до текущего. */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={t("Предыдущий период")}
          onClick={() => move(shift - 1)}
          disabled={shift <= -24}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-muted disabled:opacity-40"
        >
          <AltArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 text-center">
          <div className="truncate font-semibold">
            {payoutPeriodLabel(data.period_from, data.period_to, t)}
          </div>
          <div className="text-xs text-muted-foreground">
            {shift === 0
              ? t("Текущий период")
              : data.pay_on === data.today
                ? t("Выплата сегодня")
                : t("Прошлый период")}
          </div>
        </div>
        <button
          type="button"
          aria-label={t("Следующий период")}
          onClick={() => move(shift + 1)}
          disabled={shift >= 0}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-muted disabled:opacity-40"
        >
          <AltArrowRight className="h-5 w-5" />
        </button>
      </div>

      <Summary data={data} />

      {allDays.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
          {t("В этом периоде начислений пока нет")}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground">{t("По дням")}</div>
          {days.map((d) => (
            <section
              key={d.date}
              className="overflow-hidden rounded-2xl border border-border bg-card"
            >
              <header className="flex items-baseline justify-between gap-3 bg-muted px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-semibold">
                  {t.capitalize(
                    t.date(localDay(d.date), { weekday: "long", day: "numeric", month: "long" }),
                  )}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {signedMoney(d.total, t)}
                </span>
              </header>
              <ul className="divide-y divide-border">
                {d.lessons.map((l) => (
                  <li key={l.entry_id}>
                    <LessonRow lesson={l} onOpen={() => setOpen(l)} />
                  </li>
                ))}
                {d.extras.map((x) => (
                  <li key={x.kind}>
                    <ExtraRow
                      extra={x}
                      percent={data.sales_percent}
                      onOpen={
                        data.sale_payments && x.kind === "sale"
                          ? () => setSalesDay(x.date.slice(0, 10))
                          : undefined
                      }
                    />
                  </li>
                ))}
                {d.adjustments.map((a, i) => (
                  <li key={`a${i}`}>
                    <PlainRow
                      title={a.kind === "deduction" ? t("Вычет") : t("Надбавка")}
                      note={a.reason}
                      amount={a.kind === "deduction" ? -a.amount : a.amount}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {hidden > 0 && (
            <Button
              className="w-full bg-muted text-foreground hover:bg-muted/80"
              onClick={() => setShowAll(true)}
            >
              {t("Показать весь период (дней: {n})", { n: allDays.length })}
            </Button>
          )}
        </div>
      )}

      <LessonDrawer lesson={open} onClose={() => setOpen(null)} />
      {data.sale_payments && (
        <SalesDrawer
          day={salesDay}
          payments={data.sale_payments}
          percent={data.sales_percent}
          onClose={() => setSalesDay(null)}
        />
      )}
    </div>
  );
}

/** Итог периода: сумма, когда выплата, сколько проведено и сколько ещё впереди. */
function Summary({ data }: { data: Payouts | AdminPayouts }) {
  const t = useT();
  const admin = asAdmin(data);
  const percent = t.number(data.sales_percent, { maximumFractionDigits: 2 });
  const payDay = t.date(localDay(data.pay_on), { day: "numeric", month: "long" });
  const inDays = payoutIn(data.today, data.pay_on, t);
  const rows: { label: string; amount: number }[] = [];
  const rates = data.rates;
  if (rates) {
    // Тренеру — по видам занятий: у фиксированной ставки видно «12 × 30 ₾».
    for (const k of lessonKinds(data.lessons)) {
      const fixed =
        k.kind === "group" ? rates.group : k.kind === "personal" ? rates.personal : null;
      const progressiveGroup = data.format === "progressive" && k.kind === "group";
      const label =
        k.kind === "group"
          ? t.plural(k.count, "{n} групповая|{n} групповые|{n} групповых")
          : k.kind === "personal"
            ? t.plural(k.count, "{n} персональная|{n} персональные|{n} персональных")
            : t.plural(k.count, "{n} другое занятие|{n} других занятия|{n} других занятий");
      rows.push({
        label: progressiveGroup
          ? `${label} · ${t("по числу пришедших")}`
          : fixed != null
            ? `${label} × ${payoutMoney(fixed, t)}`
            : label,
        amount: k.amount,
      });
    }
  } else if (data.lessons_count > 0 || data.lessons_total !== 0)
    rows.push({
      label: t.plural(data.lessons_count, "{n} занятие|{n} занятия|{n} занятий"),
      amount: data.lessons_total,
    });
  if (admin) {
    const done = admin.shifts.filter((x) => x.done).length;
    if (done > 0 || data.shifts_total)
      rows.push({
        label: t.plural(done, "{n} смена|{n} смены|{n} смен"),
        amount: data.shifts_total,
      });
    // Администратору бонус с продаж виден всегда — с процентом и суммой платежей.
    rows.push({
      label: t("Бонус с продаж: {percent} % от {amount}", {
        percent,
        amount: payoutMoney(data.sales_total ?? 0, t),
      }),
      amount: data.sales_bonus,
    });
  } else {
    if (data.shifts_total)
      rows.push({ label: t("Смены администратора"), amount: data.shifts_total });
    if (data.sales_bonus || (rates && data.sales_total))
      rows.push({
        label:
          data.sales_total != null
            ? t("Бонус с продаж: {percent} % от {amount}", {
                percent,
                amount: payoutMoney(data.sales_total, t),
              })
            : t("Бонус с продаж"),
        amount: data.sales_bonus,
      });
  }
  if (data.trial_bonus)
    rows.push({
      label: t("Абонементы после пробного: {n}", { n: data.trial_count }),
      amount: data.trial_bonus,
    });
  for (const a of data.adjustments)
    rows.push({
      label: `${a.kind === "deduction" ? t("Вычет") : t("Надбавка")}: ${a.reason}`,
      amount: a.kind === "deduction" ? -a.amount : a.amount,
    });
  // Одна строка «занятия» повторяла бы итог — разбивка нужна, когда слагаемых несколько.
  const breakdown = rows.length > 1 || admin || rates ? rows : [];
  const ahead = admin ? admin.shifts.filter((x) => !x.done) : [];

  return (
    <div className="rounded-2xl bg-muted p-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t("Начислено за период")}</div>
          <div className="text-3xl font-semibold tabular-nums leading-tight">
            {payoutMoney(data.total, t)}
          </div>
        </div>
        {data.paid ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle className="h-4 w-4" weight="Bold" />
            {t("Выплачено")}
          </span>
        ) : (
          <div className="shrink-0 text-right">
            <div className="text-xs text-muted-foreground">{t("Выплата")}</div>
            <div className="font-semibold">{payDay}</div>
            {inDays && <div className="text-xs text-muted-foreground">{inDays}</div>}
          </div>
        )}
      </div>

      {data.paid && (
        <div className="mt-1 text-xs text-muted-foreground">
          {t("Выплачено {amount} · {date}", {
            amount: payoutMoney(data.paid.amount, t),
            date: t.date(data.paid.paid_at, { day: "numeric", month: "long" }),
          })}
        </div>
      )}

      {admin && (
        <div className="mt-1 text-xs text-muted-foreground">
          {admin.format === "progressive"
            ? t("Выплаты 11-го и 26-го числа")
            : t("Выплаты 20-го и 1-го числа")}
          {" · "}
          {admin.shift_rate != null
            ? t("смена — {amount}", { amount: payoutMoney(admin.shift_rate, t) })
            : t("смены не оплачиваются")}
          {" · "}
          {t("{percent} % с продаж", { percent })}
        </div>
      )}

      {rates && (
        <div className="mt-1 text-xs text-muted-foreground">
          {[
            data.format === "progressive"
              ? t("Выплаты 11-го и 26-го числа")
              : t("Выплаты 20-го и 1-го числа"),
            data.format === "progressive"
              ? t("групповые — по числу пришедших")
              : rates.group != null
                ? t("групповая — {amount}", { amount: payoutMoney(rates.group, t) })
                : null,
            rates.personal != null
              ? t("персональная — {amount}", { amount: payoutMoney(rates.personal, t) })
              : null,
            rates.trial_sale_bonus != null
              ? t("абонемент после пробного — {amount}", {
                  amount: payoutMoney(rates.trial_sale_bonus, t),
                })
              : t("{percent} % с продаж", { percent }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}

      {breakdown.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          {breakdown.map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
              <span className="shrink-0 tabular-nums">
                {r.amount < 0 ? "−" : ""}
                {payoutMoney(Math.abs(r.amount), t)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.shift === 0 && admin && (
        <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          <div>
            {ahead.length > 0
              ? t.plural(
                  ahead.length,
                  "До выплаты ещё {n} смена|До выплаты ещё {n} смены|До выплаты ещё {n} смен",
                )
              : t("До выплаты смен в графике больше нет")}
          </div>
          {ahead.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {ahead
                .map((x) =>
                  t.date(localDay(x.date), { weekday: "short", day: "numeric", month: "short" }),
                )
                .join(", ")}
            </div>
          )}
          {ahead.length > 0 && admin.shift_rate ? (
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <span className="text-muted-foreground">{t("С оставшимися сменами")}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {payoutMoney(admin.forecast, t)}
              </span>
            </div>
          ) : null}
          {data.upcoming_count > 0 && (
            <div>
              {t.plural(
                data.upcoming_count,
                "До выплаты ещё {n} занятие|До выплаты ещё {n} занятия|До выплаты ещё {n} занятий",
              )}
            </div>
          )}
        </div>
      )}

      {data.shift === 0 && !admin && (
        <div className="mt-3 border-t border-border pt-3 text-sm">
          {data.upcoming_count > 0
            ? t.plural(
                data.upcoming_count,
                "До выплаты ещё {n} занятие|До выплаты ещё {n} занятия|До выплаты ещё {n} занятий",
              )
            : t("До выплаты занятий в расписании больше нет")}
        </div>
      )}
    </div>
  );
}

/** Проведённые занятия по видам: групповые, персональные, остальные — сколько и на какую сумму. */
function lessonKinds(lessons: PayoutLesson[]) {
  const out = (["group", "personal", "other"] as const).map((kind) => ({
    kind,
    count: 0,
    amount: 0,
  }));
  for (const l of lessons) {
    const k = out.find((x) => x.kind === l.kind) ?? out[2];
    k.count += 1;
    k.amount += l.amount;
  }
  return out.filter((k) => k.count > 0);
}

/** «240 ₾», вычет — «−20 ₾». */
function signedMoney(amount: number, t: ReturnType<typeof useT>) {
  return `${amount < 0 ? "−" : ""}${payoutMoney(Math.abs(amount), t)}`;
}

/** Начисление дня не за занятие: смена, бонус с продаж, абонементы после пробного. */
function ExtraRow({
  extra: x,
  percent,
  onOpen,
}: {
  extra: PayoutExtra;
  percent: number;
  onOpen?: () => void;
}) {
  const t = useT();
  if (x.kind === "sale")
    return (
      <PlainRow
        onOpen={onOpen}
        title={t("Бонус с продаж")}
        note={t("{percent} % от {amount}", {
          percent: t.number(percent, { maximumFractionDigits: 2 }),
          amount: payoutMoney(x.amount, t),
        })}
        amount={x.bonus}
      />
    );
  if (x.kind === "trial_bonus")
    return (
      <PlainRow title={t("Абонементы после пробного: {n}", { n: x.units })} amount={x.bonus} />
    );
  return (
    <PlainRow
      title={
        x.units > 1 ? t("Смены администратора: {n}", { n: x.units }) : t("Смена администратора")
      }
      amount={x.bonus}
    />
  );
}

/** Строка начисления без перехода: что, пояснение, сумма (вычет — красным). */
function PlainRow({
  title,
  note,
  amount,
  onOpen,
}: {
  title: string;
  note?: string;
  amount: number;
  onOpen?: () => void;
}) {
  const t = useT();
  const body = (
    <>
      <div className="w-14 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        {note && <div className="text-xs text-muted-foreground">{note}</div>}
      </div>
      <div
        className={`shrink-0 font-semibold tabular-nums ${amount < 0 ? "text-red-600 dark:text-red-400" : ""}`}
      >
        {signedMoney(amount, t)}
      </div>
      {onOpen ? (
        <AltArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <div className="w-4 shrink-0" />
      )}
    </>
  );
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition active:bg-muted"
    >
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-3 py-2.5">{body}</div>
  );
}

/** Платежи по продажам за день — по нажатию на «Бонус с продаж» (тренер и администратор). */
function SalesDrawer({
  day,
  payments,
  percent,
  onClose,
}: {
  day: string | null;
  payments: PayoutSalePayment[];
  percent: number;
  onClose: () => void;
}) {
  const t = useT();
  const loc = useLocalize();
  const { data: studios = [] } = useFormatStudios();
  // Содержимое держим на время закрытия шторки.
  const [last, setLast] = useState<string | null>(null);
  if (day && day !== last) setLast(day);
  const d = day ?? last;
  if (!d) return null;
  const list = payments.filter((p) => p.paid_on.slice(0, 10) === d);
  const total = list.reduce((sum, p) => sum + p.amount, 0);
  const bonus = list.reduce((sum, p) => sum + p.bonus, 0);
  return (
    <BottomDrawer
      open={day !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t("Платежи по продажам")}
      description={t.capitalize(
        t.date(localDay(d), { weekday: "long", day: "numeric", month: "long" }),
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
        <div className="text-sm">
          {t("Поступило {amount}", { amount: payoutMoney(total, t) })}
          <div className="text-xs text-muted-foreground">
            {t("Ваш бонус — {percent} %", {
              percent: t.number(percent, { maximumFractionDigits: 2 }),
            })}
          </div>
        </div>
        <div className="text-xl font-semibold tabular-nums">{payoutMoney(bonus, t)}</div>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {list.map((p, i) => {
          const studio = loc(studios.find((s) => s.id === p.studio_id))?.name ?? null;
          const membership = p.membership ? loc(p.membership).name : t("Абонемент");
          return (
            <li key={`${p.sale_id}-${i}`} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.client_name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[
                    membership,
                    p.installment_no && p.installments_total && p.installments_total > 1
                      ? t("платёж {n} из {m}", { n: p.installment_no, m: p.installments_total })
                      : null,
                    studio,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {p.refunded && (
                  <div className="text-xs font-medium text-red-600 dark:text-red-400">
                    {t("По продаже оформлен возврат")}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <div className="font-semibold">{payoutMoney(p.amount, t)}</div>
                <div className="text-xs text-muted-foreground">+{payoutMoney(p.bonus, t)}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </BottomDrawer>
  );
}

/** Строка занятия: когда, что и где, сколько людей было, сколько начислено. */
function LessonRow({ lesson: l, onOpen }: { lesson: PayoutLesson; onOpen: () => void }) {
  const t = useT();
  const loc = useLocalize();
  const { data: studios = [] } = useFormatStudios();
  const studio = loc(studios.find((s) => s.id === l.studio_id))?.name ?? null;
  const name = entryName(l, loc(l.workout)?.name, t);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition active:bg-muted"
    >
      <div className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">
        {t.time(l.starts_at)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {!isOtherActivity(l) && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <UsersGroupRounded className="h-3.5 w-3.5" />
              {l.people}
            </span>
          )}
          {studio && <span className="truncate">{studio}</span>}
        </div>
        {/* Неотмеченные в оплату не идут — как будто не пришли (решение владельца 2026-11-24). */}
        {l.unmarked > 0 && (
          <div className="text-xs font-medium text-red-600 dark:text-red-400">
            {t("Не отмечено посещений: {n}", { n: l.unmarked })}
          </div>
        )}
      </div>
      <div className="shrink-0 font-semibold tabular-nums">{payoutMoney(l.amount, t)}</div>
      <AltArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

const GROUPS = [
  { status: "attended", label: msg("Были") },
  { status: "booked", label: msg("Не отмечены") },
  { status: "no_show", label: msg("Не пришли") },
] as const;

/** Кто был на занятии — по нажатию на строку. */
function LessonDrawer({ lesson, onClose }: { lesson: PayoutLesson | null; onClose: () => void }) {
  const t = useT();
  const loc = useLocalize();
  const { data: studios = [] } = useFormatStudios();
  // Содержимое держим на время закрытия шторки — иначе оно пропадает раньше анимации.
  const [last, setLast] = useState<PayoutLesson | null>(null);
  if (lesson && lesson !== last) setLast(lesson);
  const l = lesson ?? last;
  const { data, isLoading, isError } = useQuery(
    trainerEntryClientsQuery(l && !isOtherActivity(l) ? l.entry_id : null),
  );
  if (!l) return null;
  const studio = loc(studios.find((s) => s.id === l.studio_id))?.name ?? null;
  const when = `${t.capitalize(
    t.date(l.starts_at, { weekday: "long", day: "numeric", month: "long" }),
  )}, ${t.time(l.starts_at)}`;

  return (
    <BottomDrawer
      open={lesson !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={entryName(l, loc(l.workout)?.name, t)}
      description={studio ? `${when} · ${studio}` : when}
    >
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
        <div className="text-sm">
          {isOtherActivity(l)
            ? t("Начислено за занятие")
            : t.plural(l.people, "Был {n} человек|Было {n} человека|Было {n} человек")}
        </div>
        <div className="text-xl font-semibold tabular-nums">{payoutMoney(l.amount, t)}</div>
      </div>

      {isOtherActivity(l) ? null : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
          {t("Не удалось загрузить список записанных.")}
        </div>
      ) : data.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t("На занятие никто не был записан.")}</div>
      ) : (
        <div className="space-y-4">
          {l.unmarked > 0 && (
            <div className="rounded-2xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
              {t(
                "Не у всех отмечено посещение. Пока администратор не отметил приход, клиент считается не пришедшим и в оплату занятия не входит.",
              )}
            </div>
          )}
          {GROUPS.map((g) => {
            const list = data.filter((c) => c.status === g.status);
            if (list.length === 0) return null;
            return (
              <div key={g.status}>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">
                  {t(g.label)} · {list.length}
                </div>
                <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                  {list.map((c) => (
                    <li key={c.client_id}>
                      <PersonRow client={c} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </BottomDrawer>
  );
}

function PersonRow({ client: c }: { client: EntryClient }) {
  const t = useT();
  return (
    <div className="px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-medium">{clientDisplayName(c)}</span>
        {c.is_trial && (
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
            {t("Пробное")}
          </span>
        )}
      </div>
      {c.status === "booked" && (
        <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">
          {t("Администратор не отметил приход клиента")}
        </div>
      )}
    </div>
  );
}
