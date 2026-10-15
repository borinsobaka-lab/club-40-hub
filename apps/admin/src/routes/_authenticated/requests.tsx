import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, Loader2, Trash2, Undo2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { RequireFormat } from "@/components/require-format";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import {
  OPEN_REQUESTS_KEY,
  REQUEST_KIND_LABEL,
  type ClientRequestKind,
} from "@/hooks/use-client-requests";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { cn } from "@/lib/utils";
import { clientName } from "@/lib/format";
import { GOAL_LABELS } from "@/lib/client-profile";
import { Button } from "@/components/ui/button";
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
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableSkeletonRows } from "@/components/skeletons";
import { TableToolbar, ToolbarReset } from "@/components/table-toolbar";
import { RowContextMenu } from "@/components/row-context-menu";
import { useConfirm } from "@/components/confirm-dialog";
import { CommentCell } from "@/components/comment-cell";
import { ClientNameLink } from "@/components/client-name-link";
import { RequestsPageSkeleton, RequestsStatsSkeleton } from "@/components/page-skeletons";

/**
 * «Заявки» (2026-10-15, «Обратная связь», пакетные клубы): клиент в
 * приложении просит персональные занятия (цели, комментарий) или
 * диагностику — администратор связывается, согласует время с тренером и
 * ставит занятие в «Расписание», потом жмёт «Отработано». Пока заявка не
 * отработана, горит счётчик на «Клубе» в рейке и на «Заявках» в меню.
 * Схема — db/migrations/2026-10-15_zz_diagnostics_client_requests.sql.
 */

/** Подсказки «?» колонок. */
const TIPS = {
  kind: "Персональные занятия — клиент хочет заниматься с тренером; диагностика — записаться на диагностику тела по абонементу.",
  goals: "Цели клиента: из анкеты приложения и те, что он отметил в заявке.",
  balance:
    "Действующие абонементы клиента и их остаток: тренировки, персональные, диагностики. Без остатка — сначала продажа.",
  status: "Пока заявка не отработана, горит счётчик на «Клубе» и «Заявках».",
};

export const Route = createFileRoute("/_authenticated/requests")({
  head: () => ({ meta: [{ title: "Заявки — Base40 Admin" }] }),
  pendingComponent: RequestsPageSkeleton,
  component: RequestsRoute,
});

function RequestsRoute() {
  return (
    <RequireFormat format="packages" title="Заявки">
      <RequestsPage />
    </RequireFormat>
  );
}

type RequestRow = {
  id: string;
  studio_id: string;
  client_id: string;
  kind: ClientRequestKind;
  goals: string[];
  goal_other: string | null;
  comment: string | null;
  created_at: string;
  processed_at: string | null;
  processed_by_name: string | null;
  client: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null;
};

type MembershipBalance = {
  client_id: string;
  status: string;
  visits_left: number | null;
  personal_left: number | null;
  diagnostics_left: number | null;
  balance_kind: string | null;
  memberships: { name: string | null; kind: string | null } | null;
};

const COLUMNS =
  "id, studio_id, client_id, kind, goals, goal_other, comment, created_at, processed_at, processed_by_name, client:clients(id, first_name, last_name, full_name, phone, email)";

type StatusFilter = "open" | "done" | "all";

