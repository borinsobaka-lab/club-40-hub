import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AdminShell } from "@/components/admin-shell";
import { KbStatusBadge } from "@/components/kb/kb-status-badge";
import { KbReportPageSkeleton } from "@/components/page-skeletons";
import { StaffAvatar } from "@/components/employee-photo";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableSkeletonRows } from "@/components/skeletons";
import { TableToolbar, ToolbarReset, ToolbarSearch } from "@/components/table-toolbar";
import { InfoNote } from "@/components/ui/form-field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useTableSort } from "@/hooks/use-table-sort";
import { supabase } from "@/integrations/supabase/client";
import { canEditKb } from "@/lib/kb/access";
import { kbBasesQuery, useKbTree } from "@/lib/kb/data";
import { ancestorsOf, indexTree } from "@/lib/kb/tree";
import { KB_STATUS_LABEL, type KbStatus } from "@/lib/kb/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { unwrap } from "@/lib/query";
import type { SortGetters } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/kb/$baseId/report")({
  head: () => ({ meta: [{ title: "Отчёт по чтению — Base40 Admin" }] }),
  pendingComponent: KbReportPageSkeleton,
  component: KbReportPage,
});

const TIPS = {
  percent:
    "Сколько сотрудников открыли статью хотя бы раз — из тех, кому база выдана в «Доступах». Владельцы и авторы статьи (создал, правил, публиковал) не считаются.",
  updated: "Последняя правка: публикация, название или черновик правок.",
};

type ReportRow = {
  id: string;
  parent_id: string | null;
  title: string;
  status: KbStatus;
  created_at: string;
  created_by_name: string | null;
  updated_at: string;
  updated_by_name: string | null;
  published_at: string | null;
  published_by_name: string | null;
  has_draft: boolean;
  access_count: number;
  readers_count: number;
  last_read_at: string | null;
};

type Reader = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  first_read_at: string | null;
  last_read_at: string | null;
  read_count: number;
};

const percent = (r: ReportRow) => (r.access_count ? r.readers_count / r.access_count : 0);

const SORT: SortGetters<ReportRow> = {
  title: (r) => r.title,
  status: (r) => KB_STATUS_LABEL[r.status],
  created: (r) => r.created_at,
  updated: (r) => r.updated_at,
  percent: percent,
  last: (r) => r.last_read_at,
};

/**
 * Отчёт по чтению базы (редактору и владельцу; RPC kb_report): по каждой
 * статье — кто и когда создал и правил, у скольких доступ, сколько открыли.
 * Папки статьями не считаются (боль брифа). По строке — кто открыл и кто нет.
 */
