import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { useRefreshSignal } from "@/lib/refresh-bus";
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
import { Badge } from "@/components/ui/badge";
import { DataPagination, useServerPagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarSearch } from "@/components/table-toolbar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "sonner";
import { dayTypeLabel, dayTypeColor, type DayType } from "@/lib/workout-types";
import { ClientNameLink } from "@/components/client-name-link";
import { TableSkeletonRows } from "@/components/table-skeleton";

export const Route = createFileRoute("/_authenticated/bookings-log")({
  head: () => ({ meta: [{ title: "История записей — Base40 Admin" }] }),
  component: BookingsLogPage,
});

type LogRow = {
  id: string;
  booking_id: string | null;
  entry_id: string | null;
  user_id: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  client_full_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  workout_name: string | null;
  workout_type: string | null;
  starts_at: string;
  ends_at: string;
  status: "booked" | "waitlist" | "cancelled" | "attended" | "no_show" | "completed" | "rejected";
  booked_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
  cancel_reason: string | null;
  cancelled_lead_minutes: number | null;
  met_value: number | null;
  weight_at_time: number | null;
  duration_min: number | null;
  calories: number | null;
};

const STATUS_ALL = "__all__";

const statusLabel: Record<LogRow["status"], string> = {
  booked: "Забронировано",
  waitlist: "Лист ожидания",
  attended: "Посещено",
  no_show: "Пропущено",
  cancelled: "Отменено",
  rejected: "Отклонена",
  completed: "Проведено",
};

function StatusBadge({ value }: { value: LogRow["status"] }) {
  if (value === "attended" || value === "completed") {
    return <Badge variant="default">{statusLabel[value]}</Badge>;
  }
  if (value === "cancelled") {
    return <Badge variant="destructive">{statusLabel[value]}</Badge>;
  }
  if (value === "rejected") {
    return (
      <Badge variant="outline" className="text-orange-600 border-orange-600">
        {statusLabel[value]}
      </Badge>
    );
  }
  if (value === "no_show") {
    return <Badge variant="outline">{statusLabel[value]}</Badge>;
  }
  return <Badge variant="secondary">{statusLabel[value]}</Badge>;
}

