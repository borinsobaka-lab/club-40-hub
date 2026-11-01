import { createFileRoute } from "@tanstack/react-router";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { ClientNameLink } from "@/components/client-name-link";
import { StaffTabs } from "@/components/staff-tabs";
import { useConfirm } from "@/components/confirm-dialog";
import { EmployeePhoto, TrainerRoleBadge } from "@/components/employee-photo";
import { TableSkeletonRows } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { TableToolbar, ToolbarReset, ToolbarSearch } from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
import { StatusChip } from "@/components/ui/status-chip";
import {
  STATUS_TONE_CLASS,
  statusChipBase,
  statusChipSize,
  type StatusTone,
} from "@/components/ui/status-chip-styles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, todayISO } from "@/lib/format";
import {
  ADJUSTMENT_KINDS,
  formatPay,
  BONUS_RATE,
  EMPTY_SUMMARY,
  addMonths,
  defaultPeriod,
  monthBounds,
  monthLabel,
  payDate,
  payoutPeriods,
  periodLabel,
  periodRange,
  periodTitle,
  plural,
  studioAbbrs,
  summarize,
  workSummary,
  type MonthKey,
  type PayrollAdjustment,
  type PayrollLine,
  type PayrollPayout,
  type PayrollSummary,
  type PeriodKey,
} from "@/lib/payroll";
import { unwrap } from "@/lib/query";
import {
  BANKS,
  TRAINER_ROLES,
  bankOf,
  formatIban,
  isAdminRole,
  usePayrollAdjustments,
  usePayrollScope,
  type Employee,
  type TrainerRole,
} from "@/lib/staff-directory";
import { cn } from "@/lib/utils";
import { useTableSort } from "@/hooks/use-table-sort";
import { PeriodStepper } from "@/components/period-stepper";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PayrollPageSkeleton } from "@/components/page-skeletons";

export const Route = createFileRoute("/_authenticated/payroll")({
  head: () => ({ meta: [{ title: "Зарплаты — Base40 Admin" }] }),
  pendingComponent: PayrollPageSkeleton,
  component: PayrollPage,
});

/**
 * «Зарплаты» — раздел «Сотрудники», пакетные студии. Строка — сотрудник
 * ваших студий («Доступы»), но оклад у него общий по всем пакетным студиям:
 * смены администратора («График администраторов»), проведённые групповые,
 * персональные и прочие занятия («Расписание») по «Зарплатным ставкам»;
 * продажи (внёс в «Продажи» или был тренером при продаже) и бонус 5 %;
 * корректировки; итог. Строки считает RPC payroll_lines, суммы за период —
 * lib/payroll.ts. Выплата отмечается за половину месяца (payroll_payouts):
 * аванс 1–19 — 20-го, основная 20–конец — 1-го следующего месяца.
 */

const TIPS = {
  base: "Смены администратора и проведённые занятия по «Зарплатным ставкам»: групповые, персональные, прочие активности (по ставке занятия). Будущие смены и занятия не считаются.",
  sales:
    "Деньги по абонементам, поступившие за период: первые платежи и доплаты по рассрочкам, в том числе по абонементам, проданным раньше. Администратору — по продажам, где он выбран администратором, тренеру — где он тренер при продаже. Пробные и разовые посещения не считаются; пакет персональных — администратору всегда, кроме пакета на 1 тренировку, тренеру — только первая покупка клиентом. Список платежей — в карточке сотрудника.",
  bonus: "5 % от поступивших платежей.",
  adjustments: "Вычеты и надбавки из «Графика администраторов» с датой в этом периоде.",
  total: "Оклад + бонус 5 % + корректировки.",
  status:
    "Нажмите, чтобы отметить выплату. В режиме «Весь месяц» выплаты отмечаются в карточке сотрудника — по половинам месяца.",
};

const ALL = "all";
type StatusFilter = typeof ALL | "unpaid" | "paid";
type RowStatus = "paid" | "partial" | "unpaid" | "none";

