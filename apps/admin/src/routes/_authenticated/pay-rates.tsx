import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { StaffTabs } from "@/components/staff-tabs";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { useTableSort } from "@/hooks/use-table-sort";
import { EmployeePhoto } from "@/components/employee-photo";
import { TableSkeletonRows } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { InfoNote } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { PAY_FORMATS, formatPay, plural, type PayFormat } from "@/lib/payroll";
import {
  TRAINER_ROLES,
  payFormatOf,
  useEmployees,
  usePayRates,
  type Employee,
  type PayRates,
} from "@/lib/staff-directory";
import { PayRatesPageSkeleton } from "@/components/page-skeletons";
import { TrainerPaySchemes } from "@/components/trainer-pay-schemes";
import { useTrainerPaySchemes } from "@/hooks/use-trainer-pay-schemes";

export const Route = createFileRoute("/_authenticated/pay-rates")({
  head: () => ({ meta: [{ title: "Зарплатные ставки — Base40 Admin" }] }),
  pendingComponent: PayRatesPageSkeleton,
  component: PayRatesPage,
});

/**
 * «Зарплатные ставки» — страница раздела «Сотрудники» (справочник —
 * lib/staff-directory.ts): ставки каждого сотрудника справочника
 * (trainer_pay_rates). Читать и править их может только сотрудник с
 * разделом «Сотрудники» (RLS, has_admin_section).
 *
 * У тренера — формат оплаты (решение владельца 2026-11-24): «Классическая»
 * (ставка за тренировку и бонус с продажи) или «Прогрессивная» (групповые по
 * числу пришедших). Суммы прогрессивной ставки у каждого тренера свои
 * (components/trainer-pay-schemes.tsx), заполняются у всех, действуют только
 * при формате «Прогрессивная».
 */

const TIPS = {
  format:
    "Как тренеру считается зарплата. «Классическая» — ставка за тренировку и бонус 5 % с продажи; выплаты 20-го и 1-го. «Прогрессивная» — групповые по числу пришедших по суммам из колонки «Прогрессивная ставка»; выплаты 11-го и 26-го. От формата зависит, на какой вкладке «Зарплат» сотрудник.",
  salesPercent:
    "Бонус сотрудника с поступивших платежей по его продажам. Пусто — 5 %, как у всех. У администратора свой процент (не 5) переносит его в «Зарплатах» на вкладку «Прогрессивная»: выплаты 11-го и 26-го.",
  progressive:
    "Суммы прогрессивной ставки тренера: минимум за малую группу, ₾ за человека, бонус за наполняемость, бонус за абонемент после пробного. Заполняются у каждого тренера, действуют, когда формат оплаты — «Прогрессивная».",
};

/** Ставки: флаг «получает ли сейчас» + сумма в лари за единицу. */
const RATE_KINDS = [
  {
    key: "admin_shift",
    label: "Смена администратора",
    tip: "Сколько сотрудник получает за смену администратором. Включено — он сейчас работает администратором и получает эту ставку.",
  },
  {
    key: "group_training",
    label: "Групповая тренировка",
    tip: "Сколько сотрудник получает за проведённую групповую тренировку.",
  },
  {
    key: "personal_training",
    label: "Персональная тренировка",
    tip: "Сколько сотрудник получает за проведённую персональную тренировку.",
  },
] as const;

type RateKind = (typeof RATE_KINDS)[number]["key"];
type RatePatch = Partial<Omit<PayRates, "trainer_id">>;

