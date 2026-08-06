import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { useRefreshSignal } from "@/lib/refresh-bus";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { ClientNameLink } from "@/components/client-name-link";

export const Route = createFileRoute("/_authenticated/autorenew-cancellations")({
  head: () => ({ meta: [{ title: "Отмены автопродления — CLUB 40 Admin" }] }),
  component: AutorenewCancellationsPage,
});

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
  } | null;
};

const REASON_ALL = "__all__";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDateTime(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const refreshSignal = useRefreshSignal();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState<string>(REASON_ALL);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!studioId) {
        setRows([]);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase
        .from("client_memberships")
        .select(
          "id, client_id, ends_at, auto_renew_cancelled_at, auto_renew_cancel_reason, membership:memberships(name), client:clients(id, user_id, full_name, first_name, last_name, phone, email)",
        )
        .eq("studio_id", studioId)
        .not("auto_renew_cancelled_at", "is", null)
        .order("auto_renew_cancelled_at", { ascending: false })
        .limit(1000);
      if (cancelled) return;
      if (error) {
        toast.error("Не удалось загрузить отмены: " + error.message);
        setRows([]);
      } else {
        setRows((data as unknown as Row[]) ?? []);
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [studioId, refreshSignal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (reason !== REASON_ALL && (r.auto_renew_cancel_reason ?? "") !== reason) return false;
      if (!q) return true;
      const name =
        r.client?.full_name ||
        [r.client?.first_name, r.client?.last_name].filter(Boolean).join(" ");
      return [name, r.client?.phone, r.client?.email, r.membership?.name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, search, reason]);

  const pg = usePagination(filtered);

  return (
    <AdminShell
      title="Отмены автопродления"
      description="Абонементы, у которых отключено автопродление"
      filters={
        studioId ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск: имя, телефон, почта, абонемент"
                className="h-8 pl-8"
              />
            </div>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-8 w-full sm:w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={REASON_ALL}>Все причины</SelectItem>
                <SelectItem value="self">Самостоятельная</SelectItem>
                <SelectItem value="auto">Автоматическая</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null
      }
    >
      <div className="mx-auto max-w-6xl space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
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
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
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
                    const name =
                      r.client?.full_name ||
                      [r.client?.first_name, r.client?.last_name].filter(Boolean).join(" ") ||
                      "—";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.client?.id && name !== "—" ? (
                            <ClientNameLink clientId={r.client.id}>{name}</ClientNameLink>
                          ) : (
                            name
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div>{r.client?.phone ?? "—"}</div>
                          <div className="text-xs">{r.client?.email ?? "—"}</div>
                        </TableCell>
                        <TableCell>{r.membership?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm">{fmtDate(r.ends_at)}</TableCell>
                        <TableCell>
                          <ReasonBadge value={r.auto_renew_cancel_reason} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDateTime(r.auto_renew_cancelled_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <DataPagination {...pg} />
          </div>
        )}
      </div>
    </AdminShell>
  );
}