function fmt(dt: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Срок отмены: >0 — за сколько до начала, <=0 — после начала занятия.
function formatLead(minutes: number) {
  if (minutes <= 0) return "после начала";
  if (minutes < 60) return `за ${minutes} мин до начала`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `за ${h} ч ${m} мин до начала` : `за ${h} ч до начала`;
}

function BookingsLogPage() {
  const studioId = useActiveStudioId();
  const refreshSignal = useRefreshSignal();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(STATUS_ALL);
  const [markingNoShows, setMarkingNoShows] = useState(false);

  const debouncedSearch = useDebouncedValue(search);
  const pg = useServerPagination();
  const { from, to, setTotal, setPage, beginRequest } = pg;

  useEffect(() => {
    setPage(1);
  }, [studioId, debouncedSearch, status, setPage]);

  const fetchRows = useCallback(async () => {
    const isStale = beginRequest();
    if (!studioId) {
      setRows([]);
      setTotal(0);
      return;
    }
    setLoading(true);

    // Вью bookings_log_full уже объединяет журнал с записями, которые в него
    // ещё не попали (см. db/performance_indexes.sql), поэтому сшивать
    // источники в браузере больше не нужно.
    let query = supabase
      .from("bookings_log_full")
      .select("*", { count: "exact" })
      .eq("studio_id", studioId);

    if (status !== STATUS_ALL) query = query.eq("status", status);

    const term = debouncedSearch.trim();
    if (term) query = query.ilike("search_text", `%${term}%`);

    const { data, error, count } = await query
      .order("starts_at", { ascending: false })
      .range(from, to);

    if (isStale()) return;
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить историю: " + error.message);
      return;
    }
    setRows((data as unknown as LogRow[]) ?? []);
    setTotal(count ?? 0);
  }, [studioId, status, debouncedSearch, from, to, setTotal, beginRequest]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows, refreshSignal]);

  // Раньше эта простановка вызывалась внутри загрузки страницы, то есть на
  // каждый ввод в поиске и на каждую смену страницы — а это два UPDATE'а по
  // всему журналу. Теперь только по явному нажатию.
  const markNoShows = async () => {
    setMarkingNoShows(true);
    const { data, error } = await supabase.rpc("mark_no_show_bookings", {
      p_studio_id: studioId,
    });
    setMarkingNoShows(false);
    if (error) {
      toast.error("Не удалось отметить пропущенные: " + error.message);
      return;
    }
    const n = typeof data === "number" ? data : 0;
    toast.success(n > 0 ? `Отмечено пропущенных: ${n}` : "Новых пропусков нет");
    fetchRows();
  };

  return (
    <AdminShell
      title="История записей"
      description="Журнал бронирований: пользователь, тренировка, статус"
    >
      <div className="space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
            <TableToolbar>
              <ToolbarSearch
                value={search}
                onChange={setSearch}
                placeholder="Поиск: имя, телефон, почта, тренировка"
              />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STATUS_ALL}>Все статусы</SelectItem>
                  <SelectItem value="booked">Забронировано</SelectItem>
                  <SelectItem value="attended">Посещено</SelectItem>
                  <SelectItem value="no_show">Пропущено</SelectItem>
                  <SelectItem value="cancelled">Отменено</SelectItem>
                  <SelectItem value="rejected">Отклонена</SelectItem>
                  <SelectItem value="completed">Проведено</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={markNoShows} disabled={markingNoShows}>
                {markingNoShows ? "Отмечаем…" : "Отметить пропущенные"}
              </Button>
            </TableToolbar>

            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Клиент</TableHead>
                    <TableHead>Контакты</TableHead>
                    <TableHead>Тренировка</TableHead>
                    <TableHead className="w-[160px]">Дата и время</TableHead>
                    <TableHead className="w-[140px]">Статус</TableHead>
                    <TableHead className="w-[70px] text-right">MET</TableHead>
                    <TableHead className="w-[80px] text-right">Вес, кг</TableHead>
                    <TableHead className="w-[80px] text-right">Длит., мин</TableHead>
                    <TableHead className="w-[90px] text-right">Ккал</TableHead>
                    <TableHead className="w-[160px]">Отменена</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableSkeletonRows columns={10} />
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Записей не найдено.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => {
                      const color = dayTypeColor(r.workout_type as DayType | null);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">
                            {(() => {
                              const name =
                                r.client_full_name ||
                                [r.client_first_name, r.client_last_name]
                                  .filter(Boolean)
                                  .join(" ") ||
                                "—";
                              if (!r.user_id || name === "—") return name;
                              return <ClientNameLink userId={r.user_id}>{name}</ClientNameLink>;
                            })()}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            <div>{r.client_phone ?? "—"}</div>
                            <div className="text-xs">{r.client_email ?? "—"}</div>
                          </TableCell>
                          <TableCell>
                            <div>{r.workout_name ?? "—"}</div>
                            {r.workout_type && color && (
                              <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span
                                  className={`inline-block h-2 w-2 rounded-full ${color.dot}`}
                                />
                                {dayTypeLabel(r.workout_type as DayType)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{fmt(r.starts_at)}</TableCell>
                          <TableCell>
                            <StatusBadge value={r.status} />
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {r.met_value != null ? Number(r.met_value).toFixed(1) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {r.weight_at_time != null ? Number(r.weight_at_time).toFixed(1) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {r.duration_min ?? "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {r.calories ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.cancelled_at ? (
                              <div className="space-y-0.5">
                                <div>{fmt(r.cancelled_at)}</div>
                                {r.cancel_reason && (
                                  <div className="text-foreground">{r.cancel_reason}</div>
                                )}
                                {r.cancelled_lead_minutes != null && (
                                  <div>{formatLead(r.cancelled_lead_minutes)}</div>
                                )}
                              </div>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
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
