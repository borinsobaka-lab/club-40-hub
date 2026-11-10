import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react";

import { ClientNameLink } from "@/components/client-name-link";
import { CommentsButton } from "@/components/client-comments";
import { ChartPanel } from "@/components/dashboard/chart-panel";
import { DashboardShell, type DashboardView } from "@/components/dashboard/dashboard-shell";
import {
  DashboardControlPageSkeleton,
  DashboardControlRowsSkeleton,
  DashboardControlSkeleton,
} from "@/components/page-skeletons";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { supabase } from "@/integrations/supabase/client";
import { useCommentStats, type CommentStats } from "@/lib/client-comments";
import { formatPhoneDisplay } from "@/lib/contacts";
import {
  CONTROL_BALANCE,
  CONTROL_LIVE_STATES,
  CONTROL_RULES,
  CONTROL_RULE_ORDER,
  commentLag,
  controlClientName,
  controlFact,
  controlItems,
  endingWindow,
  hasFreshComment,
  isRenewed,
  renewedKeys,
  type ControlItem,
  type ControlRuleKey,
  type ControlSale,
  type QueuedRenewal,
} from "@/lib/dashboard-control";
import { DASHBOARD_TITLES } from "@/lib/dashboard-stats";
import { formatNumber, todayISO } from "@/lib/format";
import { plural } from "@/lib/payroll";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard/control")({
  head: () => ({ meta: [{ title: "Руководителю — Дашборд — Base40 Admin" }] }),
  pendingComponent: DashboardControlPageSkeleton,
  component: ControlPage,
});

/**
 * «Руководителю» (решение владельца 2026-11-10): абонементы пакетных клубов,
 * по клиентам которых давно не писали комментарий, — просрочен платёж,
 * заканчивается срок, мало тренировок. Правила и подписи —
 * lib/dashboard-control.ts. Данные — вью client_packages_list (как
 * «Абонементы»: продажи выбранных клубов) и сводка комментариев
 * client_comment_stats. Период дашборда не нужен — всё «на сейчас».
 */
function ControlPage() {
  return (
    <DashboardShell
      title={DASHBOARD_TITLES.control}
      skeleton={<DashboardControlSkeleton />}
      withPeriod={false}
    >
      {(view) => <ControlBody {...view} />}
    </DashboardShell>
  );
}

const COLUMNS =
  "id, client_id, studio_name, clients, memberships, membership_state, ends_at, balance_left, payments";

type PageResult = { data: unknown; error: { message: string } | null };

/** Лимит PostgREST на ответ — 1000 строк: длинный список догружаем страницами. */
const PAGE_SIZE = 1000;