function KbReportPage() {
  const { baseId } = Route.useParams();
  const access = useAdminAccess();
  const canEdit = canEditKb(access?.isOwner ? "manage" : access?.kb?.[baseId]);
  const { data: bases } = useQuery(kbBasesQuery);
  const base = bases?.find((b) => b.id === baseId);
  const { data: nodes } = useKbTree(baseId);
  const index = useMemo(() => indexTree(nodes ?? []), [nodes]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | KbStatus>("all");
  const [open, setOpen] = useState<ReportRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["kb_report", baseId],
    queryFn: () => unwrap<ReportRow[]>(supabase.rpc("kb_report", { p_base: baseId })),
    enabled: canEdit,
    meta: { errorMessage: "Не удалось загрузить отчёт" },
  });

  const sort = useTableSort<ReportRow>(SORT);
  const term = q.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (r) =>
      (status === "all" || r.status === status) && (!term || r.title.toLowerCase().includes(term)),
  );
  const pg = usePagination(sort.apply(rows), undefined, `${sort.key}|${status}|${term}`);
  const path = (id: string) =>
    ancestorsOf(index, id)
      .map((a) => a.title)
      .join(" › ");

  return (
    <AdminShell title={`Отчёт по чтению${base ? ` · ${base.title}` : ""}`}>
      <div className="space-y-3">
        {!canEdit && access ? (
          <InfoNote variant="warning">Отчёт видят редакторы базы и владельцы.</InfoNote>
        ) : error && !data ? (
          <InfoNote variant="warning">{error.message}</InfoNote>
        ) : (
          <>
            <TableToolbar>
              <ToolbarSearch value={q} onChange={setQ} placeholder="Название статьи" />
              <Select value={status} onValueChange={(v) => setStatus(v as "all" | KbStatus)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  <SelectItem value="published">{KB_STATUS_LABEL.published}</SelectItem>
                  <SelectItem value="draft">{KB_STATUS_LABEL.draft}</SelectItem>
                  <SelectItem value="archived">{KB_STATUS_LABEL.archived}</SelectItem>
                </SelectContent>
              </Select>
              <ToolbarReset
                active={!!q || status !== "all"}
                onReset={() => {
                  setQ("");
                  setStatus("all");
                }}
              />
            </TableToolbar>
            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead {...sort.head("title")}>Статья</TableHead>
                    <TableHead {...sort.head("status")}>Статус</TableHead>
                    <TableHead {...sort.head("created")}>Создал</TableHead>
                    <TableHead tip={TIPS.updated} {...sort.head("updated")}>
                      Обновлено
                    </TableHead>
                    <TableHead tip={TIPS.percent} {...sort.head("percent")}>
                      Прочитали
                    </TableHead>
                    <TableHead {...sort.head("last")}>Открывали</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableSkeletonRows columns={6} rows={6} />
                  ) : pg.paged.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {data?.length ? "Ничего не нашлось" : "В базе пока нет статей"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.paged.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        tabIndex={0}
                        onClick={() => setOpen(r)}
                        onKeyDown={(e) => e.key === "Enter" && setOpen(r)}
                      >
                        <TableCell className="max-w-72">
                          <Link
                            to="/kb/$baseId/$nodeId"
                            params={{ baseId, nodeId: r.id }}
                            onClick={(e) => e.stopPropagation()}
                            className="block truncate font-medium hover:underline"
                          >
                            {r.title || "Без названия"}
                          </Link>
                          {path(r.id) && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {path(r.id)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <KbStatusBadge status={r.status} size="sm" />
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="block">{r.created_by_name || "—"}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(r.created_at)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="block">{formatDate(r.updated_at)}</span>
                          <span className="text-xs text-muted-foreground">
                            {r.updated_by_name || ""}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ReadShare row={r} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.last_read_at ? formatDateTime(r.last_read_at) : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {data && <DataPagination {...pg} />}
            </div>
          </>
        )}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-lg">{open && <ReadersList row={open} />}</DialogContent>
      </Dialog>
    </AdminShell>
  );
}

function ReadShare({ row }: { row: ReportRow }) {
  if (!row.access_count) return <span className="text-muted-foreground">—</span>;
  const p = Math.round(percent(row) * 100);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <StatusChip tone={p >= 80 ? "positive" : p === 0 ? "neutral" : "warning"} size="sm">
        {p}%
      </StatusChip>
      <span className="text-xs text-muted-foreground tabular-nums">
        {row.readers_count} из {row.access_count}
      </span>
    </span>
  );
}

function ReadersList({ row }: { row: ReportRow }) {
  const { data, isLoading } = useQuery({
    queryKey: ["kb_article_readers", row.id],
    queryFn: () => unwrap<Reader[]>(supabase.rpc("kb_article_readers", { p_node: row.id })),
    meta: { errorMessage: "Не удалось загрузить, кто открыл статью" },
  });
  const read = (data ?? []).filter((r) => r.read_count > 0);
  const unread = (data ?? []).filter((r) => r.read_count === 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{row.title || "Без названия"}</DialogTitle>
        <DialogDescription>
          Открыли {row.readers_count} из {row.access_count} — сотрудников, кому база выдана в
          «Доступах»; владельцы и авторы статьи не считаются. Повторное открытие чаще раза в 30
          минут не считается.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Открыли · {read.length}</h3>
              {read.length === 0 ? (
                <p className="text-sm text-muted-foreground">Пока никто.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {read.map((r) => (
                    <li key={r.user_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <StaffAvatar
                        value={r.avatar_url}
                        name={r.full_name ?? ""}
                        className="size-7 text-xs"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {r.full_name || "Сотрудник"}
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        {formatDateTime(r.last_read_at)}
                        {r.read_count > 1 && (
                          <span className="block">открывал {r.read_count} раз</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {unread.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-sm font-semibold">Не открывали · {unread.length}</h3>
                <ul className="divide-y rounded-md border">
                  {unread.map((r) => (
                    <li key={r.user_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <StaffAvatar
                        value={r.avatar_url}
                        name={r.full_name ?? ""}
                        className="size-7 text-xs"
                      />
                      <span className="min-w-0 flex-1 truncate">{r.full_name || "Сотрудник"}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </DialogBody>
    </>
  );
}
