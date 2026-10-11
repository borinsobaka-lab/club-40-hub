import { createFileRoute } from "@tanstack/react-router";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Copy, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { useConfirm } from "@/components/confirm-dialog";
import { EmployeePhoto, TrainerRoleBadge } from "@/components/employee-photo";
import { TableSkeletonRows } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { TableToolbar, ToolbarReset, ToolbarSearch } from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  usePayrollAdjustments,
  usePayrollScope,
  type Employee,
  type TrainerRole,
} from "@/lib/staff-directory";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/payroll")({
  head: () => ({ meta: [{ title: "Зарплаты — Base40 Admin" }] }),
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
    "Деньги по абонементам, поступившие за период: первые платежи и доплаты по рассрочкам, в том числе по абонементам, проданным раньше. Администратору — по продажам, где он выбран администратором (кроме пакетов персональных тренировок), тренеру — где он тренер при продаже.",
  bonus: "5 % от поступивших платежей.",
  adjustments: "Вычеты и надбавки из «Графика администраторов» с датой в этом периоде.",
  total: "Оклад + бонус 5 % + корректировки.",
  status:
    "Нажмите, чтобы отметить выплату. В режиме «Весь месяц» выплаты отмечаются в карточке сотрудника — по половинам месяца.",
};

const ALL = "all";
type StatusFilter = typeof ALL | "unpaid" | "paid";
type RowStatus = "paid" | "partial" | "unpaid" | "none";