async function loadAll<T>(page: (lo: number, hi: number) => PromiseLike<PageResult>) {
  const rows: T[] = [];
  for (let lo = 0; ; lo += PAGE_SIZE) {
    const { data, error } = await page(lo, lo + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
}

/** Список id кусками: длинный `in.(…)` не влезает в адрес запроса. */
function chunks<T>(items: T[], size = 100) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type ControlData = {
  rules: Record<ControlRuleKey, ControlSale[]>;
  /** Ссылки amoCRM клиентов: строкам не нужно запрашивать каждой свою. */
  crm: Map<string, string | null>;
};

async function loadControl(clubIds: string[]): Promise<ControlData> {
  const today = todayISO();
  const ending = endingWindow(today);
  const base = () => supabase.from("client_packages_list").select(COLUMNS).in("studio_id", clubIds);
  const [overdue, endingRows, balance] = await Promise.all([
    loadAll<ControlSale>((lo, hi) =>
      base().eq("payment_state", "overdue").order("id").range(lo, hi),
    ),
    loadAll<ControlSale>((lo, hi) =>
      base()
        .in("membership_state", [...CONTROL_LIVE_STATES])
        .gte("ends_at", ending.from)
        .lte("ends_at", ending.to)
        .order("id")
        .range(lo, hi),
    ),
    loadAll<ControlSale>((lo, hi) =>
      base()
        .in("membership_state", [...CONTROL_LIVE_STATES])
        .gte("balance_left", CONTROL_BALANCE.min)
        .lte("balance_left", CONTROL_BALANCE.max)
        .order("id")
        .range(lo, hi),
    ),
  ]);

  // Купленные продления (ждут в очереди) — в любом клубе сети: такому
  // клиенту про окончание и остаток писать нечего.
  const candidates = [...new Set([...endingRows, ...balance].map((r) => r.client_id))];
  const all = [...new Set([...overdue, ...endingRows, ...balance].map((r) => r.client_id))];
  const [queued, crmRows] = await Promise.all([
    Promise.all(
      chunks(candidates).map((part) =>
        loadAll<QueuedRenewal>((lo, hi) =>
          supabase
            .from("client_packages_list")
            .select("id, client_id, memberships")
            .in("client_id", part)
            .eq("membership_state", "pending")
            .order("id")
            .range(lo, hi),
        ),
      ),
    ),
    Promise.all(
      chunks(all).map(async (part) => {
        const { data, error } = await supabase
          .from("clients")
          .select("id, crm_link")
          .in("id", part);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; crm_link: string | null }[];
      }),
    ),
  ]);
  const renewed = renewedKeys(queued.flat());
  const crm = new Map(crmRows.flat().map((c) => [c.id, c.crm_link ?? null]));
  return {
    rules: {
      overdue,
      ending: endingRows.filter((r) => !isRenewed(r, renewed)),
      balance: balance.filter((r) => !isRenewed(r, renewed)),
    },
    crm,
  };
}

function ControlBody(view: DashboardView) {
  const packages = view.clubs.every((c) => c.format === "packages");
  const query = useQuery({
    queryKey: ["dashboard", view.scope, "control"],
    queryFn: () => loadControl(view.clubIds),
    enabled: packages,
    meta: { errorMessage: `${view.name}: не удалось загрузить абонементы для проверки` },
  });

  const rules = query.data?.rules;
  const clientIds = useMemo(
    () => (rules ? CONTROL_RULE_ORDER.flatMap((k) => rules[k].map((r) => r.client_id)) : []),
    [rules],
  );
  const comments = useCommentStats(clientIds);
  const statsReady = !!rules && (clientIds.length === 0 || !comments.isLoading);

  // Абонементы, которые уже были в списках: написали комментарий — строка
  // остаётся с «Готово» (иначе пропала бы вместе с открытым окном ленты).
  // Состояние подстраивается во время рендера — без лишнего прохода эффекта.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  if (statsReady && rules) {
    const now = new Date();
    const stale = CONTROL_RULE_ORDER.flatMap((k) => rules[k])
      .filter((s) => !hasFreshComment(comments.byClient.get(s.client_id), now))
      .map((s) => s.id);
    if (stale.some((id) => !seen.has(id))) setSeen(new Set([...seen, ...stale]));
  }

  if (!packages)
    return (
      <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
        Проверки — для пакетных клубов: выберите в фильтре «Клубы» пакетный клуб.
      </div>
    );

  const today = todayISO();
  const multiClub = view.clubIds.length > 1;

  return (
    <div className="grid items-start gap-3 xl:grid-cols-3">
      {CONTROL_RULE_ORDER.map((key) => (
        <RulePanel
          key={key}
          rule={key}
          sales={rules?.[key]}
          stats={comments.byClient}
          seen={seen}
          loading={query.isLoading || (!!rules && !statsReady)}
          error={query.isError || comments.isError}
          today={today}
          crm={query.data?.crm}
          showClub={multiClub}
        />
      ))}
    </div>
  );
}

/** Сколько строк рисуем сразу: длинный список — «Показать ещё». */
const PAGE = 50;
const SALES_UNIT: [string, string, string] = ["абонемент", "абонемента", "абонементов"];

