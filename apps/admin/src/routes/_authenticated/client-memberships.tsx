import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Banknote,
  Check,
  CreditCard,
  Loader2,
  Plus,
  Receipt,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { RequireFormat } from "@/components/require-format";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useServerTable } from "@/hooks/use-server-table";
import { useTableSort } from "@/hooks/use-table-sort";
import { orderBy } from "@/lib/table-sort";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useCrmLinks } from "@/hooks/use-crm-links";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  SALE_KIND_LABEL,
  SALE_KINDS,
  SALE_ADDED_VIA_LABEL,
  SALE_TIPS,
  addMonthsISO,
  saleDeleteDescription,
  scheduleShortfall,
  type MembershipKind,
  type PaymentMethod,
  type SaleAddedVia,
  type SaleKind,
} from "@/lib/payments";
import {
  clientName,
  formatDate,
  formatMoney,
  formatMoneyPrecise,
  phoneSearchTerm,
  sanitizeSearch,
  todayISO,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, InfoNote } from "@/components/ui/form-field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { TableToolbar, ToolbarReset, ToolbarSearch } from "@/components/table-toolbar";
import { TableSkeletonRows } from "@/components/skeletons";
import { ClientNameLink } from "@/components/client-name-link";
import { CommentCell, noteChipClass } from "@/components/comment-cell";
import { RowContextMenu } from "@/components/row-context-menu";
import { useConfirm } from "@/components/confirm-dialog";
import { ClientMembershipsPageSkeleton } from "@/components/page-skeletons";
import { MembershipStatusBadge } from "@/components/membership-status-badge";
import { SaleDialog } from "@/components/sale-dialog";
import { SaleKindDot, SaleKindPickerDialog } from "@/components/sale-kind-picker";
import { RefundDialog, type RefundSale } from "@/components/refund-dialog";

// «Абонементы» пакетной студии (STUDIO_FORMATS.md): проданные клиентам
// абонементы, одна строка — одна продажа. С 2026-10-13 это и раздел продаж
// пакетного клуба («Продаж» у него нет): кнопка «Продажа», возврат и удаление
// — здесь. Администраторы собирают деньги по рассрочкам: отмечают внесённые
// платежи, правят суммы и даты, пишут свой комментарий. Строки — вью
// client_packages_list (последняя версия —
// db/migrations/2026-10-13_packages_memberships_sales_merge.sql): платежи и
// состояние оплаты (полоска слева) считает база, фильтр по нему — на сервере.

/** Подсказки «?» колонок и полей. */
const TIPS = {
  client: "Кому продан абонемент: телефон и почта. Нажмите на имя — откроется карточка клиента.",
  membership: `Что продано (из «Номенклатур») и тип продажи: «С» — дата продажи, «До» — последний день срока абонемента. У продления срок появится после первого посещения по нему. ${SALE_TIPS.saleKind}`,
  status:
    "Действует, ждёт начала (продление), истёк, заменён новым и т. п. Ниже — сколько дней осталось до конца срока.",
  balance:
    "Тренировок на балансе (из скольких в пакете), ниже — персональных, если они входят. Групповые списываются, когда отмечено посещение группового занятия, персональные — персонального. Срок задан в «Номенклатурах» и считается от даты продажи.",
  amount:
    "Стоимость продажи (со скидкой). Ниже — сколько из неё уже внесено, промокод и возвраты. Возврат — правый клик (касание) по строке.",
  soldBy: `Кто продал — администратор, оформивший продажу. Ниже — тренер при продаже. ${SALE_TIPS.trainer}`,
  addedVia:
    "Как абонемент попал в базу: внесён в админке, перенесён из 1С или куплен клиентом в приложении. Ставит база.",
  comments:
    "«При продаже» — комментарий из формы продажи, здесь его не меняют. Ниже — ваш комментарий к абонементу: договорённости с клиентом об оплате, напоминания. Нажмите, чтобы изменить.",
  note: "Договорённости с клиентом об оплате, напоминания — видно всем администраторам клуба.",
  payment:
    "Платежи по порядку: сумма и дата. Зелёный — внесён (дата, когда заплатили, справа — иконка способа оплаты), серый — сколько и до какого числа клиент должен внести, синий — внести сегодня или в ближайшие 2 дня, красный — просрочен. Нажмите на платёж, чтобы отметить оплату (когда и как внесён). «Редактировать платежи» — разбить невнесённый остаток на другие платежи и даты.",
  editPayments:
    "Клиент не может внести платёж целиком — поставьте в платёж сумму, которую он внёс, и добавьте платежи на остаток. Внесённые платежи не меняются. Сохранить можно, только если платежи в сумме покрывают стоимость абонемента.",
  paymentAmount: "Сколько клиент внёс или должен внести этим платежом.",
  dueDate:
    "До какого числа клиент должен внести платёж. За два дня до даты и в сам день невнесённый платёж помечает строку синим, дата прошла — красным.",
  paidAt: "Когда клиент фактически заплатил.",
  paymentMethod: "Как заплатил клиент — для отчётов, как способ оплаты в форме продажи.",
  renewal:
    "Срок абонемента идёт с первого посещения: пока клиент не пришёл, абонемент ожидает посещения. Продление — тренировки списываются после текущего абонемента.",
  nextPayment:
    "Абонементы, у которых ближайший невнесённый платёж приходится на выбранные даты. Одна дата — платежи за этот день, две — за период.",
};

