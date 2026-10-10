import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useServerTable } from "@/hooks/use-server-table";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { STAFF_ROLES } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { DataPagination } from "@/components/data-pagination";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { formatDateTime, formatMoneyPrecise, toDateTimeLocalValue } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/cash")({
  head: () => ({ meta: [{ title: "Касса — Base40 Admin" }] }),
  component: CashPage,
});

type CashKind = "income" | "expense";

type CashOp = {
  id: string;
  studio_id: string;
  user_id: string | null;
  kind: CashKind;
  category: string;
  amount: number;
  comment: string;
  occurred_at: string;
  created_at: string;
};

type Operator = { id: string; full_name: string | null; email: string | null };

const CATEGORIES: Record<CashKind, { value: string; label: string }[]> = {
  income: [
    { value: "membership", label: "Продажа абонемента" },
    { value: "single_visit", label: "Разовое посещение" },
    { value: "merch", label: "Продажа товара" },
    { value: "other_income", label: "Прочий доход" },
  ],
  expense: [
    { value: "salary", label: "Зарплата" },
    { value: "rent", label: "Аренда" },
    { value: "supplies", label: "Расходники / закупка" },
    { value: "utilities", label: "Коммунальные / связь" },
    { value: "marketing", label: "Маркетинг" },
    { value: "other_expense", label: "Прочий расход" },
  ],
};

const ALL_CATEGORIES = [...CATEGORIES.income, ...CATEGORIES.expense];

