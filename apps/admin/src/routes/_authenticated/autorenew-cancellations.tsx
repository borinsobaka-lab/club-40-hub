import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { RequireFormat } from "@/components/require-format";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
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
import { Badge } from "@/components/ui/badge";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarSearch } from "@/components/table-toolbar";
import { ClientNameLink } from "@/components/client-name-link";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { formatDate, formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/autorenew-cancellations")({
  head: () => ({ meta: [{ title: "Отмены автопродления — Base40 Admin" }] }),
  component: AutorenewCancellationsRoute,
});

/** У пакетов тренировок автопродления нет — раздел только подписочного формата. */
function AutorenewCancellationsRoute() {
  return (
    <RequireFormat format="subscription" title="Отмены автопродления">
      <AutorenewCancellationsPage />
    </RequireFormat>
  );
}

type Row = {
  id: string;
  client_id: string;
  ends_at: string | null;
  auto_renew_cancelled_at: string | null;
  auto_renew_cancel_reason: "self" | "auto" | null;
  membership: { name: string | null } | null;
  client: {
    id: string;
    user_id: string | null;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
    crm_link: string | null;
  } | null;
};

const REASON_ALL = "__all__";

// crm_link берём эмбедом: иначе ClientNameLink запрашивал его на каждую строку.
const COLUMNS =
  "id, client_id, ends_at, auto_renew_cancelled_at, auto_renew_cancel_reason, membership:memberships(name), client:clients(id, user_id, full_name, first_name, last_name, phone, email, crm_link)";

// Здесь «Имя Фамилия» и full_name в приоритете, а не clientName(): менять вид
// имени в разделе — решение владельца, а не рефакторинга.
function rowClientName(r: Row) {
  return (
    r.client?.full_name || [r.client?.first_name, r.client?.last_name].filter(Boolean).join(" ")
  );
}

function ReasonBadge({ value }: { value: Row["auto_renew_cancel_reason"] }) {
  if (value === "self") {
    return <Badge variant="secondary">Самостоятельная</Badge>;
  }
  if (value === "auto") {
    return <Badge variant="destructive">Автоматическая</Badge>;
  }
  return <Badge variant="outline">—</Badge>;
}

function AutorenewCancellationsPage() {
  const studioId = useActiveStudioId();
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState<string>(REASON_ALL);

  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: ["client_memberships", studioId, "autorenew-cancelled"],
    queryFn: () =>
      unwrap<Row[]>(
        supabase
          .from("client_memberships")
          .select(COLUMNS)
          .eq("studio_id", studioId!)
          .not("auto_renew_cancelled_at", "is", null)
          .order("auto_renew_cancelled_at", { ascending: false })
          .limit(1000),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить отмены" },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (reason !== REASON_ALL && (r.auto_renew_cancel_reason ?? "") !== reason) return false;
      if (!q) return true;
      return [rowClientName(r), r.client?.phone, r.client?.email, r.membership?.name].some((v) =>
        v?.toLowerCase().includes(q),
      );
    });
  }, [rows, search, reason]);

  const pg = usePagination(filtered);

  return (
    <AdminShell title="Отмены автопродления">
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Поиск: имя, телефон, почта, абонемент"
            />
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={REASON_ALL}>Все причины</SelectItem>
                <SelectItem value="self">Самостоятельная</SelectItem>
                <SelectItem value="auto">Автоматическая</SelectItem>
              </SelectContent>
            </Select>
          </TableToolbar>

          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Клиент</TableHead>
                  <TableHead>Контакты</TableHead>
                  <TableHead>Абонемент</TableHead>
                  <TableHead className="w-[140px]">Действует до</TableHead>
                  <TableHead className="w-[180px]">Причина отмены</TableHead>
                  <TableHead className="w-[160px]">Отменено</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={6} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Отмен автопродления не найдено.
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((r) => {
                    const name = rowClientName(r) || "—";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.client?.id && name !== "—" ? (
                            <ClientNameLink clientId={r.client.id} crmLink={r.client.crm_link}>
                              {name}
                            </ClientNameLink>
                          ) : (
                            name
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div>{r.client?.phone ?? "—"}</div>
                          <div className="text-xs">{r.client?.email ?? "—"}</div>
                        </TableCell>
                        <TableCell>{r.membership?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm">{formatDate(r.ends_at)}</TableCell>
                        <TableCell>
                          <ReasonBadge value={r.auto_renew_cancel_reason} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(r.auto_renew_cancelled_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <DataPagination {...pg} />
          </div>
        </RequireStudio>
      </div>
    </AdminShell>
  );
}
