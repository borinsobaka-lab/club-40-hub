import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { useRefreshSignal } from "@/lib/refresh-bus";
import { Button } from "@/components/ui/button";
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
import { dayTypeLabel, dayTypeColor, type DayType } from "@/lib/workout-types";

export const Route = createFileRoute("/_authenticated/bookings-log")({
  head: () => ({ meta: [{ title: "История записей — CLUB 40 Admin" }] }),
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
  status: "booked" | "completed" | "cancelled" | "attended" | "no_show" | "rejected";
  booked_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
};

const STATUS_ALL = "__all__";

const statusLabel: Record<LogRow["status"], string> = {
  booked: "Забронировано",
  attended: "Посещено",
  no_show: "Пропущено",
  cancelled: "Отменено",
  rejected: "Отклонена",
  completed: "Проведено",
};

function StatusBadge({ value }: { value: LogRow["status"] }) {
  const variant =
    value === "attended"
      ? "default"
      : value === "completed"
        ? "default"
        : value === "cancelled" || value === "rejected"
          ? "destructive"
          : value === "no_show"
            ? "outline"
            : "secondary";
  return <Badge variant={variant}>{statusLabel[value]}</Badge>;
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

function BookingsLogPage() {
  const studioId = useActiveStudioId();
  const refreshSignal = useRefreshSignal();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(STATUS_ALL);
  const [marking, setMarking] = useState(false);

  const fetchRows = async () => {
    if (!studioId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings_log")
      .select("*")
      .eq("studio_id", studioId)
      .order("starts_at", { ascending: false })
      .limit(1000);
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить историю: " + error.message);
      return;
    }
    setRows((data as LogRow[]) ?? []);
  };

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshSignal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== STATUS_ALL && r.status !== status) return false;
      if (!q) return true;
      return [
        r.client_full_name,
        r.client_first_name,
        r.client_last_name,
        r.client_phone,
        r.client_email,
        r.workout_name,
      ]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, search, status]);

  const pg = usePagination(filtered);

  const handleMarkCompleted = async () => {
    setMarking(true);
    const { error } = await supabase.rpc("mark_no_show_bookings");
    setMarking(false);
    if (error) {
      toast.error("Ошибка: " + error.message);
      return;
    }
    toast.success("Прошедшие записи без отметки помечены как «Пропущено»");
    fetchRows();
  };

  return (
    <AdminShell
      title="История записей"
      description="Журнал бронирований: пользователь, тренировка, статус"
      actions={
        <Button
          variant="outline"
          size="default"
          onClick={handleMarkCompleted}
          disabled={marking || !studioId}
        >
          {marking ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Отметить пропущенные
        </Button>
      }
    >
      <div className="mx-auto max-w-6xl space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск: имя, телефон, почта, тренировка"
                  className="h-8 pl-8"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 w-[200px]">
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
            </div>

            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Контакты</TableHead>
                    <TableHead>Тренировка</TableHead>
                    <TableHead className="w-[160px]">Дата и время</TableHead>
                    <TableHead className="w-[140px]">Статус</TableHead>
                    <TableHead className="w-[160px]">Отменена</TableHead>
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
                        Записей не найдено.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.paged.map((r) => {
                      const color = dayTypeColor(r.workout_type as DayType | null);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">
                            {r.client_full_name ||
                              [r.client_first_name, r.client_last_name]
                                .filter(Boolean)
                                .join(" ") ||
                              "—"}
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
                          <TableCell className="text-sm">
                            {fmt(r.starts_at)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge value={r.status} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmt(r.cancelled_at)}
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