function RulePanel({
  rule,
  sales,
  stats,
  seen,
  loading,
  error,
  today,
  crm,
  showClub,
}: {
  rule: ControlRuleKey;
  sales: ControlSale[] | undefined;
  stats: Map<string, CommentStats>;
  seen: ReadonlySet<string>;
  loading: boolean;
  error: boolean;
  today: string;
  crm: Map<string, string | null> | undefined;
  showClub: boolean;
}) {
  const [limit, setLimit] = useState(PAGE);
  const spec = CONTROL_RULES[rule];
  const items = useMemo(
    () => (sales && !loading ? controlItems(sales, stats, seen) : undefined),
    [sales, stats, seen, loading],
  );
  const open = items?.filter((x) => !x.done).length;

  return (
    <ChartPanel
      title={spec.title}
      tip={spec.tip}
      summary={
        !error &&
        items &&
        sales && (
          <StatusChip tone={open ? "negative" : "positive"}>
            {open
              ? `Без комментария: ${formatNumber(open)} из ${formatNumber(sales.length)}`
              : sales.length
                ? `Все ${formatNumber(sales.length)} ${plural(sales.length, SALES_UNIT)} с комментарием`
                : "Нет абонементов"}
          </StatusChip>
        )
      }
    >
      {loading ? (
        <DashboardControlRowsSkeleton />
      ) : error || !items || !sales ? (
        <Empty text="Не удалось загрузить данные" />
      ) : items.length === 0 ? (
        <Empty text={sales.length ? spec.ok : spec.empty} good={sales.length > 0} />
      ) : (
        <>
          <ul className="-mx-3 divide-y border-t sm:-mx-4">
            {items.slice(0, limit).map((item) => (
              <ControlRow
                key={item.sale.id}
                rule={rule}
                item={item}
                stats={stats.get(item.sale.client_id)}
                today={today}
                crmLink={crm?.get(item.sale.client_id) ?? null}
                showClub={showClub}
              />
            ))}
          </ul>
          {items.length > limit && (
            <div className="-mx-3 -mb-3 border-t p-2 text-center sm:-mx-4 sm:-mb-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setLimit((l) => l + PAGE)}
              >
                Показать ещё {formatNumber(Math.min(PAGE, items.length - limit))}
              </Button>
            </div>
          )}
        </>
      )}
    </ChartPanel>
  );
}

function ControlRow({
  rule,
  item,
  stats,
  today,
  crmLink,
  showClub,
}: {
  rule: ControlRuleKey;
  item: ControlItem;
  stats: CommentStats | undefined;
  today: string;
  crmLink: string | null;
  showClub: boolean;
}) {
  const { sale, done } = item;
  const name = controlClientName(sale);
  const phone = sale.clients?.phone;
  const membership = [sale.memberships?.name ?? "Абонемент", showClub && sale.studio_name]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="px-3 py-2.5 sm:px-4">
      <div className={cn("min-w-0", done && "opacity-60")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <ClientNameLink clientId={sale.client_id} crmLink={crmLink} className="truncate">
            {name}
          </ClientNameLink>
          {phone && (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
            >
              <Phone className="size-3" />
              {formatPhoneDisplay(phone)}
            </a>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{membership}</div>
        <div className="mt-0.5 text-xs">{controlFact(rule, sale, today)}</div>
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
        {done ? (
          <StatusChip tone="positive">Готово</StatusChip>
        ) : (
          <StatusChip tone={stats ? "warning" : "negative"}>{commentLag(stats)}</StatusChip>
        )}
        <CommentsButton
          compact
          clientId={sale.client_id}
          clientName={name}
          saleId={sale.id}
          stats={stats}
        />
      </div>
    </li>
  );
}

function Empty({ text, good }: { text: string; good?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-24 items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm",
        good ? "text-emerald-700" : "text-muted-foreground",
      )}
    >
      {text}
    </div>
  );
}
