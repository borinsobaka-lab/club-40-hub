import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { RequireFormat } from "@/components/require-format";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useServerTable } from "@/hooks/use-server-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useCrmLinks } from "@/hooks/use-crm-links";
import { supabase } from "@/integrations/supabase/client";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  SALE_TIPS,
  saleDeleteDescription,
  type MembershipKind,
  type PaymentMethod,
} from "@/lib/payments";
import {
  clientName,
  formatDate,
  formatMoney,
  phoneSearchTerm,
  sanitizeSearch,
  todayISO,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, SwitchRow } from "@/components/ui/form-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { DataPagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarReset, ToolbarSearch } from "@/components/table-toolbar";
import { TableSkeletonRows } from "@/components/skeletons";
import { ClientNameLink } from "@/components/client-name-link";
import { CommentCell } from "@/components/comment-cell";
import { RowContextMenu } from "@/components/row-context-menu";
import { useConfirm } from "@/components/confirm-dialog";

// «Абонементы» пакетной студии (STUDIO_FORMATS.md): проданные клиентам
// абонементы, одна строка — одна продажа. Здесь администраторы собирают деньги
// по рассрочкам: отмечают внесённые платежи, правят суммы и даты, пишут свой
// комментарий. Строки — вью client_packages_list
// (db/migrations/2026-10-11_packages_client_memberships.sql, последняя версия —
// 2026-10-11_zz_packages_personal_balance.sql): платежи и состояние оплаты
// (полоска слева) считает база, фильтр по нему — на сервере.

/** Подсказки «?» колонок и полей. */
const TIPS = {
  client: "Кому продан абонемент. Нажмите на имя — откроется карточка клиента.",
  membership: "Что продано (из «Номенклатур») и дата продажи.",
  balance:
    "Тренировок на балансе (из скольких в пакете), ниже — персональных, если они входят, и сколько дней осталось до конца срока. Групповые списываются, когда отмечено посещение группового занятия, персональные — персонального. Срок задан в «Номенклатурах» и считается от даты продажи.",
  soldBy: `Кто продал — администратор, оформивший продажу. Ниже — тренер при продаже. ${SALE_TIPS.trainer}`,
  comments:
    "«При продаже» — комментарий из «Продаж», здесь его не меняют. Ниже — ваш комментарий к абонементу: договорённости с клиентом об оплате, напоминания. Нажмите, чтобы изменить.",
  note: "Договорённости с клиентом об оплате, напоминания — видно всем администраторам клуба.",
  payment:
    "Сумма и дата платежа. Галочка — внесён (дата, когда заплатили), без неё — сколько и до какого числа клиент должен внести. Нажмите, чтобы отметить оплату или поправить сумму и дату.",
  amount: "Сколько клиент внёс или должен внести этим платежом.",
  dueDate:
    "До какого числа клиент должен внести платёж. За два дня до даты и в сам день невнесённый платёж помечает строку синим, дата прошла — красным.",
  paid: "Отметьте, когда клиент заплатил. Внесены все платежи — строка станет зелёной.",
  paidAt: "Когда клиент фактически заплатил.",
  paymentMethod: "Как заплатил клиент — для отчётов, как способ оплаты в «Продажах».",
  renewal:
    "Продление: тренировки списываются после текущего абонемента, срок идёт с первого посещения по нему.",
};

/**
 * Состояние оплаты (client_packages_list.payment_state) — цвет полоски строки:
 * всё внесено, просрочка, невнесённый платёж сегодня или в ближайшие 2 дня.
 * Платёж позже (pending) не подсвечивается (решение владельца 2026-10-11).
 */
type PaymentState = "paid" | "overdue" | "soon" | "pending";

const PAYMENT_STATES: Record<
  PaymentState,
  {
    label: string;
    filter: string;
    /** Полоска слева; null — без полоски. */
    stripe: string | null;
    /** Тот же цвет — рамкой карточки на телефоне (там строка — блок). */
    mobile: string | null;
  }