const STATUS_VIEW: Record<RowStatus, { label: string; tone: StatusTone }> = {
  paid: { label: "Выплачено", tone: "positive" },
  partial: { label: "Частично", tone: "info" },
  unpaid: { label: "Не выплачено", tone: "warning" },
  none: { label: "—", tone: "neutral" },
};

/** Порядок статусов при сортировке колонки «Статус»: сначала к выплате. */
const STATUS_RANK: Record<RowStatus, number> = { unpaid: 0, partial: 1, paid: 2, none: 3 };

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Скопировано"),
    () => toast.error("Не удалось скопировать"),
  );
}

function PayrollPage() {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const today = todayISO();
  const initial = defaultPeriod(today);
  const [month, setMonth] = useState<MonthKey>(initial.month);
  const [period, setPeriod] = useState<PeriodKey>(initial.period);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<typeof ALL | TrainerRole>(ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { studios, employees, loading: scopeLoading } = usePayrollScope();
  const { from, to } = monthBounds(month);

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["payroll_lines", month],
    queryFn: async () =>
      (await unwrap<PayrollLine[]>(supabase.rpc("payroll_lines", { _from: from, _to: to }))).map(
        (l) => ({ ...l, amount: Number(l.amount) || 0 }),
      ),
    enabled: studios.length > 0,
    meta: { errorMessage: "Не удалось посчитать зарплаты" },
  });
  const { data: adjustments = [], isLoading: adjustmentsLoading } = usePayrollAdjustments(month);
  const { data: payouts = [], isLoading: payoutsLoading } = useQuery({
    queryKey: ["payroll_payouts", month],
    queryFn: () =>
      unwrap<PayrollPayout[]>(
        supabase
          .from("payroll_payouts")
          .select("trainer_id, period_start, period_end, amount, paid_at, paid_by_name")
          .gte("period_start", from)
          .lte("period_end", to),
      ),
    meta: { errorMessage: "Не удалось загрузить выплаты" },
  });

  const range = periodRange(month, period);
  const summaries = summarize(lines, adjustments, range);
  const halves = payoutPeriods(month, period);
  const halfSummaries = halves.map((h) => summarize(lines, adjustments, h));
  const summaryOf = (id: string) => summaries.get(id) ?? EMPTY_SUMMARY;
  const payoutOf = (id: string, half: { from: string; to: string }) =>
    payouts.find(
      (p) => p.trainer_id === id && p.period_start === half.from && p.period_end === half.to,
    ) ?? null;

  const statusOf = (id: string): RowStatus => {
    const paid = halves.filter((h) => payoutOf(id, h)).length;
    if (paid === halves.length) return "paid";
    if (paid > 0) return "partial";
    return summaryOf(id).total > 0 ? "unpaid" : "none";
  };

  // Сверху администраторы, затем тренеры — как в «Графике администраторов».
  const sorted = [...employees].sort(
    (a, b) =>
      Number(isAdminRole(b.role)) - Number(isAdminRole(a.role)) ||
      a.full_name.localeCompare(b.full_name, "ru"),
  );
  const sort = useTableSort<Employee>({
    name: (e) => e.full_name,
    role: (e) => TRAINER_ROLES[e.role]?.label ?? e.role,
    base: (e) => summaryOf(e.id).base,
    sales: (e) => summaryOf(e.id).sales || null,
    bonus: (e) => summaryOf(e.id).bonus || null,
    adjustments: (e) => summaryOf(e.id).adjustments || null,
    total: (e) => summaryOf(e.id).total,
    status: (e) => STATUS_RANK[statusOf(e.id)],
  });
  const term = search.trim().toLowerCase();
  const filteredRows = sorted.filter(
    (e) =>
      (roleFilter === ALL || e.role === roleFilter) &&
      (!term || e.full_name.toLowerCase().includes(term)) &&
      (statusFilter === ALL ||
        (statusFilter === "paid" ? statusOf(e.id) === "paid" : statusOf(e.id) !== "paid")),
  );
  const rows = sort.apply(filteredRows);
  const filtered = !!term || roleFilter !== ALL || statusFilter !== ALL;

  // Итоги шапки — по всем сотрудникам периода, без фильтров.
  let paidTotal = 0;
  let leftTotal = 0;
  for (const e of employees) {
    halves.forEach((h, i) => {
      const p = payoutOf(e.id, h);
      if (p) paidTotal += Number(p.amount);
      else leftTotal += Math.max(0, halfSummaries[i].get(e.id)?.total ?? 0);
    });
  }

  const markPaid = async (e: Employee, half: { from: string; to: string }, amount: number) => {
    const { error } = await supabase.from("payroll_payouts").upsert({
      trainer_id: e.id,
      period_start: half.from,
      period_end: half.to,
      amount,
    });
    if (error) {
      toast.error("Выплата не отмечена: " + error.message);
      return;
    }
    toast.success(`${e.full_name}: выплачено ${formatPay(amount)}`);
    queryClient.invalidateQueries({ queryKey: ["payroll_payouts"] });
  };

  const unmarkPaid = async (e: Employee, half: { from: string; to: string }) => {
    if (
      !(await confirm({
        title: "Отменить отметку о выплате?",
        description: `${e.full_name} снова будет в статусе «Не выплачено».`,
        confirmLabel: "Отменить отметку",
      }))
    )
      return;
    const { error } = await supabase
      .from("payroll_payouts")
      .delete()
      .eq("trainer_id", e.id)
      .eq("period_start", half.from)
      .eq("period_end", half.to);
    if (error) {
      toast.error("Не удалось отменить: " + error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["payroll_payouts"] });
  };

  const selected = employees.find((e) => e.id === selectedId) ?? null;
  const payOn = payDate(month, period);
  // Статусы и итоги без выплат и корректировок были бы неправдой — ждём всё.
  const loading = scopeLoading || linesLoading || adjustmentsLoading || payoutsLoading;
  const columns = 8;

  return (
    <AdminShell title="Зарплаты">
      <div className="space-y-3">
        <StaffTabs />
        <TableToolbar>
          <PeriodStepper
            unit="month"
            label={monthLabel(month)}
            onPrev={() => setMonth(addMonths(month, -1))}
            onNext={() => setMonth(addMonths(month, 1))}
            onCurrent={() => {
              setMonth(initial.month);
              setPeriod(initial.period);
            }}
            isCurrent={month === initial.month}
          />
          <SegmentedControl
            aria-label="Период выплаты"
            value={period}
            onChange={setPeriod}
            options={(["advance", "main", "month"] as PeriodKey[]).map((p) => ({
              value: p,
              label: periodLabel(month, p),
            }))}
            className="toolbar-full max-sm:grid max-sm:w-full max-sm:auto-cols-fr max-sm:grid-flow-col"
          />
          <div className="toolbar-full flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:ml-auto">
            <span className="flex items-center gap-1">
              Выплачено:{" "}
              {loading ? (
                <Skeleton className="h-4 w-16" />
              ) : (
                <b className={cn("tabular-nums", paidTotal > 0 && "text-emerald-700")}>
                  {formatPay(paidTotal)}
                </b>
              )}
            </span>
            <span className="flex items-center gap-1">
              Осталось:{" "}
              {loading ? (
                <Skeleton className="h-4 w-16" />
              ) : (
                <b className={cn("tabular-nums", leftTotal > 0 && "text-amber-700")}>
                  {formatPay(leftTotal)}
                </b>
              )}
            </span>
          </div>
        </TableToolbar>

        <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          {payOn
            ? `${period === "advance" ? "Аванс" : "Основная часть"} выплачивается ${formatDate(payOn)} — за ${periodTitle(month, period)}.`
            : "Аванс за 1–19 выплачивается 20-го, основная часть за 20–конец месяца — 1-го числа следующего месяца."}
        </p>

        {!scopeLoading && studios.length === 0 ? (
          <InfoNote variant="empty">
            Зарплаты считаются в клубах с пакетами тренировок — у вас нет доступа ни к одному такому
            клубу.
          </InfoNote>
        ) : (
          <>
            <TableToolbar>
              <ToolbarSearch value={search} onChange={setSearch} placeholder="Поиск по имени" />
              <Select
                value={roleFilter}
                onValueChange={(v) => setRoleFilter(v as typeof ALL | TrainerRole)}
              >
                <SelectTrigger aria-label="Роль" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все роли</SelectItem>
                  {(Object.keys(TRAINER_ROLES) as TrainerRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {TRAINER_ROLES[r].plural}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger aria-label="Статус выплаты" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все статусы</SelectItem>
                  <SelectItem value="unpaid">Не выплачено</SelectItem>
                  <SelectItem value="paid">Выплачено</SelectItem>
                </SelectContent>
              </Select>
              <ToolbarReset
                active={filtered}
                onReset={() => {
                  setSearch("");
                  setRoleFilter(ALL);
                  setStatusFilter(ALL);
                }}
              />
            </TableToolbar>

            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead {...sort.head("name")}>Сотрудник</TableHead>
                    <TableHead {...sort.head("role")}>Роль</TableHead>
                    <TableHead className="text-right" tip={TIPS.base} {...sort.head("base")}>
                      Оклад
                    </TableHead>
                    <TableHead className="text-right" tip={TIPS.sales} {...sort.head("sales")}>
                      Продажи
                    </TableHead>
                    <TableHead className="text-right" tip={TIPS.bonus} {...sort.head("bonus")}>
                      Бонус {BONUS_RATE * 100}%
                    </TableHead>
                    <TableHead
                      className="text-right"
                      tip={TIPS.adjustments}
                      {...sort.head("adjustments")}
                    >
                      Корректир.
                    </TableHead>
                    <TableHead className="text-right" tip={TIPS.total} {...sort.head("total")}>
                      Итого
                    </TableHead>
                    <TableHead tip={TIPS.status} {...sort.head("status")}>
                      Статус
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableSkeletonRows columns={columns} />
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={columns}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        {filtered
                          ? "Ничего не найдено."
                          : "Нет сотрудников ваших клубов — добавьте их в разделе «Сотрудники»."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((e) => {
                      const s = summaryOf(e.id);
                      const status = statusOf(e.id);
                      const unpaid = status === "unpaid" || status === "partial";
                      const half = halves.length === 1 ? halves[0] : null;
                      return (
                        <TableRow
                          key={e.id}
                          onClick={() => setSelectedId(e.id)}
                          className={cn(
                            "cursor-pointer",
                            unpaid && "max-md:border-l-4 max-md:border-l-amber-400",
                          )}
                        >
                          <TableCell className="relative">
                            {unpaid && (
                              <span
                                aria-hidden
                                className="absolute inset-y-0 left-0 w-1 bg-amber-400 max-md:hidden"
                              />
                            )}
                            <EmployeeCell employee={e} onOpen={() => setSelectedId(e.id)} />
                          </TableCell>
                          <TableCell>
                            <TrainerRoleBadge role={e.role} />
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="tabular-nums">{formatPay(s.base)}</div>
                            {workSummary(s) && (
                              <div className="text-xs text-muted-foreground">{workSummary(s)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="tabular-nums">{s.sales ? formatPay(s.sales) : "—"}</div>
                            {s.salesCount > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {s.salesCount}{" "}
                                {plural(s.salesCount, ["платёж", "платежа", "платежей"])}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {s.bonus ? formatPay(s.bonus) : "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums whitespace-nowrap",
                              s.adjustments < 0 && "text-rose-600",
                              s.adjustments > 0 && "text-emerald-700",
                            )}
                          >
                            {s.adjustments ? signedMoney(s.adjustments) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                            {formatPay(s.total)}
                          </TableCell>
                          <TableCell>
                            <StatusButton
                              status={status}
                              disabled={!half}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (!half) {
                                  setSelectedId(e.id);
                                  return;
                                }
                                if (status === "paid") void unmarkPaid(e, half);
                                else if (status === "unpaid") void markPaid(e, half, s.total);
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          {selected && (
            <EmployeePayroll
              key={selected.id}
              employee={selected}
              month={month}
              period={period}
              summary={summaryOf(selected.id)}
              lines={lines.filter(
                (l) =>
                  l.trainer_id === selected.id &&
                  l.work_date >= range.from &&
                  l.work_date <= range.to,
              )}
              adjustments={adjustments.filter(
                (a) =>
                  a.trainer_id === selected.id &&
                  a.adjusted_on >= range.from &&
                  a.adjusted_on <= range.to,
              )}
              halves={halves.map((h, i) => ({
                ...h,
                total: halfSummaries[i].get(selected.id)?.total ?? 0,
                payout: payoutOf(selected.id, h),
              }))}
              onMarkPaid={(h, amount) => markPaid(selected, h, amount)}
              onUnmark={(h) => unmarkPaid(selected, h)}
            />
          )}
        </SheetContent>
      </Sheet>
      {confirmDialog}
    </AdminShell>
  );
}

function signedMoney(n: number) {
  return `${n < 0 ? "−" : "+"}${formatPay(Math.abs(n))}`;
}

function StatusButton({
  status,
  disabled,
  onClick,
}: {
  status: RowStatus;
  disabled: boolean;
  onClick: (e: MouseEvent) => void;
}) {
  const view = STATUS_VIEW[status];
  if (status === "none") return <span className="px-2 text-sm text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        disabled
          ? "Выплаты отмечаются по половинам месяца — в карточке сотрудника"
          : status === "paid"
            ? "Отменить отметку о выплате"
            : "Отметить как выплачено"
      }
      className={cn(
        statusChipBase,
        statusChipSize.default,
        STATUS_TONE_CLASS[view.tone],
        "cursor-pointer transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
      )}
    >
      {status === "paid" && <Check />}
      {view.label}
    </button>
  );
}

/** Фото, имя и реквизиты с копированием — чтобы переводить, не открывая карточку. */
function EmployeeCell({ employee, onOpen }: { employee: Employee; onOpen: () => void }) {
  return (
    <div className="flex min-w-[220px] items-center gap-3">
      <EmployeePhoto value={employee.photo_url} name={employee.full_name} className="size-9" />
      <div className="min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="cursor-pointer rounded-sm text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {employee.full_name}
        </button>
        <BankLine employee={employee} />
      </div>
    </div>
  );
}

/** wrap — в карточке: IBAN группами по 4, крупнее; в таблице — компактно. */
function BankLine({ employee, wrap }: { employee: Employee; wrap?: boolean }) {
  const bank = bankOf(employee);
  if (!bank?.account_number && !bank?.account_holder)
    return <div className="text-xs text-muted-foreground">Реквизиты не указаны</div>;
  const short = BANKS.find((b) => b.value === bank.bank)?.short;
  return (
    <div
      className={cn(
        "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground",
      )}
    >
      {bank.account_number && (
        <CopyChip text={bank.account_number} className={cn(wrap && "font-mono")}>
          {wrap ? formatIban(bank.account_number) : bank.account_number}
        </CopyChip>
      )}
      {bank.account_holder && <CopyChip text={bank.account_holder}>{bank.account_holder}</CopyChip>}
      {short && (
        <StatusChip tone="neutral" size="sm">
          {short}
        </StatusChip>
      )}
    </div>
  );
}

function CopyChip({
  text,
  className,
  children,
}: {
  text: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title="Скопировать"
      onClick={(e) => {
        e.stopPropagation();
        copy(text);
      }}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-sm whitespace-nowrap hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <Copy className="size-3 shrink-0" />
      {children}
    </button>
  );
}

// --- Карточка сотрудника ---------------------------------------------------------------

type Half = {
  from: string;
  to: string;
  total: number;
  payout: PayrollPayout | null;
};

function EmployeePayroll({
  employee,
  month,
  period,
  summary,
  lines,
  adjustments,
  halves,
  onMarkPaid,
  onUnmark,
}: {
  employee: Employee;
  month: MonthKey;
  period: PeriodKey;
  summary: PayrollSummary;
  lines: PayrollLine[];
  adjustments: PayrollAdjustment[];
  halves: Half[];
  onMarkPaid: (half: Half, amount: number) => Promise<void>;
  onUnmark: (half: Half) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const shifts = lines.filter((l) => l.kind === "shift");
  const lessons = lines.filter(
    (l) => l.kind === "group" || l.kind === "personal" || l.kind === "other",
  );
  const shiftsTotal = shifts.reduce((sum, l) => sum + l.amount, 0);
  const lessonsTotal = lessons.reduce((sum, l) => sum + l.amount, 0);

  const lessonDays = [...new Set(lessons.map((l) => l.work_date))].sort();
  const lessonStudios = [...new Set(lessons.map((l) => l.studio_name))];
  const abbrs = studioAbbrs(lessonStudios);
  const run = async (key: string, action: () => Promise<void>) => {
    setPending(key);
    try {
      await action();
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      {/* Шапка — имя и период выплаты; роль, дата выплаты и реквизиты — в таблице
          (решение владельца 2026-11-01: карточка не влезала по высоте). */}
      <SheetHeader className="shrink-0 border-b px-5 py-3 pr-12">
        <div className="flex items-center gap-2.5">
          <EmployeePhoto value={employee.photo_url} name={employee.full_name} className="size-8" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-base leading-tight">
              {employee.full_name}
            </SheetTitle>
            <SheetDescription className="text-xs">{periodTitle(month, period)}</SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-3">
        {shifts.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-sm font-semibold">Выходы администратора</h3>
            <ul className="divide-y rounded-md border">
              {shifts.map((l) => (
                <li
                  key={`${l.work_date}|${l.studio_id}`}
                  className="grid grid-cols-[72px_1fr_auto] items-center gap-2 px-3 py-1.5 text-sm"
                >
                  <span>{dayLabel(l.work_date)}</span>
                  <span className="truncate text-muted-foreground">{l.studio_name}</span>
                  <span className="tabular-nums">{formatPay(l.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex justify-between px-3 text-sm font-semibold">
              <span>
                {shifts.length} {plural(shifts.length, ["смена", "смены", "смен"])}
              </span>
              <span className="tabular-nums">{formatPay(shiftsTotal)}</span>
            </div>
          </section>
        )}

        {lessons.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-sm font-semibold">Тренировки</h3>
            <ul className="divide-y rounded-md border">
              {lessonDays.map((day) => {
                const items = lessons.filter((l) => l.work_date === day);
                return (
                  <li
                    key={day}
                    className="grid grid-cols-[72px_1fr_auto] items-center gap-2 px-3 py-1.5 text-sm"
                  >
                    <span>{dayLabel(day)}</span>
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {items.map((l) => (
                        <span
                          key={`${l.studio_id}|${l.kind}|${l.title ?? ""}`}
                          title={l.studio_name}
                        >
                          {lessonChip(l, abbrs.get(l.studio_name) ?? "")}
                        </span>
                      ))}
                    </span>
                    <span className="tabular-nums">
                      {formatPay(items.reduce((sum, l) => sum + l.amount, 0))}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1.5 flex items-baseline justify-between gap-3 px-3 text-sm">
              <span className="font-semibold">
                {lessonDays.length} {plural(lessonDays.length, ["день", "дня", "дней"])}
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground">
                  {[
                    summary.groups && `групп. ${summary.groups}`,
                    summary.personals && `перс. ${summary.personals}`,
                    summary.others && `проч. ${summary.others}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="font-semibold tabular-nums">{formatPay(lessonsTotal)}</span>
              </span>
            </div>
          </section>
        )}

        {shifts.length === 0 && lessons.length === 0 && (
          <InfoNote variant="empty">За период нет смен и проведённых занятий.</InfoNote>
        )}

        <section className="space-y-2 rounded-lg border px-3 py-2.5">
          <SalePayments
            employeeId={employee.id}
            range={periodRange(month, period)}
            summary={summary}
          />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Бонус {BONUS_RATE * 100}%</span>
            <span className="tabular-nums">{formatPay(summary.bonus)}</span>
          </div>
          <div className="border-t pt-2">
            {adjustments.length === 0 ? (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Корректировки</span>
                <span>—</span>
              </div>
            ) : (
              <>
                <div className="text-sm text-muted-foreground">Корректировки</div>
                <ul className="mt-1 space-y-1">
                  {adjustments.map((a) => {
                    const sign = ADJUSTMENT_KINDS[a.kind].sign;
                    return (
                      <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          {a.reason}{" "}
                          <span className="text-xs text-muted-foreground">
                            {dayLabel(a.adjusted_on)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums",
                            sign < 0 ? "text-rose-600" : "text-emerald-700",
                          )}
                        >
                          {signedMoney(sign * Number(a.amount))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
          <div className="flex items-baseline justify-between border-t pt-2">
            <span className="font-semibold">Итого к выплате</span>
            <span className="text-lg font-semibold tabular-nums">{formatPay(summary.total)}</span>
          </div>
        </section>
      </div>

      <div
        className={cn(
          "shrink-0 gap-3 border-t px-5 py-3",
          halves.length > 1 ? "grid grid-cols-2" : "flex flex-col",
        )}
      >
        {halves.map((h) => {
          const key = `${h.from}|${h.to}`;
          const label =
            halves.length > 1
              ? `${h.from.endsWith("-01") ? "Аванс" : "Основная"} ${Number(h.from.slice(8))}–${Number(h.to.slice(8))}`
              : null;
          return (
            <div key={key} className="space-y-1.5">
              {label && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{label}</span>
                  <span className="tabular-nums">{formatPay(h.total)}</span>
                </div>
              )}
              {h.payout ? (
                <>
                  {/* «Выплачено» и «Отменить отметку» — рядом, в одну строку. */}
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold [&_svg]:size-4",
                        STATUS_TONE_CLASS.positive,
                      )}
                    >
                      <Check />
                      Выплачено
                    </div>
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={pending === key}
                      onClick={() => run(key, () => onUnmark(h))}
                    >
                      {halves.length > 1 ? "Отменить" : "Отменить отметку"}
                    </Button>
                  </div>
                  <div className="text-center text-xs text-muted-foreground">
                    {formatDate(h.payout.paid_at)}
                    {h.payout.paid_by_name && ` — ${h.payout.paid_by_name}`} ·{" "}
                    {formatPay(Number(h.payout.amount))}
                  </div>
                  {!sameAmount(Number(h.payout.amount), h.total) && (
                    <InfoNote variant="warning">
                      После выплаты сумма изменилась: сейчас {formatPay(h.total)}. Доплатите разницу
                      или отмените отметку и отметьте заново.
                    </InfoNote>
                  )}
                </>
              ) : (
                <Button
                  variant="success"
                  className="w-full"
                  disabled={pending === key || h.total <= 0}
                  onClick={() => run(key, () => onMarkPaid(h, h.total))}
                >
                  {pending === key ? <Loader2 className="animate-spin" /> : <Check />}
                  Отметить как выплачено
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** «В:3», «В перс.:1», «Фотосъёмка» — как в старом портале. */
function lessonChip(l: PayrollLine, abbr: string) {
  if (l.kind === "group") return `${abbr}:${l.units}`;
  if (l.kind === "personal") return `${abbr} перс.:${l.units}`;
  return `${l.title ?? "Прочее"}${l.units > 1 ? ` ×${l.units}` : ""}`;
}

// --- Платежи бонуса ---------------------------------------------------------------

/** Строка RPC payroll_sale_payments — платёж, из которого считается бонус. */
type SalePayment = {
  paid_on: string;
  sale_id: string;
  installment_id: string | null;
  sold_at: string;
  studio_id: string;
  studio_name: string;
  client_id: string | null;
  client_name: string;
  membership_name: string;
  sale_kind: string | null;
  amount: number;
  as_seller: boolean;
  as_trainer: boolean;
  installment_no: number | null;
  installments_total: number | null;
  refunded: boolean;
};

/** Как поступил платёж: «Оплата сразу», «Платёж 2 из 3». */
function paymentLabel(p: SalePayment) {
  if (!p.installment_id || !p.installments_total || p.installments_total <= 1)
    return "Оплата сразу";
  return `Платёж ${p.installment_no} из ${p.installments_total}`;
}

/**
 * «Поступило по абонементам» в карточке сотрудника: сумма и число платежей,
 * по нажатию — список платежей, из которых считается бонус (RPC
 * payroll_sale_payments, те же правила, что у payroll_lines).
 */
function SalePayments({
  employeeId,
  range,
  summary,
}: {
  employeeId: string;
  range: { from: string; to: string };
  summary: PayrollSummary;
}) {
  const [open, setOpen] = useState(false);
  const hasPayments = summary.salesCount > 0;
  const { data = [], isLoading } = useQuery({
    queryKey: ["payroll_sale_payments", employeeId, range.from, range.to],
    queryFn: async () =>
      (
        await unwrap<SalePayment[]>(
          supabase.rpc("payroll_sale_payments", {
            _trainer_id: employeeId,
            _from: range.from,
            _to: range.to,
          }),
        )
      ).map((p) => ({ ...p, amount: Number(p.amount) || 0 })),
    enabled: open && hasPayments,
    meta: { errorMessage: "Не удалось загрузить платежи" },
  });

  return (
    <div>
      {/* Одна строка: подпись и число платежей слева, сумма справа; по нажатию — список. */}
      <button
        type="button"
        disabled={!hasPayments}
        aria-expanded={open}
        title={TIPS.sales}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm",
          hasPayments &&
            "cursor-pointer hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        <span className="min-w-0 text-muted-foreground">
          Поступило по абонементам
          <span className="text-xs">
            {" "}
            · {summary.salesCount} {plural(summary.salesCount, ["платёж", "платежа", "платежей"])}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="font-semibold tabular-nums">{formatPay(summary.sales)}</span>
          {hasPayments && (
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          )}
        </span>
      </button>

      {open && hasPayments && (
        <div className="mt-1.5">
          {isLoading ? (
            <div className="space-y-2 rounded-md border p-3">
              {Array.from({ length: Math.min(summary.salesCount, 4) }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y rounded-md border">
              {data.map((p) => (
                <li
                  key={`${p.sale_id}|${p.installment_id ?? "sale"}`}
                  className="grid grid-cols-[56px_1fr_auto] gap-2 px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">{dayLabel(p.paid_on)}</span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {p.client_id ? (
                        <ClientNameLink clientId={p.client_id} crmLink={null}>
                          {p.client_name}
                        </ClientNameLink>
                      ) : (
                        p.client_name
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.membership_name} · {paymentLabel(p)}
                      {p.sold_at !== p.paid_on && ` · продан ${formatDate(p.sold_at)}`}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <span className="truncate">{p.studio_name}</span>
                      {p.as_trainer && !p.as_seller && (
                        <StatusChip tone="neutral" size="sm">
                          Тренер при продаже
                        </StatusChip>
                      )}
                      {p.refunded && (
                        <StatusChip tone="warning" size="sm">
                          Был возврат
                        </StatusChip>
                      )}
                    </div>
                  </div>
                  <span className="tabular-nums">{formatPay(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
