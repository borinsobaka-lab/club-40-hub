import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { DataPagination, useServerPagination } from "@/components/data-pagination";

export const Route = createFileRoute("/_authenticated/cash")({
  head: () => ({ meta: [{ title: "Касса — CLUB 40 Admin" }] }),
  component: CashPage,
});

type CashOp = {
  id: string;
  studio_id: string;
  user_id: string | null;
  kind: "income" | "expense";
  category: string;
  amount: number;
  comment: string;
  occurred_at: string;
  created_at: string;
};

const INCOME_CATEGORIES = [
  { value: "membership", label: "Продажа абонемента" },
  { value: "single_visit", label: "Разовое посещение" },
  { value: "merch", label: "Продажа товара" },
  { value: "other_income", label: "Прочий доход" },
];

const EXPENSE_CATEGORIES = [
  { value: "salary", label: "Зарплата" },
  { value: "rent", label: "Аренда" },
  { value: "supplies", label: "Расходники / закупка" },
  { value: "utilities", label: "Коммунальные / связь" },
  { value: "marketing", label: "Маркетинг" },
  { value: "other_expense", label: "Прочий расход" },
];

const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

function categoryLabel(v: string) {
  return ALL_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

function formatMoney(v: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "GEL",
    maximumFractionDigits: 2,
  }).format(v);
}

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type Operator = { id: string; full_name: string | null; email: string | null };

function CashPage() {
  const studioId = useActiveStudioId();
  const { user } = useAuth();
  const [ops, setOps] = useState<CashOp[]>([]);
  const [totals, setTotals] = useState({ income: 0, expense: 0 });
  const [operators, setOperators] = useState<Operator[]>([]);
  const pg = useServerPagination();
  const { from, to, setTotal } = pg;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [kind, setKind] = useState<"income" | "expense">("income");
  const [category, setCategory] = useState<string>(INCOME_CATEGORIES[0].value);
  const [amount, setAmount] = useState<string>("");
  const [operatorId, setOperatorId] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [occurredAt, setOccurredAt] = useState<string>(nowLocalInput());

  useEffect(() => {
    if (user?.id && !operatorId) setOperatorId(user.id);
  }, [user?.id, operatorId]);

  const fetchAll = useCallback(async () => {
    if (!studioId) {
      setOps([]);
      setOperators([]);
      setTotals({ income: 0, expense: 0 });
      setTotal(0);
      return;
    }
    setLoading(true);
    const [
      { data: opsData, error: opsErr, count },
      { data: roles, error: rolesErr },
      { data: totalsRow },
    ] = await Promise.all([
      supabase
        .from("cash_operations")
        .select("*", { count: "exact" })
        .eq("studio_id", studioId)
        .order("occurred_at", { ascending: false })
        .range(from, to),
      supabase
        .from("user_roles")
        .select("user_id")
        .eq("studio_id", studioId)
        .in("role", ["owner", "admin", "trainer"]),
      // Итоги считает БД по всем операциям студии, а не по текущей странице.
      supabase
        .from("cash_totals")
        .select("income, expense")
        .eq("studio_id", studioId)
        .maybeSingle(),
    ]);
    if (opsErr) toast.error("Не удалось загрузить операции: " + opsErr.message);
    setOps((opsData as CashOp[]) ?? []);
    setTotal(count ?? 0);
    setTotals({
      income: Number(totalsRow?.income ?? 0),
      expense: Number(totalsRow?.expense ?? 0),
    });

    if (!rolesErr && roles) {
      const ids = Array.from(new Set((roles as any[]).map((r) => r.user_id as string)));
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", ids);
        setOperators(
          ((profs as any[]) ?? []).map((p) => ({
            id: p.id,
            full_name: p.full_name,
            email: p.email,
          })),
        );
      } else {
        setOperators([]);
      }
    }
    setLoading(false);
  }, [studioId, from, to, setTotal]);

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshSignal]);

  // Reset category when kind changes
  useEffect(() => {
    const list = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    if (!list.find((c) => c.value === category)) setCategory(list[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const balance = totals.income - totals.expense;

  const operatorName = (id: string | null) => {
    if (!id) return "—";
    const op = operators.find((o) => o.id === id);
    return op?.full_name || op?.email || id.slice(0, 8);
  };

  const reset = () => {
    setKind("income");
    setCategory(INCOME_CATEGORIES[0].value);
    setAmount("");
    setComment("");
    setOccurredAt(nowLocalInput());
    setOperatorId(user?.id ?? "");
  };

  const handleSave = async () => {
    if (!studioId) {
      toast.error("Выберите студию");
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("Укажите сумму больше нуля");
      return;
    }
    if (!comment.trim()) {
      toast.error("Комментарий обязателен");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("cash_operations").insert({
      studio_id: studioId,
      user_id: operatorId || user?.id || null,
      kind,
      category,
      amount: amt,
      comment: comment.trim(),
      occurred_at: new Date(occurredAt).toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success("Операция сохранена");
    reset();
    fetchAll();
  };

  const categories = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <AdminShell title="Касса">
      <div className="mx-auto max-w-6xl space-y-4">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
            {/* Balance */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border bg-background p-6 sm:col-span-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  Баланс кассы
                </div>
                <div className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                  {formatMoney(balance)}
                </div>
              </div>
              <div className="rounded-xl border bg-background p-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  Приход (всего)
                </div>
                <div className="mt-2 text-2xl font-semibold text-emerald-600">
                  {formatMoney(totals.income)}
                </div>
              </div>
              <div className="rounded-xl border bg-background p-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingDown className="h-4 w-4 text-rose-600" />
                  Расход (всего)
                </div>
                <div className="mt-2 text-2xl font-semibold text-rose-600">
                  {formatMoney(totals.expense)}
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="rounded-xl border bg-background p-4">
              <h2 className="mb-3 text-sm font-semibold">Новая операция</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="space-y-1.5">
                  <Label>Тип</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as "income" | "expense")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Приход</SelectItem>
                      <SelectItem value="expense">Расход</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Категория</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Сумма, ₾</Label>
                  <Input
                    id="amount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Кто проводит</Label>
                  <Select value={operatorId} onValueChange={setOperatorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Сотрудник" />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.full_name || o.email || o.id.slice(0, 8)}
                          {user?.id === o.id ? " (вы)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="occurred">Дата и время</Label>
                  <Input
                    id="occurred"
                    type="datetime-local"
                    value={occurredAt}
                    onChange={(e) => setOccurredAt(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-6">
                  <Label htmlFor="comment">
                    Комментарий <span className="text-rose-600">*</span>
                  </Label>
                  <Textarea
                    id="comment"
                    rows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="За что / от кого / основание"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1 h-4 w-4" />
                  )}
                  Сохранить
                </Button>
              </div>
            </div>

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
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : ops.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Пока нет операций.
                      </TableCell>
                    </TableRow>
                  ) : (
                    ops.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {new Date(o.occurred_at).toLocaleString("ru-RU", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell>
                          {o.kind === "income" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              <TrendingUp className="h-3 w-3" /> Приход
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                              <TrendingDown className="h-3 w-3" /> Расход
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{categoryLabel(o.category)}</TableCell>
                        <TableCell
                          className={
                            "whitespace-nowrap font-medium " +
                            (o.kind === "income" ? "text-emerald-600" : "text-rose-600")
                          }
                        >
                          {o.kind === "income" ? "+" : "−"}
                          {formatMoney(Number(o.amount))}
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
              <DataPagination {...pg} />
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