> = {
  paid: {
    label: "Оплачен полностью",
    filter: "Оплачены полностью",
    stripe: "bg-emerald-500",
    mobile: "max-md:border-l-4 max-md:border-l-emerald-500",
  },
  overdue: {
    label: "Просрочен платёж",
    filter: "С просрочкой",
    stripe: "bg-rose-500",
    mobile: "max-md:border-l-4 max-md:border-l-rose-500",
  },
  soon: {
    label: "Платёж в ближайшие 3 дня",
    filter: "Платёж в ближайшие 3 дня",
    stripe: "bg-blue-500",
    mobile: "max-md:border-l-4 max-md:border-l-blue-500",
  },
  pending: { label: "Следующий платёж позже", filter: "Платёж позже", stripe: null, mobile: null },
};
const PAYMENT_STATE_ORDER: PaymentState[] = ["overdue", "soon", "pending", "paid"];
/** Цвета расшифровки на плашке фильтров. */
const STRIPED_STATES: PaymentState[] = ["paid", "overdue", "soon"];
const ALL = "all";

type Payment = {
  /** null — продажа без графика: оплачена сразу, править нечего. */
  id: string | null;
  amount: number;
  due_date: string;
  paid: boolean;
  paid_at: string | null;
  /** Способ оплаты внесённого платежа; null — не указан (старые платежи). */
  payment_method: PaymentMethod | null;
};

type Row = {
  id: string;
  client_id: string;
  admin_name: string | null;
  trainer_name: string | null;
  sold_at: string;
  comment: string | null;
  membership_note: string | null;
  clients: {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  } | null;
  memberships: {
    id: string;
    name: string;
    kind: MembershipKind;
    visits_count: number | null;
    /** Персональных в номенклатуре: подарочные или количество у пакета персональных. */
    personal_count: number | null;
  } | null;
  membership_status: string | null;
  visits_left: number | null;
  /** Остаток персональных (пакетный формат). */
  personal_left: number | null;
  ends_at: string | null;
  payments: Payment[];
  payment_state: PaymentState;
  /** Начало срока; у продления — дата первого посещения (null — ещё не было). */
  membership_started_at: string | null;
  /** Продление: срок считается от первого посещения. */
  starts_on_first_visit: boolean;
};

const COLUMNS =
  "id, client_id, admin_name, trainer_name, sold_at, comment, membership_note, clients, " +
  "memberships, membership_status, visits_left, personal_left, ends_at, payments, payment_state, " +
  "membership_started_at, starts_on_first_visit";

/** Платёжных колонок не меньше трёх: обычная рассрочка — до трёх платежей. */
const MIN_PAYMENT_COLUMNS = 3;
/** Колонки до платежей: клиент, абонемент, баланс, продал / тренер, комментарии. */
const BASE_COLUMNS = 5;

export const Route = createFileRoute("/_authenticated/client-memberships")({
  head: () => ({ meta: [{ title: "Абонементы — Base40 Admin" }] }),
  component: ClientMembershipsRoute,
});

function ClientMembershipsRoute() {
  return (
    <RequireFormat format="packages" title="Абонементы" other={{ subscription: "/sales" }}>
      <ClientMembershipsPage />
    </RequireFormat>
  );
}

/** Дней от сегодня до даты (по календарю, без часовых поясов). */
function daysUntil(iso: string) {
  const toUtc = (v: string) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(iso) - toUtc(todayISO())) / 86_400_000);
}

function ClientMembershipsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<PaymentState | typeof ALL>(ALL);

  const term = sanitizeSearch(useDebouncedValue(search));
  const table = useServerTable<Row>({
    queryKey: ["client_packages_list", studioId, term, state],
    queryFn: async ({ from, to }) => {
      // Досчитать очередь продлений: у кого срок текущего абонемента вышел без
      // записей, продление становится действующим (packages_settle_studio).
      // Ошибку не показываем — список грузится и без этого.
      await supabase.rpc("packages_settle_studio", { p_studio_id: studioId! });
      let q = supabase
        .from("client_packages_list")
        .select(COLUMNS, { count: "exact" })
        .eq("studio_id", studioId!);
      if (term) q = q.ilike("search_text", `%${phoneSearchTerm(term)}%`);
      if (state !== ALL) q = q.eq("payment_state", state);
      // Ждут платежа и просроченные — по ближайшему платежу: сверху те, с кем
      // разбираться первыми. Остальное — новые продажи сверху.
      if (state === "overdue" || state === "soon" || state === "pending")
        q = q.order("next_due_date", { ascending: true });
      return q
        .order("sold_at", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to);
    },
    enabled: !!studioId,
    errorMessage: "Не удалось загрузить абонементы",
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["client_packages_list"] });

  // Строка — продажа: удаляем её, абонемент клиента база удаляет вместе с ней
  // (db/migrations/2026-10-11_zzzzzz_sale_membership_delete.sql).
  const handleDelete = async (r: Row) => {
    if (
      !(await confirm({
        title: "Удалить абонемент?",
        description: saleDeleteDescription(
          r.clients ? clientName(r.clients) : null,
          r.memberships?.name ?? null,
        ),
      }))
    )
      return;
    const { error } = await supabase.from("sales").delete().eq("id", r.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Абонемент и продажа удалены");
    for (const key of [
      "client_packages_list",
      "sales_list",
      "client_memberships",
      "clients_with_status",
    ])
      queryClient.invalidateQueries({ queryKey: [key] });
  };
  const crmLinkOf = useCrmLinks(
    studioId,
    "id",
    table.rows.map((r) => r.client_id),
  );

  const paymentColumns = Math.max(
    MIN_PAYMENT_COLUMNS,
    ...table.rows.map((r) => r.payments?.length ?? 0),
  );
  const columns = BASE_COLUMNS + paymentColumns;
  const filtered = !!term || state !== ALL;

  return (
    <AdminShell title="Абонементы">
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Поиск по клиенту, абонементу, тренеру"
            />
            <Select value={state} onValueChange={(v) => setState(v as PaymentState | typeof ALL)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все абонементы</SelectItem>
                {PAYMENT_STATE_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PAYMENT_STATES[s].filter}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToolbarReset
              active={filtered}
              onReset={() => {
                setSearch("");
                setState(ALL);
              }}
            />
            <StripeLegend />
          </TableToolbar>

          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[170px]" tip={TIPS.client}>
                    Клиент
                  </TableHead>
                  <TableHead tip={TIPS.membership}>Абонемент</TableHead>
                  <TableHead tip={TIPS.balance}>Баланс</TableHead>
                  <TableHead tip={TIPS.soldBy}>Продал / тренер</TableHead>
                  <TableHead tip={TIPS.comments}>Комментарии</TableHead>
                  {Array.from({ length: paymentColumns }, (_, i) => (
                    <TableHead key={i} tip={TIPS.payment}>
                      Платёж {i + 1}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.loading ? (
                  <TableSkeletonRows columns={columns} />
                ) : table.rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {filtered
                        ? "Ничего не найдено."
                        : "Проданных абонементов пока нет. Они появятся здесь после продажи в «Продажах»."}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.rows.map((r) => (
                    <RowContextMenu
                      key={r.id}
                      actions={[
                        {
                          label: "Удалить",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => handleDelete(r),
                        },
                      ]}
                    >
                      <TableRow className={cn(PAYMENT_STATES[r.payment_state].mobile)}>
                        <TableCell className="relative font-medium">
                          {PAYMENT_STATES[r.payment_state].stripe && (
                            <span
                              aria-hidden
                              className={cn(
                                "absolute inset-y-0 left-0 w-1 max-md:hidden",
                                PAYMENT_STATES[r.payment_state].stripe,
                              )}
                            />
                          )}
                          <span className="sr-only">{PAYMENT_STATES[r.payment_state].label}. </span>
                          {r.clients ? (
                            <ClientNameLink clientId={r.client_id} crmLink={crmLinkOf(r.client_id)}>
                              {clientName(r.clients)}
                            </ClientNameLink>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {r.clients?.phone && (
                            <div className="text-xs font-normal text-muted-foreground">
                              {r.clients.phone}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[130px]">
                          <div>{r.memberships?.name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.memberships?.kind === "trial" && "Пробное · "}
                            {r.memberships?.kind === "personal" && "Персональные · "}
                            {formatDate(r.sold_at)}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          <Balance row={r} />
                          <div className="text-xs">
                            <DaysLeft
                              status={r.membership_status}
                              endsAt={r.ends_at}
                              notStarted={r.starts_on_first_visit && !r.membership_started_at}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>{r.admin_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.trainer_name ? `Тренер: ${r.trainer_name}` : "Без тренера"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[200px] space-y-1">
                            {r.comment?.trim() && (
                              <div className="text-xs">
                                <div className="text-muted-foreground/70">При продаже</div>
                                <CommentCell text={r.comment} />
                              </div>
                            )}
                            <NoteCell saleId={r.id} note={r.membership_note} onSaved={reload} />
                          </div>
                        </TableCell>
                        {Array.from({ length: paymentColumns }, (_, i) => (
                          <TableCell key={i}>
                            <PaymentCell payment={r.payments?.[i]} onSaved={reload} />
                          </TableCell>
                        ))}
                      </TableRow>
                    </RowContextMenu>
                  ))
                )}
              </TableBody>
            </Table>

            <DataPagination {...table.pagination} />
          </div>
        </RequireStudio>
      </div>
      {confirmDialog}
    </AdminShell>
  );
}

/** Что значат цвета полосок — справа на плашке фильтров. */
function StripeLegend() {
  return (
    <div className="toolbar-full ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {STRIPED_STATES.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("h-3.5 w-1 rounded-full", PAYMENT_STATES[s].stripe)} />
          {PAYMENT_STATES[s].label}
        </span>
      ))}
    </div>
  );
}

/**
 * Баланс абонемента: групповые тренировки (у пакета персональных их нет) и
 * отдельной строкой персональные — у пакета персональных и у пакета
 * тренировок с подарочными.
 */
function Balance({ row }: { row: Row }) {
  const m = row.memberships;
  const isPersonal = m?.kind === "personal";
  const personalTotal = m?.personal_count ?? 0;
  const line = (left: number | null, total: number | null, unit: string) => (
    <div>
      {left ?? "—"}
      {left != null && total != null && (
        <span className="text-muted-foreground"> из {total}</span>
      )}{" "}
      <span className="text-muted-foreground">{unit}</span>
    </div>
  );
  return (
    <>
      {!isPersonal && line(row.visits_left, m?.visits_count ?? null, "трен.")}
      {(isPersonal || personalTotal > 0) && line(row.personal_left, personalTotal || null, "перс.")}
    </>
  );
}

const ENDED_STATUS: Record<string, string> = {
  replaced: "Заменён новым",
  cancelled: "Отменён",
  expired: "Истёк",
  frozen: "Заморожен",
};

function DaysLeft({
  status,
  endsAt,
  notStarted,
}: {
  status: string | null;
  endsAt: string | null;
  /** Продление, по которому ещё не было посещений: срок пока не идёт. */
  notStarted: boolean;
}) {
  if (status && ENDED_STATUS[status])
    return <span className="text-muted-foreground">{ENDED_STATUS[status]}</span>;
  if (notStarted)
    return (
      <span className="text-muted-foreground" title={TIPS.renewal}>
        {status === "pending" ? "Ждёт окончания текущего" : "Срок — с 1-го посещения"}
      </span>
    );
  if (!endsAt) return <span className="text-muted-foreground">Без срока</span>;
  const days = daysUntil(endsAt);
  if (days < 0) return <span className="text-rose-600">Истёк {formatDate(endsAt)}</span>;
  return (
    <span title={`До ${formatDate(endsAt)} включительно`}>
      {days === 0 ? "Последний день" : `ещё ${days} дн.`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Комментарий раздела (sales.membership_note)
// ---------------------------------------------------------------------------

function NoteCell({
  saleId,
  note,
  onSaved,
}: {
  saleId: string;
  note: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const value = note?.trim();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={value ? "Изменить комментарий" : "Добавить комментарий"}
          className={cn(
            "line-clamp-2 min-w-[140px] max-w-[200px] cursor-pointer whitespace-pre-wrap break-words text-left hover:text-foreground",
            value ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {value || (
            <span className="inline-flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" />
              Комментарий
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        {/* Содержимое монтируется при каждом открытии — поле сбрасывать не нужно. */}
        <NoteForm
          saleId={saleId}
          note={note}
          onDone={() => {
            setOpen(false);
            onSaved();
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function NoteForm({
  saleId,
  note,
  onDone,
  onCancel,
}: {
  saleId: string;
  note: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("sales")
        .update({ membership_note: text.trim() || null })
        .eq("id", saleId);
      if (error) {
        toast.error("Не удалось сохранить комментарий: " + error.message);
        return;
      }
      toast.success("Комментарий сохранён");
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <FormField label="Комментарий" tip={TIPS.note}>
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </FormField>
      <PopoverButtons saving={saving} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Платёж рассрочки (sale_installments)
// ---------------------------------------------------------------------------

function PaymentCell({ payment, onSaved }: { payment?: Payment; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  if (!payment) return <span className="text-muted-foreground">—</span>;

  const overdue = !payment.paid && payment.due_date < todayISO();
  const summary = (
    <>
      <div className="font-medium tabular-nums">{formatMoney(Number(payment.amount))}</div>
      <div
        className={cn(
          "flex items-center gap-1 whitespace-nowrap text-xs",
          payment.paid ? "text-emerald-700" : overdue ? "text-rose-600" : "text-muted-foreground",
        )}
      >
        {payment.paid ? (
          <>
            <Check className="h-3.5 w-3.5" />
            {formatDate(payment.paid_at ?? payment.due_date)}
            {payment.payment_method && ` · ${PAYMENT_METHOD_LABEL[payment.payment_method]}`}
          </>
        ) : (
          <>
            до {formatDate(payment.due_date)}
            {overdue && " · просрочен"}
          </>
        )}
      </div>
    </>
  );

  // Оплата сразу при продаже — графика нет, отмечать нечего.
  if (!payment.id)
    return (
      <div title="Оплачено полностью при продаже" className="text-left">
        {summary}
      </div>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={payment.paid ? "Изменить платёж" : "Отметить оплату"}
          className="cursor-pointer rounded-md text-left hover:opacity-80"
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <PaymentForm
          payment={{ ...payment, id: payment.id }}
          onDone={() => {
            setOpen(false);
            onSaved();
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function PaymentForm({
  payment,
  onDone,
  onCancel,
}: {
  payment: Payment & { id: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(payment.amount ?? ""));
  const [dueDate, setDueDate] = useState(payment.due_date);
  const [paid, setPaid] = useState(payment.paid);
  // Отмечают оплату обычно в день, когда клиент заплатил, — сегодня.
  const [paidAt, setPaidAt] = useState(payment.paid_at ?? todayISO());
  const [method, setMethod] = useState<PaymentMethod>(payment.payment_method ?? "cash");
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const value = Number(amount.replace(",", "."));
    if (!amount.trim() || !Number.isFinite(value) || value < 0) {
      toast.error("Укажите сумму платежа");
      return;
    }
    if (!dueDate) {
      toast.error("Укажите дату платежа");
      return;
    }
    if (paid && !paidAt) {
      toast.error("Укажите, когда платёж внесён");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("sale_installments")
        .update({
          amount: value,
          due_date: dueDate,
          paid,
          paid_at: paid ? paidAt : null,
          payment_method: paid ? method : null,
        })
        .eq("id", payment.id);
      if (error) {
        toast.error("Не удалось сохранить платёж: " + error.message);
        return;
      }
      toast.success(paid ? "Платёж отмечен внесённым" : "Платёж сохранён");
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Сумма, ₾" tip={TIPS.amount} required>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <FormField label="Внести до" tip={TIPS.dueDate} required>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>
      </div>
      <SwitchRow title="Платёж внесён" tip={TIPS.paid} checked={paid} onCheckedChange={setPaid} />
      {paid && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Когда внесён" tip={TIPS.paidAt} required>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </FormField>
          <FormField label="Способ оплаты" tip={TIPS.paymentMethod} required>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      )}
      <PopoverButtons saving={saving} onCancel={onCancel} />
    </form>
  );
}

function PopoverButtons({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" onClick={onCancel} disabled={saving}>
        Отмена
      </Button>
      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Сохранить
      </Button>
    </div>
  );
}