/**
 * Состояние оплаты (client_packages_list.payment_state) — цвет полоски строки:
 * всё внесено, просрочка, невнесённый платёж сегодня или в ближайшие 2 дня.
 * Платёж позже (pending) не подсвечивается (решение владельца 2026-10-11).
 */
type PaymentState = "paid" | "overdue" | "soon" | "pending" | "refunded";

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
  // Оформлен возврат: платежей больше не ждём — ни в один фильтр по платежам
  // не попадает (решение владельца 2026-10-13).
  refunded: { label: "Возврат", filter: "Возврат", stripe: null, mobile: null },
};
// Цветные (с точкой в фильтре) — первыми (решение владельца 2026-10-14).
const PAYMENT_STATE_ORDER: PaymentState[] = ["overdue", "soon", "paid", "pending", "refunded"];
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
  /** Снят возвратом: не вносится (вместо суммы и даты — «Возврат»). */
  refunded?: boolean;
};

type Row = {
  id: string;
  client_id: string;
  admin_name: string | null;
  trainer_name: string | null;
  studio_id: string;
  sold_at: string;
  total_amount: number;
  /** Сколько из стоимости внесено (без графика — вся сумма). */
  paid_amount: number;
  /** Тип продажи; null — без типа (покупка в приложении, старые продажи). */
  sale_kind: SaleKind | null;
  /** Откуда продажа: админка или клиентское приложение. */
  source: "admin" | "mobile" | null;
  /** «Добавлен»: админка, импорт из 1С или приложение (считает вью). */
  added_via: SaleAddedVia | null;
  promo_code: string | null;
  comment: string | null;
  membership_note: string | null;
  clients: {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  memberships: {
    id: string;
    name: string;
    kind: MembershipKind;
    visits_count: number | null;
    /** Персональных в номенклатуре: подарочные или количество у пакета персональных. */
    personal_count: number | null;
    /** Диагностик тела в номенклатуре. */
    diagnostics_count?: number | null;
  } | null;
  membership_status: string | null;
  visits_left: number | null;
  /** Остаток персональных (пакетный формат). */
  personal_left: number | null;
  /** Остаток диагностик тела (2026-10-15_zz_diagnostics_client_requests.sql). */
  diagnostics_left: number | null;
  ends_at: string | null;
  payments: Payment[];
  payment_state: PaymentState;
  /** Начало срока; у продления — дата первого посещения (null — ещё не было). */
  membership_started_at: string | null;
  /** Продление: срок считается от первого посещения. */
  starts_on_first_visit: boolean;
};

const COLUMNS =
  "id, studio_id, client_id, admin_name, trainer_name, sold_at, total_amount, paid_amount, " +
  "sale_kind, source, promo_code, comment, membership_note, clients, memberships, " +
  "membership_status, visits_left, personal_left, ends_at, payments, payment_state, " +
  "membership_started_at, starts_on_first_visit, diagnostics_left, added_via";

/**
 * Колонки сортировки (lib/table-sort.ts): ключ заголовка → колонки вью
 * client_packages_list. Клиент и абонемент — поля json-колонок (PostgREST
 * сортирует по `col->>key`), платежи — по ближайшему невнесённому.
 */
const SORT_COLUMNS = {
  client: ["clients->>last_name", "clients->>first_name", "clients->>full_name"],
  membership: "memberships->>name",
  status: ["membership_status", "ends_at"],
  balance: ["visits_left", "personal_left"],
  amount: "total_amount",
  soldBy: ["admin_name", "trainer_name"],
  addedVia: "added_via",
  comments: ["comment", "membership_note"],
  payment: "next_due_date",
};

/**
 * Колонки: клиент, абонемент, статус, баланс, сумма, продал / тренер,
 * «Добавлен» (2026-10-18), комментарии и платежи — с 2026-10-14 одной
 * колонкой (решение владельца):
 * плашки по два в ряд, сколько бы платежей ни было.
 */
const COLUMN_COUNT = 9;

export const Route = createFileRoute("/_authenticated/client-memberships")({
  head: () => ({ meta: [{ title: "Абонементы — Base40 Admin" }] }),
  pendingComponent: ClientMembershipsPageSkeleton,
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

/** Дата календаря как YYYY-MM-DD (локальная, без перевода в UTC). */
function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ClientMembershipsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<PaymentState | typeof ALL>(ALL);
  const [kind, setKind] = useState<SaleKind | typeof ALL>(ALL);
  // Продажа: сначала тип (плитки), потом форма; возврат — из меню строки.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleKind, setSaleKind] = useState<SaleKind>("new");
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundSale, setRefundSale] = useState<RefundSale | null>(null);
  // Ближайший платёж: одна дата (выбран только день) — платежи за этот день.
  const [nextPayment, setNextPayment] = useState<DateRange | undefined>();
  const payFrom = nextPayment?.from ? isoDay(nextPayment.from) : "";
  // Выбран только первый день диапазона — это и есть «одно число».
  const payTo = nextPayment?.to ? isoDay(nextPayment.to) : payFrom;
  const sort = useTableSort();

  // Досчитать очередь продлений: у кого срок текущего абонемента вышел без
  // записей, продление становится действующим (packages_settle_studio). Один
  // раз на студию при открытии раздела (и по «Обновить»), а не на каждую
  // страницу и фильтр; список его не ждёт — после досчёта перечитывается.
  useQuery({
    queryKey: ["packages_settle_studio", studioId],
    queryFn: async () => {
      await unwrap(supabase.rpc("packages_settle_studio", { p_studio_id: studioId! }));
      void queryClient.invalidateQueries({ queryKey: ["client_packages_list", studioId] });
      return true;
    },
    enabled: !!studioId,
    staleTime: Infinity,
    gcTime: 0,
    meta: { errorMessage: "Не удалось досчитать очередь продлений" },
  });

  const term = sanitizeSearch(useDebouncedValue(search));
  const table = useServerTable<Row>({
    queryKey: ["client_packages_list", studioId, term, state, kind, payFrom, payTo, sort.key],
    queryFn: ({ from, to }) => {
      let q = supabase
        .from("client_packages_list")
        .select(COLUMNS, { count: "exact" })
        .eq("studio_id", studioId!);
      if (term) q = q.ilike("search_text", `%${phoneSearchTerm(term)}%`);
      if (state !== ALL) q = q.eq("payment_state", state);
      if (kind !== ALL) q = q.eq("sale_kind", kind);
      // next_due_date во вью — ближайший невнесённый платёж (у оплаченных — null).
      if (payFrom) q = q.gte("next_due_date", payFrom).lte("next_due_date", payTo);
      // Без сортировки по колонке: ждут платежа и просроченные — по
      // ближайшему платежу (сверху те, с кем разбираться первыми), остальное —
      // новые продажи сверху.
      const byDue = payFrom || state === "overdue" || state === "soon" || state === "pending";
      return orderBy(q, sort.sort, SORT_COLUMNS, (o) =>
        (byDue ? o.order("next_due_date", { ascending: true }) : o)
          .order("sold_at", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id"),
      ).range(from, to);
    },
    enabled: !!studioId,
    errorMessage: "Не удалось загрузить абонементы",
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["client_packages_list"] });

  // Возвраты по продажам страницы — одним запросом (таблица refunds не во вью:
  // она из db/sales_payment.sql, выполнявшегося вручную).
  const saleIds = table.rows.map((r) => r.id);
  const { data: refundedBySale } = useQuery({
    queryKey: ["refunds", "by-sales", studioId, saleIds.join(",")],
    queryFn: async () => {
      const rows = await unwrap<{ sale_id: string; amount: number | string | null }[]>(
        supabase.from("refunds").select("sale_id, amount").in("sale_id", saleIds),
      );
      const sums: Record<string, number> = {};
      for (const r of rows) sums[r.sale_id] = (sums[r.sale_id] ?? 0) + Number(r.amount ?? 0);
      return sums;
    },
    enabled: saleIds.length > 0,
    meta: { errorMessage: "Не удалось загрузить возвраты" },
  });

  const openSale = (k: SaleKind) => {
    setPickerOpen(false);
    setSaleKind(k);
    setSaleOpen(true);
  };
  // Новая продажа видна и в карточке клиента, и в статусе клиента.
  const onSold = () => {
    for (const key of ["client_packages_list", "client_memberships", "clients_with_status"])
      queryClient.invalidateQueries({ queryKey: [key] });
  };
  const openRefund = (r: Row) => {
    setRefundSale({
      id: r.id,
      studio_id: r.studio_id,
      total_amount: Number(r.total_amount),
      paidAmount: Number(r.paid_amount ?? 0),
      membershipName: r.memberships?.name ?? null,
      packages: true,
    });
    setRefundOpen(true);
  };

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

  const columns = COLUMN_COUNT;
  const filtered = !!term || state !== ALL || kind !== ALL || !!payFrom;

  return (
    <AdminShell
      title="Абонементы"
      actions={
        // Одна кнопка — тип продажи выбирается в окне, как тип занятия в «Расписании».
        <Button onClick={() => setPickerOpen(true)} disabled={!studioId}>
          <Plus />
          Продажа
        </Button>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Поиск по клиенту, абонементу, сотруднику"
            />
            <Select value={state} onValueChange={(v) => setState(v as PaymentState | typeof ALL)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все абонементы</SelectItem>
                {PAYMENT_STATE_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="flex items-center gap-2">
                      {PAYMENT_STATES[s].stripe && (
                        <span
                          aria-hidden="true"
                          className={cn("size-2.5 shrink-0 rounded-full", PAYMENT_STATES[s].stripe)}
                        />
                      )}
                      {PAYMENT_STATES[s].filter}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={(v) => setKind(v as SaleKind | typeof ALL)}>
              <SelectTrigger className="w-48" aria-label="Тип продажи">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все типы продаж</SelectItem>
                {SALE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    <span className="flex items-center gap-2">
                      <SaleKindDot kind={k} />
                      {SALE_KIND_LABEL[k]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangeFilter
              value={nextPayment}
              onChange={setNextPayment}
              placeholder="Ближайший платёж"
              title={TIPS.nextPayment}
            />
            <ToolbarReset
              active={filtered}
              onReset={() => {
                setSearch("");
                setState(ALL);
                setKind(ALL);
                setNextPayment(undefined);
              }}
            />
            <StripeLegend />
          </TableToolbar>

          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[170px]" tip={TIPS.client} {...sort.head("client")}>
                    Клиент
                  </TableHead>
                  <TableHead tip={TIPS.membership} {...sort.head("membership")}>
                    Абонемент
                  </TableHead>
                  <TableHead tip={TIPS.status} {...sort.head("status")}>
                    Статус
                  </TableHead>
                  <TableHead tip={TIPS.balance} {...sort.head("balance")}>
                    Баланс
                  </TableHead>
                  <TableHead tip={TIPS.amount} {...sort.head("amount")}>
                    Сумма
                  </TableHead>
                  <TableHead tip={TIPS.soldBy} {...sort.head("soldBy")}>
                    Продал / тренер
                  </TableHead>
                  <TableHead tip={TIPS.addedVia} {...sort.head("addedVia")}>
                    Добавлен
                  </TableHead>
                  <TableHead tip={TIPS.comments} {...sort.head("comments")}>
                    Комментарии
                  </TableHead>
                  <TableHead tip={TIPS.payment} {...sort.head("payment")}>
                    Платежи
                  </TableHead>
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
                        : "Проданных абонементов пока нет. Нажмите «Продажа»."}
                    </TableCell>
                  </TableRow>
                ) : (
                  table.rows.map((r) => (
                    <RowContextMenu
                      key={r.id}
                      actions={[
                        {
                          label: "Оформить возврат",
                          icon: Receipt,
                          onSelect: () => openRefund(r),
                        },
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
                          {r.clients?.email && (
                            <div className="text-xs font-normal text-muted-foreground">
                              {r.clients.email}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[130px]">
                          <div>{r.memberships?.name ?? "—"}</div>
                          {r.memberships?.kind !== "package" && r.memberships?.kind && (
                            <div className="text-xs text-muted-foreground">
                              {r.memberships.kind === "trial"
                                ? "Пробное"
                                : r.memberships.kind === "single"
                                  ? "Разовое"
                                  : "Персональные"}
                            </div>
                          )}
                          {r.sale_kind && (
                            <div className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                              <SaleKindDot kind={r.sale_kind} />
                              {SALE_KIND_LABEL[r.sale_kind]}
                            </div>
                          )}
                          <div className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                            С {formatDate(r.sold_at)}
                          </div>
                          <div className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                            До{" "}
                            {r.ends_at
                              ? formatDate(r.ends_at)
                              : r.starts_on_first_visit
                                ? "— с 1-го посещения"
                                : "—"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            {r.membership_status ? (
                              <MembershipStatusBadge
                                m={{
                                  status: r.membership_status,
                                  ends_at: r.ends_at,
                                  starts_on_first_visit: r.starts_on_first_visit,
                                  started_at: r.membership_started_at,
                                }}
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            <div className="text-xs tabular-nums">
                              <DaysLeft
                                status={r.membership_status}
                                endsAt={r.ends_at}
                                notStarted={r.starts_on_first_visit && !r.membership_started_at}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          <Balance row={r} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Amount row={r} refunded={refundedBySale?.[r.id] ?? 0} />
                        </TableCell>
                        <TableCell>
                          <div>{r.admin_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.trainer_name ? `Тренер: ${r.trainer_name}` : "Без тренера"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {SALE_ADDED_VIA_LABEL[r.added_via ?? "admin"]}
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
                        <TableCell>
                          <PaymentsCell row={r} onSaved={reload} />
                        </TableCell>
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
      <SaleKindPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={openSale} />
      <SaleDialog
        open={saleOpen}
        onOpenChange={setSaleOpen}
        studioId={studioId}
        onSaved={onSold}
        kind={saleKind}
      />
      <RefundDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        sale={refundSale}
        onSaved={reload}
      />
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
 * тренировок с подарочными; диагностики — если входят в абонемент.
 */
function Balance({ row }: { row: Row }) {
  const m = row.memberships;
  const isPersonal = m?.kind === "personal";
  const personalTotal = m?.personal_count ?? 0;
  const diagnosticsTotal = m?.diagnostics_count ?? 0;
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
      {diagnosticsTotal > 0 && line(row.diagnostics_left, diagnosticsTotal, "диагн.")}
    </>
  );
}

/** Стоимость продажи, сколько внесено, промокод и возвраты. */
function Amount({ row, refunded }: { row: Row; refunded: number }) {
  const total = Number(row.total_amount);
  const paid = Number(row.paid_amount);
  return (
    <>
      <div className="font-medium tabular-nums">{formatMoney(total)}</div>
      {paid < total && (
        <div className="text-xs text-muted-foreground tabular-nums">
          внесено {formatMoney(paid)}
        </div>
      )}
      {row.promo_code && (
        <div className="text-xs text-muted-foreground">Промокод: {row.promo_code}</div>
      )}
      {refunded > 0 && (
        <div className="text-xs text-rose-600 tabular-nums">возврат {formatMoney(refunded)}</div>
      )}
    </>
  );
}

/** Абонемент закончился: дни не считаем (статус — бейджем рядом). */
const ENDED_STATUSES = new Set(["replaced", "cancelled", "expired", "frozen", "refunded"]);

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
  if (status && ENDED_STATUSES.has(status)) return null;
  if (notStarted)
    return (
      <span className="text-muted-foreground" title={TIPS.renewal}>
        {status === "pending" ? "Ждёт окончания текущего" : "Срок — с 1-го посещения"}
      </span>
    );
  if (!endsAt) return <span className="text-muted-foreground">Без срока</span>;
  const days = daysUntil(endsAt);
  if (days < 0) return <span className="text-rose-600">закончился {formatDate(endsAt)}</span>;
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
            "line-clamp-2 min-w-[140px] max-w-[200px] cursor-pointer whitespace-pre-wrap break-words text-left",
            value
              ? cn(noteChipClass, "hover:bg-note")
              : "text-muted-foreground hover:text-foreground",
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
        <Textarea note rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </FormField>
      <PopoverButtons saving={saving} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Платёж рассрочки (sale_installments)
// ---------------------------------------------------------------------------

/**
 * Способ оплаты внесённого платежа — иконкой справа от даты (решение
 * владельца 2026-10-14: плашки ниже, подпись — во всплывающей подсказке).
 */
const PAYMENT_METHOD_ICON: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowLeftRight,
  app: Smartphone,
};

/**
 * Платежи продажи одной колонкой: плашки по два в ряд (внесённый — зелёная,
 * просроченный — красная), под ними — «Редактировать платежи».
 */
function PaymentsCell({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const payments = row.payments ?? [];
  if (payments.length === 0) return <span className="text-muted-foreground">—</span>;
  // График есть (не «оплачено сразу») и по продаже не было возврата.
  const editable =
    payments.some((p) => p.id) &&
    !payments.some((p) => p.refunded) &&
    row.membership_status !== "refunded";
  return (
    // Плашки по ширине содержимого (суммы — до трёх знаков, решение владельца
    // 2026-10-14): колонки по самой широкой плашке, без пустоты справа.
    <div className="w-max space-y-1.5">
      <div className="grid grid-cols-[repeat(2,max-content)] gap-1.5">
        {payments.map((p, i) => (
          <PaymentCell key={p.id ?? i} index={i} payment={p} onSaved={onSaved} />
        ))}
      </div>
      {editable && (
        <Button
          variant="link"
          size="inline"
          // Серым, как «Комментарий» в соседней колонке, — не спорит с платежами.
          className="text-xs text-muted-foreground underline hover:text-foreground"
          onClick={() => setEditOpen(true)}
        >
          Редактировать платежи
        </Button>
      )}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
          <PaymentsEditForm
            row={row}
            onClose={() => setEditOpen(false)}
            onSaved={() => {
              setEditOpen(false);
              onSaved();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentCell({
  index,
  payment,
  onSaved,
}: {
  index: number;
  payment: Payment;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const overdue = !payment.paid && !payment.refunded && payment.due_date < todayISO();
  // Сегодня или в ближайшие 2 дня — синяя, как полоска строки «Платёж в
  // ближайшие 3 дня» (payment_state = 'soon', решение владельца 2026-10-14).
  const soon = !payment.paid && !payment.refunded && !overdue && daysUntil(payment.due_date) <= 2;
  const box = cn(
    "block w-full rounded-md border px-2 py-1.5 text-left",
    payment.refunded
      ? "border-orange-200 bg-orange-50"
      : payment.paid
        ? "border-emerald-200 bg-emerald-50"
        : overdue
          ? "border-rose-200 bg-rose-50"
          : soon
            ? "border-blue-200 bg-blue-50"
            : "bg-muted/40",
  );
  const number = <span className="font-normal text-muted-foreground">{index + 1}. </span>;

  // Снят возвратом: ни суммы, ни даты — только отметка (решение владельца 2026-10-13).
  if (payment.refunded)
    return (
      <div title="По продаже оформлен возврат — платёж больше не ждём" className={box}>
        <div className="text-xs font-medium text-orange-700">
          {number}
          Возврат
        </div>
      </div>
    );

  const summary = (
    <>
      <div className="whitespace-nowrap text-sm font-medium tabular-nums">
        {number}
        {formatMoneyPrecise(Number(payment.amount))}
      </div>
      <div
        className={cn(
          "flex items-center gap-1 whitespace-nowrap text-xs",
          payment.paid
            ? "text-emerald-700"
            : soon
              ? "text-blue-700"
              : overdue
                ? "text-rose-600"
                : "text-muted-foreground",
        )}
      >
        {payment.paid ? (
          <>
            {formatDate(payment.paid_at ?? payment.due_date)}
            {payment.payment_method && <PaymentMethodIcon method={payment.payment_method} />}
          </>
        ) : (
          <>до {formatDate(payment.due_date)}</>
        )}
      </div>
    </>
  );

  // Оплата сразу при продаже — графика нет, отмечать нечего.
  if (!payment.id)
    return (
      <div title="Оплачено полностью при продаже" className={box}>
        {summary}
      </div>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={payment.paid ? "Изменить платёж" : "Отметить оплату"}
          className={cn(box, "cursor-pointer transition-opacity hover:opacity-80")}
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

function PaymentMethodIcon({ method }: { method: PaymentMethod }) {
  const Icon = PAYMENT_METHOD_ICON[method];
  const label = PAYMENT_METHOD_LABEL[method];
  return (
    <span title={label} className="inline-flex">
      <Icon aria-hidden className="h-3.5 w-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Невнесённый платёж в окне правки графика; id null — новый. */
type DraftPayment = { key: string; id: string | null; amount: string; dueDate: string };

/**
 * «Редактировать платежи» (решение владельца 2026-10-14): внесённые платежи —
 * как есть, невнесённые можно менять, удалять и добавлять. Сохраняет RPC
 * replace_sale_installments (db/migrations/2026-10-14_zzz_sale_installments_edit.sql)
 * — одним действием, и сама база не даст сохранить график меньше стоимости.
 */
function PaymentsEditForm({
  row,
  onClose,
  onSaved,
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const paid = row.payments.filter((p) => p.paid);
  const [drafts, setDrafts] = useState<DraftPayment[]>(() =>
    row.payments
      .filter((p) => !p.paid && p.id)
      .map((p) => ({ key: p.id!, id: p.id, amount: String(p.amount), dueDate: p.due_date })),
  );
  const [saving, setSaving] = useState(false);

  const total = Number(row.total_amount) || 0;
  const amounts = [
    ...paid.map((p) => Number(p.amount)),
    ...drafts.map((d) => Number(d.amount.replace(",", "."))),
  ];
  const shortfall = scheduleShortfall(total, amounts);
  const sum = amounts.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);

  const update = (key: string, patch: Partial<DraftPayment>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const remove = (key: string) => setDrafts((list) => list.filter((d) => d.key !== key));
  const add = () =>
    setDrafts((list) => {
      const dates = [...paid.map((p) => p.due_date), ...list.map((d) => d.dueDate)].filter(Boolean);
      const last = dates.sort().at(-1) ?? todayISO();
      return [
        ...list,
        {
          key: crypto.randomUUID(),
          id: null,
          // Новый платёж сразу предлагает недостающую сумму.
          amount: shortfall > 0 ? String(shortfall) : "",
          dueDate: addMonthsISO(last < todayISO() ? todayISO() : last, 1),
        },
      ];
    });

  const handleSave = async () => {
    if (saving) return;
    for (const d of drafts) {
      const v = Number(d.amount.replace(",", "."));
      if (!d.amount.trim() || !Number.isFinite(v) || v <= 0) {
        toast.error("Укажите сумму каждого платежа");
        return;
      }
      if (!d.dueDate) {
        toast.error("Укажите дату каждого платежа");
        return;
      }
    }
    if (shortfall > 0) {
      toast.error(
        `Платежи в сумме меньше стоимости абонемента: не хватает ${formatMoneyPrecise(shortfall)}`,
      );
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("replace_sale_installments", {
        p_sale_id: row.id,
        p_rows: drafts.map((d) => ({
          id: d.id,
          amount: Number(d.amount.replace(",", ".")),
          due_date: d.dueDate,
        })),
      });
      if (error) {
        toast.error("Не удалось сохранить платежи: " + error.message);
        return;
      }
      toast.success("Платежи сохранены");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Редактировать платежи</DialogTitle>
        <DialogDescription>
          {row.clients ? clientName(row.clients) : "Клиент"} ·{" "}
          {row.memberships?.name ?? "Абонемент"}
          {" · "}стоимость {formatMoneyPrecise(total)}
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-3">
            <InfoNote>{TIPS.editPayments}</InfoNote>
            <ol className="space-y-2">
              {paid.map((p, i) => (
                <li
                  key={p.id ?? i}
                  className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"
                >
                  <span className="w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
                  <span className="font-medium tabular-nums">
                    {formatMoneyPrecise(Number(p.amount))}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-emerald-700">
                    <Check className="h-3.5 w-3.5" />
                    внесён {formatDate(p.paid_at ?? p.due_date)}
                    {p.payment_method && ` · ${PAYMENT_METHOD_LABEL[p.payment_method]}`}
                  </span>
                </li>
              ))}
              {drafts.map((d, i) => (
                <li key={d.key} className="flex items-end gap-2 rounded-md border px-3 py-2">
                  <span className="w-5 shrink-0 pb-2.5 text-sm text-muted-foreground">
                    {paid.length + i + 1}.
                  </span>
                  <FormField label="Сумма, ₾" tip={TIPS.paymentAmount} required className="flex-1">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={d.amount}
                      onChange={(e) => update(d.key, { amount: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Внести до" tip={TIPS.dueDate} required className="flex-1">
                    <Input
                      type="date"
                      value={d.dueDate}
                      onChange={(e) => update(d.key, { dueDate: e.target.value })}
                    />
                  </FormField>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mb-1 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Убрать платёж ${paid.length + i + 1}`}
                    onClick={() => remove(d.key)}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ol>
            <Button variant="outline" size="sm" onClick={add}>
              <Plus />
              Добавить платёж
            </Button>
            <InfoNote variant={shortfall > 0 ? "warning" : undefined}>
              Платежи в сумме: {formatMoneyPrecise(sum)} из {formatMoneyPrecise(total)}.
              {shortfall > 0
                ? ` Не хватает ${formatMoneyPrecise(shortfall)} — добавьте платёж или увеличьте сумму.`
                : " Стоимость абонемента покрыта."}
            </InfoNote>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

/**
 * Отметка оплаты по клику на платёж (решение владельца 2026-10-14): сумма и
 * «внести до» здесь не меняются — только когда внесён и способ оплаты; график
 * правят в «Редактировать платежи». Внесённый по ошибке — «Снять отметку».
 */
function PaymentForm({
  payment,
  onDone,
  onCancel,
}: {
  payment: Payment & { id: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  // Отмечают оплату обычно в день, когда клиент заплатил, — сегодня.
  const [paidAt, setPaidAt] = useState(payment.paid_at ?? todayISO());
  const [method, setMethod] = useState<PaymentMethod>(payment.payment_method ?? "cash");
  const [saving, setSaving] = useState(false);

  const save = async (paid: boolean) => {
    if (saving) return;
    if (paid && !paidAt) {
      toast.error("Укажите, когда платёж внесён");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("sale_installments")
        .update({
          paid,
          paid_at: paid ? paidAt : null,
          payment_method: paid ? method : null,
        })
        .eq("id", payment.id);
      if (error) {
        toast.error("Не удалось сохранить платёж: " + error.message);
        return;
      }
      toast.success(paid ? "Платёж отмечен внесённым" : "Отметка об оплате снята");
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save(true);
      }}
      className="space-y-3"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold leading-tight">Фиксация оплаты</h3>
        <div className="text-sm">
          <span className="font-medium tabular-nums">
            {formatMoneyPrecise(Number(payment.amount))}
          </span>
          <span className="text-muted-foreground"> · до {formatDate(payment.due_date)}</span>
        </div>
      </div>
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
      {payment.paid && (
        <Button
          variant="link"
          size="inline"
          className="text-xs text-muted-foreground underline hover:text-destructive"
          disabled={saving}
          onClick={() => save(false)}
        >
          Снять отметку об оплате
        </Button>
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
