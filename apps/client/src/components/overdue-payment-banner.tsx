import { Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { DangerTriangle } from "@solar-icons/react";

import { useAuth } from "@/hooks/use-auth";
import { useT } from "@/i18n";
import {
  overduePayments,
  tbilisiToday,
  type OverduePayment,
  type OverdueRow,
} from "@/lib/overdue-payments";
import { untypedDb } from "@/lib/untyped-db";

function overduePaymentsQuery(userId: string | null) {
  return queryOptions({
    queryKey: ["overdue-payments", userId],
    queryFn: async (): Promise<OverduePayment[]> => {
      const { data: clients, error: cErr } = await untypedDb
        .from("clients")
        .select("id")
        .eq("user_id", userId);
      if (cErr) throw cErr;
      const clientIds = ((clients as { id: string }[] | null) ?? []).map((c) => c.id);
      if (clientIds.length === 0) return [];
      const { data: live, error: mErr } = await untypedDb
        .from("client_memberships")
        .select("sale_id")
        .in("client_id", clientIds)
        .in("status", ["active", "frozen"])
        .not("sale_id", "is", null);
      if (mErr) throw mErr;
      const saleIds = ((live as { sale_id: string }[] | null) ?? []).map((m) => m.sale_id);
      if (saleIds.length === 0) return [];
      const today = tbilisiToday();
      const { data, error } = await untypedDb
        .from("sale_installments")
        .select("amount, due_date, paid, refunded")
        .in("sale_id", saleIds)
        .eq("paid", false)
        .lt("due_date", today);
      if (error) throw error;
      return overduePayments((data as OverdueRow[] | null) ?? [], today);
    },
    enabled: !!userId,
  });
}

/**
 * Красная плашка на главной: просрочен платёж по текущему абонементу
 * (решение владельца 2026-11-07). Нажатие — «Абонементы», где виден график.
 * Нет просрочки или запрос не прошёл — ничего.
 */
export function OverduePaymentBanner({ className = "" }: { className?: string }) {
  const t = useT();
  const { user } = useAuth();
  const { data: overdue = [] } = useQuery(overduePaymentsQuery(user?.id ?? null));
  if (overdue.length === 0) return null;

  const first = overdue[0];
  const [y, m, d] = first.due_date.split("-").map(Number);
  const date = t.date(new Date(y, m - 1, d), { day: "numeric", month: "long" });
  const total = overdue.reduce((sum, p) => sum + p.amount, 0);
  const text =
    overdue.length === 1
      ? t("{amount} ₾ нужно было внести {date}.", { amount: t.number(first.amount), date })
      : t("Не внесено платежей: {n}, всего {amount} ₾.", {
          n: overdue.length,
          amount: t.number(total),
        });

  return (
    <div className={className}>
      <Link
        to="/memberships"
        className="flex items-center gap-3 rounded-2xl bg-red-50 p-3 text-red-700 ring-1 ring-red-200 active:bg-red-100 transition-colors"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-500">
          <DangerTriangle className="h-[18px] w-[18px]" weight="BoldDuotone" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug">
            {t("Платёж по абонементу просрочен")}
          </span>
          <span className="block text-[13px] leading-snug opacity-80">
            {text} {t("Оплатить можно у администратора.")}
          </span>
        </span>
      </Link>
    </div>
  );
}