function RequestsPage() {
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [kind, setKind] = useState<"all" | ClientRequestKind>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const queryKey = ["client_requests", studioId];
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey,
    queryFn: () =>
      unwrap<RequestRow[]>(
        supabase
          .from("client_requests")
          .select(COLUMNS)
          .eq("studio_id", studioId as string)
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
    enabled: !!studioId,
    // Заявки приходят из приложения — список обновляется сам.
    refetchInterval: 60_000,
    meta: { errorMessage: "Не удалось загрузить заявки" },
  });

  // Остаток абонементов клиентов — чтобы видеть, есть ли диагностики и
  // персональные, не открывая карточку.
  const clientIds = useMemo(() => [...new Set(items.map((i) => i.client_id))].sort(), [items]);
  const { data: balances } = useQuery({
    queryKey: ["client_memberships", "requests", studioId, clientIds.join(",")],
    queryFn: () =>
      unwrap<MembershipBalance[]>(
        supabase
          .from("client_memberships")
          .select(
            "client_id, status, visits_left, personal_left, diagnostics_left, balance_kind, memberships(name, kind)",
          )
          .in("client_id", clientIds)
          .in("status", ["active", "frozen", "pending"]),
      ),
    enabled: clientIds.length > 0,
    meta: { errorMessage: "Не удалось загрузить абонементы клиентов" },
  });
  const balancesByClient = useMemo(() => {
    const map = new Map<string, MembershipBalance[]>();
    for (const m of balances ?? []) map.set(m.client_id, [...(map.get(m.client_id) ?? []), m]);
    return map;
  }, [balances]);

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        if (status === "open" && i.processed_at) return false;
        if (status === "done" && !i.processed_at) return false;
        if (kind !== "all" && i.kind !== kind) return false;
        return true;
      }),
    [items, status, kind],
  );
  const pg = usePagination(filtered);

  const now = new Date();
  const openCount = items.filter((i) => !i.processed_at).length;
  const thisMonth = items.filter((i) => {
    const d = new Date(i.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const doneThisMonth = items.filter((i) => {
    if (!i.processed_at) return false;
    const d = new Date(i.processed_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ["client_requests"] });
    queryClient.invalidateQueries({ queryKey: [OPEN_REQUESTS_KEY] });
  };

  // «Отработано» / «Вернуть в работу»: кто и когда — ставит база.
  const setProcessed = async (item: RequestRow, done: boolean) => {
    setBusyId(item.id);
    try {
      const { error } = await supabase
        .from("client_requests")
        .update({ processed_at: done ? new Date().toISOString() : null })
        .eq("id", item.id);
      if (error) {
        toast.error("Не удалось сохранить: " + error.message);
        return;
      }
      toast.success(done ? "Заявка отработана" : "Заявка возвращена в работу");
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: RequestRow) => {
    if (
      !(await confirm({
        title: "Удалить заявку?",
        description: "Клиент сможет отправить новую. Это действие нельзя отменить.",
      }))
    )
      return;
    const { error } = await supabase.from("client_requests").delete().eq("id", item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Заявка удалена");
    reload();
  };

  const hasFilters = status !== "open" || kind !== "all";

  return (
    <AdminShell title="Заявки">
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          {loading ? (
            <RequestsStatsSkeleton />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-background p-4">
                <p className="text-xs text-muted-foreground">Не отработано</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-semibold tabular-nums",
                    openCount > 0 && "text-destructive",
                  )}
                >
                  {openCount}
                </p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-xs text-muted-foreground">Пришло в этом месяце</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{thisMonth}</p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-xs text-muted-foreground">Отработано в этом месяце</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{doneThisMonth}</p>
              </div>
            </div>
          )}

          <TableToolbar>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Не отработанные</SelectItem>
                <SelectItem value="done">Отработанные</SelectItem>
                <SelectItem value="all">Все заявки</SelectItem>
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={(v) => setKind(v as "all" | ClientRequestKind)}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все виды</SelectItem>
                {(Object.keys(REQUEST_KIND_LABEL) as ClientRequestKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {REQUEST_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToolbarReset
              active={hasFilters}
              onReset={() => {
                setStatus("open");
                setKind("all");
              }}
            />
          </TableToolbar>

          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead tip={TIPS.kind}>Заявка</TableHead>
                  <TableHead tip={TIPS.goals}>Цели</TableHead>
                  <TableHead>Комментарий</TableHead>
                  <TableHead tip={TIPS.balance}>Абонемент</TableHead>
                  <TableHead tip={TIPS.status}>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={7} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      <ClipboardList className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                      {status === "open" ? "Новых заявок нет." : "Заявок нет."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((i) => {
                    const busy = busyId === i.id;
                    return (
                      <RowContextMenu
                        key={i.id}
                        actions={[
                          i.processed_at
                            ? {
                                label: "Вернуть в работу",
                                icon: Undo2,
                                onSelect: () => setProcessed(i, false),
                              }
                            : {
                                label: "Отработано",
                                icon: Check,
                                onSelect: () => setProcessed(i, true),
                              },
                          {
                            label: "Удалить",
                            icon: Trash2,
                            destructive: true,
                            onSelect: () => handleDelete(i),
                          },
                        ]}
                      >
                        <TableRow
                          className={cn(
                            !i.processed_at && "max-md:border-l-4 max-md:border-l-rose-500",
                          )}
                        >
                          <TableCell className="relative whitespace-nowrap text-muted-foreground">
                            {/* Неотработанная — красная полоска слева, как в «Абонементах». */}
                            {!i.processed_at && (
                              <span
                                aria-hidden
                                className="absolute inset-y-0 left-0 w-1 bg-rose-500 max-md:hidden"
                              />
                            )}
                            {format(new Date(i.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                          </TableCell>
                          <TableCell>
                            {i.client ? (
                              <ClientNameLink clientId={i.client_id}>
                                {clientName(i.client)}
                              </ClientNameLink>
                            ) : (
                              "—"
                            )}
                            {(i.client?.phone || i.client?.email) && (
                              <div className="text-xs text-muted-foreground">
                                {[i.client?.phone, i.client?.email].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <KindBadge kind={i.kind} />
                          </TableCell>
                          <TableCell className="max-w-[220px] text-sm">
                            {goalsText(i) || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <CommentCell text={i.comment} />
                          </TableCell>
                          <TableCell className="text-xs">
                            <BalanceCell rows={balancesByClient.get(i.client_id)} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {i.processed_at ? (
                              <div className="text-xs text-muted-foreground">
                                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                  Отработано
                                </span>
                                <div className="mt-1">
                                  {i.processed_by_name ? `${i.processed_by_name} · ` : ""}
                                  {format(new Date(i.processed_at), "dd.MM.yy", { locale: ru })}
                                </div>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => setProcessed(i, true)}
                                disabled={busy}
                              >
                                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                                Отработано
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      </RowContextMenu>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <DataPagination {...pg} loading={loading} />
          </div>
        </RequireStudio>
      </div>
      {confirmDialog}
    </AdminShell>
  );
}

/** Цели заявки подписями анкеты; «Другое» — текстом клиента. */
function goalsText(i: RequestRow) {
  const goals = (i.goals ?? []).map((g) =>
    g === "other" && i.goal_other ? `Другое: ${i.goal_other}` : (GOAL_LABELS[g] ?? g),
  );
  if (i.goal_other && !i.goals?.includes("other")) goals.push(i.goal_other);
  return goals.join(", ");
}

function KindBadge({ kind }: { kind: ClientRequestKind }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        kind === "diagnostic" ? "bg-slate-900 text-white" : "bg-violet-100 text-violet-700",
      )}
    >
      {REQUEST_KIND_LABEL[kind] ?? kind}
    </span>
  );
}

/** «Пакет 24 · трен. 10 · перс. 1 · диагн. 2»; нет — «Нет абонемента». */
function BalanceCell({ rows }: { rows: MembershipBalance[] | undefined }) {
  if (!rows) return <span className="text-muted-foreground">—</span>;
  if (rows.length === 0) return <span className="text-rose-600">Нет абонемента</span>;
  return (
    <div className="space-y-0.5">
      {rows.map((m, idx) => {
        const parts = [
          m.balance_kind !== "personal" &&
            (m.visits_left == null ? "безлимит" : `трен. ${m.visits_left}`),
          (m.personal_left ?? 0) > 0 && `перс. ${m.personal_left}`,
          (m.diagnostics_left ?? 0) > 0 && `диагн. ${m.diagnostics_left}`,
        ].filter(Boolean);
        return (
          <div key={idx}>
            <span className="font-medium">{m.memberships?.name ?? "Абонемент"}</span>
            {m.status === "pending" && <span className="text-muted-foreground"> (продление)</span>}
            {parts.length > 0 && (
              <span className="text-muted-foreground"> · {parts.join(" · ")}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