function PayRatesPage() {
  const queryClient = useQueryClient();
  const { data: employees = [], isLoading: loading } = useEmployees();
  const { data: rates = [], isLoading: ratesLoading } = usePayRates();
  const byEmployee = new Map(rates.map((r) => [r.trainer_id, r]));
  // Ставка — сумма, если сотрудник её сейчас получает; выключенные — в конце.
  const rateOf = (e: Employee, kind: RateKind) => {
    const r = byEmployee.get(e.id);
    return r?.[`${kind}_enabled`] ? r[`${kind}_rate`] : null;
  };
  const sort = useTableSort<Employee>({
    name: (e) => e.full_name,
    admin_shift: (e) => rateOf(e, "admin_shift"),
    group_training: (e) => rateOf(e, "group_training"),
    personal_training: (e) => rateOf(e, "personal_training"),
    format: (e) => PAY_FORMATS[payFormatOf(e, byEmployee.get(e.id))].label,
    sales_percent: (e) => Number(byEmployee.get(e.id)?.sales_percent ?? 5),
  });
  const { data: schemes } = useTrainerPaySchemes();
  const [schemesFor, setSchemesFor] = useState<string | null>(null);
  const schemesEmployee = employees.find((e) => e.id === schemesFor) ?? null;
  const schemeCount = (id: string) =>
    (schemes?.list ?? []).filter((s) => s.trainer_id === id).length;
  const pg = usePagination(sort.apply(employees), undefined, sort.key);

  /** Сохраняет одно изменённое поле; строку ставок заводит при первой правке. */
  const save = async (trainerId: string, patch: RatePatch) => {
    const { data, error } = await supabase
      .from("trainer_pay_rates")
      .upsert({ trainer_id: trainerId, ...patch, updated_at: new Date().toISOString() })
      .select("*")
      .single<PayRates>();
    if (error) {
      toast.error("Ставка не сохранена: " + error.message);
      return false;
    }
    queryClient.setQueryData<PayRates[]>(["trainer_pay_rates"], (prev = []) => [
      ...prev.filter((r) => r.trainer_id !== trainerId),
      data,
    ]);
    // Ставки входят в расчёт «Зарплат».
    queryClient.invalidateQueries({ queryKey: ["payroll_lines"] });
    return true;
  };

  const busy = loading || ratesLoading;

  return (
    <AdminShell title="Зарплатные ставки">
      <div className="space-y-3">
        <StaffTabs />
        <InfoNote>
          Ставки — в лари за смену или тренировку. Переключатель — получает ли сотрудник эту ставку
          сейчас; сумма сохраняется, когда поле теряет фокус. У тренера выбирается формат оплаты:
          «Классическая» — ставка за тренировку и бонус с продажи, «Прогрессивная» — групповые по
          числу пришедших. Суммы прогрессивной ставки заполняются у каждого тренера и действуют
          только при этом формате.
        </InfoNote>
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead {...sort.head("name")}>Сотрудник</TableHead>
                <TableHead tip={TIPS.format} {...sort.head("format")}>
                  Формат оплаты
                </TableHead>
                {RATE_KINDS.map((k) => (
                  <TableHead key={k.key} tip={k.tip} {...sort.head(k.key)}>
                    {k.label}
                  </TableHead>
                ))}
                <TableHead tip={TIPS.salesPercent} {...sort.head("sales_percent")}>
                  Процент с продаж
                </TableHead>
                <TableHead tip={TIPS.progressive}>Прогрессивная ставка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {busy ? (
                <TableSkeletonRows columns={7} />
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Сначала добавьте сотрудников в разделе «Сотрудники».
                  </TableCell>
                </TableRow>
              ) : (
                pg.paged.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <EmployeePhoto value={e.photo_url} name={e.full_name} className="size-8" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{e.full_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {TRAINER_ROLES[e.role]?.label ?? TRAINER_ROLES.trainer.label}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {e.role === "trainer" ? (
                        <FormatCell
                          label={`Формат оплаты: ${e.full_name}`}
                          value={payFormatOf(e, byEmployee.get(e.id))}
                          onSave={(pay_format) => save(e.id, { pay_format })}
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {RATE_KINDS.map((k) => (
                      <TableCell key={k.key}>
                        <RateCell
                          kind={k.key}
                          label={`${k.label}: ${e.full_name}`}
                          rates={byEmployee.get(e.id) ?? null}
                          onSave={(patch) => save(e.id, patch)}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <PercentCell
                        key={byEmployee.get(e.id)?.sales_percent ?? "default"}
                        label={`Процент с продаж: ${e.full_name}`}
                        value={byEmployee.get(e.id)?.sales_percent ?? null}
                        onSave={(sales_percent) => save(e.id, { sales_percent })}
                      />
                    </TableCell>
                    <TableCell>
                      {e.role === "trainer" ? (
                        <div className="flex items-center gap-3">
                          <Button size="sm" variant="outline" onClick={() => setSchemesFor(e.id)}>
                            Настроить
                          </Button>
                          <span className="text-xs whitespace-nowrap text-muted-foreground">
                            {progressiveSummary(
                              schemeCount(e.id),
                              byEmployee.get(e.id)?.trial_sale_bonus ?? null,
                            )}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <DataPagination {...pg} loading={busy} />
        </div>
      </div>
      <Dialog open={!!schemesEmployee} onOpenChange={(v) => !v && setSchemesFor(null)}>
        <DialogContent className="max-w-2xl">
          {schemesEmployee && (
            <TrainerPaySchemes
              key={schemesEmployee.id}
              employee={schemesEmployee}
              rates={byEmployee.get(schemesEmployee.id) ?? null}
              employees={employees}
              allRates={rates}
              onSaveRates={(patch) => save(schemesEmployee.id, patch)}
              onClose={() => setSchemesFor(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

/** «3 схемы · +10 ₾ за пробное» — что заполнено у тренера. */
function progressiveSummary(schemes: number, trialBonus: number | null) {
  if (schemes === 0 && trialBonus == null) return "Не заполнено";
  const parts = [
    schemes > 0 ? `${schemes} ${plural(schemes, ["схема", "схемы", "схем"])}` : "нет схем",
  ];
  if (trialBonus != null) parts.push(`+${formatPay(Number(trialBonus))} за пробное`);
  return parts.join(" · ");
}

/** Формат оплаты тренера — применяется сразу. */
function FormatCell({
  label,
  value,
  onSave,
}: {
  label: string;
  value: PayFormat;
  onSave: (value: PayFormat) => Promise<boolean>;
}) {
  const [pending, setPending] = useState<PayFormat | null>(null);
  return (
    <SegmentedControl
      aria-label={label}
      value={pending ?? value}
      onChange={async (next) => {
        if (next === value || pending) return;
        setPending(next);
        try {
          await onSave(next);
        } finally {
          setPending(null);
        }
      }}
      options={(Object.keys(PAY_FORMATS) as PayFormat[]).map((f) => ({
        value: f,
        label: PAY_FORMATS[f].label,
        title: PAY_FORMATS[f].tip,
      }))}
    />
  );
}

/** Свой процент с продаж: пусто или 5 — как у всех (хранится null). */
function PercentCell({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number | null;
  onSave: (value: number | null) => Promise<boolean>;
}) {
  const shown = value == null ? "" : String(Number(value)).replace(".", ",");
  const [text, setText] = useState(shown);
  const [pending, setPending] = useState(false);

  const commit = async () => {
    const t = text.trim().replace(",", ".");
    const n = t === "" ? null : Number(t);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
      toast.error("Процент — число от 0 до 100");
      setText(shown);
      return;
    }
    const next = n === 5 ? null : n;
    if (next === (value == null ? null : Number(value))) {
      setText(shown);
      return;
    }
    setPending(true);
    try {
      if (!(await onSave(next))) setText(shown);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative w-24">
      <Input
        inputMode="decimal"
        value={text}
        disabled={pending}
        aria-label={label}
        placeholder="5"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="pr-7 tabular-nums"
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
        %
      </span>
    </div>
  );
}

/** Ячейка ставки: переключатель «получает» и сумма (правится при включённой ставке). */
function RateCell({
  kind,
  label,
  rates,
  onSave,
}: {
  kind: RateKind;
  label: string;
  rates: PayRates | null;
  onSave: (patch: RatePatch) => Promise<boolean>;
}) {
  const enabled = rates?.[`${kind}_enabled`] ?? false;
  const saved = rates?.[`${kind}_rate`] ?? null;
  const [amount, setAmount] = useState(saved === null ? "" : String(saved));
  const [pending, setPending] = useState(false);

  const run = async (patch: RatePatch) => {
    setPending(true);
    try {
      return await onSave(patch);
    } finally {
      setPending(false);
    }
  };

  const commitAmount = async () => {
    const text = amount.trim().replace(",", ".");
    const value = text === "" ? null : Number(text);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Ставка — неотрицательное число");
      setAmount(saved === null ? "" : String(saved));
      return;
    }
    if (value === saved) return;
    if (!(await run({ [`${kind}_rate`]: value }))) setAmount(saved === null ? "" : String(saved));
  };

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={enabled}
        disabled={pending}
        aria-label={label}
        onCheckedChange={(checked) => run({ [`${kind}_enabled`]: checked })}
      />
      <div className="relative w-28">
        <Input
          inputMode="decimal"
          value={amount}
          disabled={!enabled || pending}
          aria-label={`${label}, сумма`}
          placeholder="0"
          onChange={(e) => setAmount(e.target.value)}
          onBlur={commitAmount}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="pr-7 tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          ₾
        </span>
      </div>
    </div>
  );
}