const STATUS_VIEW: Record<RowStatus, { label: string; className: string }> = {
  paid: { label: "Выплачено", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  partial: { label: "Частично", className: "border-sky-200 bg-sky-50 text-sky-700" },
  unpaid: { label: "Не выплачено", className: "border-amber-200 bg-amber-50 text-amber-700" },
  none: { label: "—", className: "border-transparent text-muted-foreground" },
};

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
      Number(b.role === "admin") - Number(a.role === "admin") ||
      a.full_name.localeCompare(b.full_name, "ru"),
  );
  const term = search.trim().toLowerCase();
  const rows = sorted.filter(
    (e) =>
      (roleFilter === ALL || e.role === roleFilter) &&
      (!term || e.full_name.toLowerCase().includes(term)) &&
      (statusFilter === ALL ||
        (statusFilter === "paid" ? statusOf(e.id) === "paid" : statusOf(e.id) !== "paid")),
  );
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
        <TableToolbar>
          <div className="toolbar-full flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Предыдущий месяц"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-32 text-center text-sm font-semibold max-sm:flex-1">
              {monthLabel(month)}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Следующий месяц"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <Tabs
            value={period}
            onValueChange={(v) => setPeriod(v as PeriodKey)}
            className="toolbar-full"
          >
            <TabsList className="max-sm:w-full">
              {(["advance", "main", "month"] as PeriodKey[]).map((p) => (
                <TabsTrigger key={p} value={p} className="max-sm:flex-1">
                  {periodLabel(month, p)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="toolbar-full flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:ml-auto">
            <span className="flex items-center gap-1">
              Выплачено:{" "}
              {loading ? (
                <Skeleton className="h-4 w-16" />
              ) : (
                <b className="text-emerald-600 tabular-nums">{formatPay(paidTotal)}</b>
              )}
            </span>
            <span className="flex items-center gap-1">
              Осталось:{" "}
              {loading ? (
                <Skeleton className="h-4 w-16" />
              ) : (
                <b className="text-amber-600 tabular-nums">{formatPay(leftTotal)}</b>
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
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все роли</SelectItem>
                  {(Object.keys(TRAINER_ROLES) as TrainerRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {r === "admin" ? "Администраторы" : "Тренеры"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger className="w-44">
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
                    <TableHead>Сотрудник</TableHead>
                    <TableHead>Роль</TableHead>
                    <TableHead className="text-right" tip={TIPS.base}>
                      Оклад
                    </TableHead>
                    <TableHead className="text-right" tip={TIPS.sales}>
                      Продажи
                    </TableHead>
                    <TableHead className="text-right" tip={TIPS.bonus}>
                      Бонус {BONUS_RATE * 100}%
                    </TableHead>
                    <TableHead className="text-right" tip={TIPS.adjustments}>
                      Корректир.
                    </TableHead>
                    <TableHead className="text-right" tip={TIPS.total}>
                      Итого
                    </TableHead>
                    <TableHead tip={TIPS.status}>Статус</TableHead>
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
                              s.adjustments > 0 && "text-emerald-600",
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
        "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-80",
        view.className,
      )}
    >
      {status === "paid" && <Check className="size-3.5" />}
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
          className="cursor-pointer text-left font-medium hover:underline"
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
        "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground",
        wrap ? "text-xs" : "text-[11px]",
      )}
    >
      {bank.account_number && (
        <CopyChip text={bank.account_number} className={cn(wrap && "font-mono")}>
          {wrap ? formatIban(bank.account_number) : bank.account_number}
        </CopyChip>
      )}
      {bank.account_holder && <CopyChip text={bank.account_holder}>{bank.account_holder}</CopyChip>}
      {short && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
          {short}
        </span>
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
        "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap hover:text-foreground",
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
  const payOn = payDate(month, period);

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
      <SheetHeader className="shrink-0 border-b px-6 py-4 pr-12">
        <div className="flex items-center gap-3">
          <EmployeePhoto value={employee.photo_url} name={employee.full_name} className="size-12" />
          <div className="min-w-0 space-y-1">
            <SheetTitle className="truncate">{employee.full_name}</SheetTitle>
            <SheetDescription className="sr-only">
              Зарплата за {periodTitle(month, period)}
            </SheetDescription>
            <TrainerRoleBadge role={employee.role} />
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
        <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <div>Период: {periodTitle(month, period)}</div>
          {payOn && (
            <div className="text-xs text-muted-foreground">Выплата {formatDate(payOn)}</div>
          )}
        </div>

        <BankLine employee={employee} wrap />

        {shifts.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Выходы администратора</h3>
            <ul className="space-y-1">
              {shifts.map((l) => (
                <li
                  key={`${l.work_date}|${l.studio_id}`}
                  className="grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm"
                >
                  <span>{dayLabel(l.work_date)}</span>
                  <span className="truncate text-muted-foreground">{l.studio_name}</span>
                  <span className="tabular-nums">{formatPay(l.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between px-3 text-sm font-semibold">
              <span>
                {shifts.length} {plural(shifts.length, ["смена", "смены", "смен"])}
              </span>
              <span className="tabular-nums">{formatPay(shiftsTotal)}</span>
            </div>
          </section>
        )}

        {lessons.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Тренировки</h3>
            <ul className="space-y-1">
              {lessonDays.map((day) => {
                const items = lessons.filter((l) => l.work_date === day);
                return (
                  <li
                    key={day}
                    className="grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm"
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
            <div className="mt-2 flex justify-between px-3 text-sm font-semibold">
              <span>
                {lessonDays.length} {plural(lessonDays.length, ["день", "дня", "дней"])}
              </span>
              <span className="tabular-nums">{formatPay(lessonsTotal)}</span>
            </div>
            <p className="mt-1 px-3 text-xs text-muted-foreground">
              {[
                summary.groups && `групповых ${summary.groups}`,
                summary.personals && `персональных ${summary.personals}`,
                summary.others && `прочих ${summary.others}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {lessonStudios.length > 1 && (
              <p className="px-3 text-xs text-muted-foreground">
                {lessonStudios.map((n) => `${abbrs.get(n)} — ${n}`).join(", ")}
              </p>
            )}
          </section>
        )}

        {shifts.length === 0 && lessons.length === 0 && (
          <InfoNote variant="empty">За период нет смен и проведённых занятий.</InfoNote>
        )}

        <section className="space-y-3 rounded-xl border p-4">
          <div>
            <div className="text-sm text-muted-foreground">Поступило по абонементам</div>
            <div className="mt-1 flex items-baseline justify-between rounded-md bg-muted/60 px-3 py-2">
              <span className="font-semibold tabular-nums">{formatPay(summary.sales)}</span>
              <span className="text-xs text-muted-foreground">
                {summary.salesCount} {plural(summary.salesCount, ["платёж", "платежа", "платежей"])}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Первые платежи и доплаты по рассрочкам за период.
            </p>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Бонус {BONUS_RATE * 100}%</span>
            <span className="tabular-nums">{formatPay(summary.bonus)}</span>
          </div>
          <div className="border-t pt-3">
            <div className="text-sm text-muted-foreground">Корректировки</div>
            {adjustments.length === 0 ? (
              <div className="mt-1 text-sm text-muted-foreground">—</div>
            ) : (
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
                          sign < 0 ? "text-rose-600" : "text-emerald-600",
                        )}
                      >
                        {signedMoney(sign * Number(a.amount))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="font-semibold">Итого к выплате</span>
            <span className="text-lg font-bold text-brand tabular-nums">
              {formatPay(summary.total)}
            </span>
          </div>
        </section>
      </div>

      <div className="shrink-0 space-y-3 border-t px-6 py-4">
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
                  <div className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 py-3 font-semibold text-emerald-700">
                    <Check className="size-4" />
                    Выплачено
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    disabled={pending === key}
                    onClick={() => run(key, () => onUnmark(h))}
                  >
                    Отменить отметку
                  </Button>
                </>
              ) : (
                <Button
                  className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700"
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