function categoryLabel(v: string) {
  return ALL_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

function operatorLabel(o: Operator) {
  return o.full_name || o.email || o.id.slice(0, 8);
}

function CashPage() {
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  // Форма после сохранения монтируется заново — так все поля возвращаются
  // к начальным значениям (приход, сейчас, текущий сотрудник) без ручного сброса.
  const [formKey, setFormKey] = useState(0);

  const table = useServerTable<CashOp>({
    queryKey: ["cash_operations", studioId],
    queryFn: ({ from, to }) =>
      supabase
        .from("cash_operations")
        .select("*", { count: "exact" })
        .eq("studio_id", studioId!)
        .order("occurred_at", { ascending: false })
        .range(from, to),
    enabled: !!studioId,
    errorMessage: "Не удалось загрузить операции",
  });

  // Итоги считает БД по всем операциям студии, а не по текущей странице, —
  // поэтому это отдельный запрос, который не повторяется при листании таблицы.
  const { data: totalsRow } = useQuery({
    queryKey: ["cash_totals", studioId],
    queryFn: () =>
      unwrap<{ income: number | null; expense: number | null } | null>(
        supabase
          .from("cash_totals")
          .select("income, expense")
          .eq("studio_id", studioId!)
          .maybeSingle(),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить итоги кассы" },
  });
  const income = Number(totalsRow?.income ?? 0);
  const expense = Number(totalsRow?.expense ?? 0);

  // Сотрудники студии: выбор «кто проводит» и подпись операций в истории.
  const { data: operators = [] } = useQuery({
    queryKey: ["user_roles", studioId, "operators"],
    queryFn: async () => {
      const roles = await unwrap<{ user_id: string }[]>(
        supabase
          .from("user_roles")
          .select("user_id")
          .eq("studio_id", studioId!)
          .in("role", STAFF_ROLES),
      );
      const ids = Array.from(new Set(roles.map((r) => r.user_id)));
      if (ids.length === 0) return [];
      return unwrap<Operator[]>(
        supabase.from("profiles").select("id, full_name, email").in("id", ids),
      );
    },
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить сотрудников" },
  });

  const operatorName = (id: string | null) => {
    if (!id) return "—";
    const op = operators.find((o) => o.id === id);
    return op ? operatorLabel(op) : id.slice(0, 8);
  };

  const onSaved = () => {
    setFormKey((k) => k + 1);
    queryClient.invalidateQueries({ queryKey: ["cash_operations"] });
    queryClient.invalidateQueries({ queryKey: ["cash_totals"] });
  };

  return (
    <AdminShell title="Касса">
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          {/* Balance */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-background p-6 sm:col-span-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Wallet className="h-4 w-4" />
                Баланс кассы
              </div>
              <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
                {formatMoneyPrecise(income - expense)}
              </div>
            </div>
            <div className="rounded-xl border bg-background p-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                Приход (всего)
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-600">
                {formatMoneyPrecise(income)}
              </div>
            </div>
            <div className="rounded-xl border bg-background p-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingDown className="h-4 w-4 text-rose-600" />
                Расход (всего)
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-rose-600">
                {formatMoneyPrecise(expense)}
              </div>
            </div>
          </div>

          <CashOperationForm
            key={formKey}
            studioId={studioId!}
            operators={operators}
            onSaved={onSaved}
          />

          {/* History */}
          <div className="rounded-xl border bg-background">
            <div className="border-b px-4 py-2 text-sm font-semibold">История операций</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Категория</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.loading ? (
                  <TableSkeletonRows columns={6} />
                ) : table.rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Пока нет операций.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.rows.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(o.occurred_at)}
                      </TableCell>
                      <TableCell>
                        {o.kind === "income" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            <TrendingUp className="h-3 w-3" /> Приход
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                            <TrendingDown className="h-3 w-3" /> Расход
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{categoryLabel(o.category)}</TableCell>
                      <TableCell
                        className={
                          "whitespace-nowrap font-medium tabular-nums " +
                          (o.kind === "income" ? "text-emerald-600" : "text-rose-600")
                        }
                      >
                        {o.kind === "income" ? "+" : "−"}
                        {formatMoneyPrecise(Number(o.amount))}
                      </TableCell>
                      <TableCell className="text-sm">{operatorName(o.user_id)}</TableCell>
                      <TableCell className="max-w-[320px] truncate text-sm text-muted-foreground">
                        {o.comment}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <DataPagination {...table.pagination} />
          </div>
        </RequireStudio>
      </div>
    </AdminShell>
  );
}

function CashOperationForm({
  studioId,
  operators,
  onSaved,
}: {
  studioId: string;
  operators: Operator[];
  onSaved: () => void;
}) {
  const { data: me, ensure: ensureMe } = useStaffProfile();
  const [kind, setKind] = useState<CashKind>("income");
  const [category, setCategory] = useState(CATEGORIES.income[0].value);
  const [amount, setAmount] = useState("");
  // Пусто — значит «текущий сотрудник»: профиль может загрузиться позже формы.
  const [operatorId, setOperatorId] = useState("");
  const [comment, setComment] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeLocalValue());
  const [saving, setSaving] = useState(false);

  const selectedOperatorId = operatorId || me?.id || "";

  const changeKind = (next: CashKind) => {
    setKind(next);
    // Категории прихода и расхода не пересекаются — выбранная от другого вида
    // в новом списке не найдётся.
    setCategory(CATEGORIES[next][0].value);
  };

  const handleSave = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("Укажите сумму больше нуля");
      return;
    }
    if (!comment.trim()) {
      toast.error("Комментарий обязателен");
      return;
    }
    // Пустое поле даты даёт Invalid Date, а toISOString() на нём бросает исключение.
    const occurred = new Date(occurredAt);
    if (!occurredAt || Number.isNaN(occurred.getTime())) {
      toast.error("Укажите дату и время операции");
      return;
    }
    setSaving(true);
    try {
      // Оператор не выбран вручную — текущий сотрудник (дожидаемся профиля,
      // если «Сохранить» нажали раньше, чем он загрузился).
      const operator = operatorId || (await ensureMe())?.id || null;
      const { error } = await supabase.from("cash_operations").insert({
        studio_id: studioId,
        user_id: operator,
        kind,
        category,
        amount: amt,
        comment: comment.trim(),
        occurred_at: occurred.toISOString(),
      });
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success("Операция сохранена");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="rounded-xl border bg-background p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">Новая операция</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Field label="Тип">
          <Select value={kind} onValueChange={(v) => changeKind(v as CashKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="income">Приход</SelectItem>
              <SelectItem value="expense">Расход</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Категория">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES[kind].map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Сумма, ₾" required>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="Кто проводит">
          <Select value={selectedOperatorId} onValueChange={setOperatorId}>
            <SelectTrigger>
              <SelectValue placeholder="Сотрудник" />
            </SelectTrigger>
            <SelectContent>
              {operators.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {operatorLabel(o)}
                  {me?.id === o.id ? " (вы)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Дата и время" required className="sm:col-span-2 xl:col-span-1">
          <Input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </Field>
        <Field label="Комментарий" required className="col-span-full">
          <Textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="За что / от кого / основание"
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" loading={saving}>
          {!saving && <Plus />}
          Сохранить
        </Button>
      </div>
    </form>
  );
}
