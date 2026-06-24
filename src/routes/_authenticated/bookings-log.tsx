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
import { ClientNameLink } from "@/components/client-name-link";

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

type BookingStatus = LogRow["status"];

type ScheduleBookingRow = {
  id: string;
  entry_id: string;
  user_id: string;
  status: BookingStatus;
  created_at: string;
  cancelled_at: string | null;
};

type EntryRow = {
  id: string;
  workout_id: string | null;
  starts_at: string;
  ends_at: string;
};

type WorkoutRow = {
  id: string;
  name: string | null;
  type: string | null;
};

type ClientSnapshotRow = {
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
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
  if (value === "attended" || value === "completed") {
    return <Badge variant="default">{statusLabel[value]}</Badge>;
  }
  if (value === "cancelled") {
    return <Badge variant="destructive">{statusLabel[value]}</Badge>;
  }
  if (value === "rejected") {
    return (
      <Badge variant="outline" className="text-orange-600 border-orange-600 dark:text-orange-400 dark:border-orange-400">
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

function BookingsLogPage() {
  const studioId = useActiveStudioId();
  const refreshSignal = useRefreshSignal();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(STATUS_ALL);

  const fetchRows = async () => {
    if (!studioId) {
      setRows([]);
      return;
    }
    setLoading(true);
    // Авто-отметка пропущенных тренировок (прошедшие без отметки посещения)
    await supabase.rpc("mark_no_show_bookings");

    const { data: logData, error: logError } = await supabase
      .from("bookings_log")
      .select("*")
      .eq("studio_id", studioId)
      .order("starts_at", { ascending: false })
      .limit(1000);

    if (logError) {
      setLoading(false);
      toast.error("Не удалось загрузить историю: " + logError.message);
      return;
    }

    const logRows = (logData as LogRow[]) ?? [];
    const { data: bookingData, error: bookingError } = await supabase
      .from("schedule_bookings")
      .select("id, entry_id, user_id, status, created_at, cancelled_at")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (bookingError) {
      setLoading(false);
      toast.error("Не удалось сверить записи: " + bookingError.message);
      setRows(logRows);
      return;
    }

    const bookingRows = (bookingData as ScheduleBookingRow[]) ?? [];
    const loggedBookingIds = new Set(logRows.map((row) => row.booking_id).filter(Boolean));
    const missingBookings = bookingRows.filter((booking) => !loggedBookingIds.has(booking.id));

    if (missingBookings.length === 0) {
      setRows(logRows);
      setLoading(false);
      return;
    }

    const entryIds = Array.from(new Set(missingBookings.map((booking) => booking.entry_id)));
    const userIds = Array.from(new Set(missingBookings.map((booking) => booking.user_id)));

    const { data: entryData } = await supabase
      .from("schedule_entries")
      .select("id, workout_id, starts_at, ends_at")
      .in("id", entryIds);

    const entryRows = (entryData as EntryRow[]) ?? [];
    const entriesById = new Map(entryRows.map((entry) => [entry.id, entry]));
    const workoutIds = Array.from(
      new Set(entryRows.map((entry) => entry.workout_id).filter(Boolean) as string[]),
    );

    const { data: workoutData } = workoutIds.length
      ? await supabase.from("workouts").select("id, name, type").in("id", workoutIds)
      : { data: [] };
    const workoutsById = new Map(
      ((workoutData as WorkoutRow[]) ?? []).map((workout) => [workout.id, workout]),
    );

    const { data: clientData } = userIds.length
      ? await supabase
          .from("clients")
          .select("user_id, first_name, last_name, full_name, phone, email")
          .eq("studio_id", studioId)
          .in("user_id", userIds)
      : { data: [] };
    const clientsByUserId = new Map(
      ((clientData as ClientSnapshotRow[]) ?? [])
        .filter((client) => client.user_id)
        .map((client) => [client.user_id as string, client]),
    );

    const restoredRows = missingBookings
      .map((booking): LogRow | null => {
        const entry = entriesById.get(booking.entry_id);
        if (!entry) return null;

        const workout = entry.workout_id ? workoutsById.get(entry.workout_id) : undefined;
        const client = clientsByUserId.get(booking.user_id);
        const fallbackFullName = [client?.first_name, client?.last_name]
          .filter(Boolean)
          .join(" ");

        return {
          id: `schedule-booking-${booking.id}`,
          booking_id: booking.id,
          entry_id: booking.entry_id,
          user_id: booking.user_id,
          client_first_name: client?.first_name ?? null,
          client_last_name: client?.last_name ?? null,
          client_full_name: client?.full_name ?? (fallbackFullName || null),
          client_phone: client?.phone ?? null,
          client_email: client?.email ?? null,
          workout_name: workout?.name ?? null,
          workout_type: workout?.type ?? null,
          starts_at: entry.starts_at,
          ends_at: entry.ends_at,
          status: booking.status,
          booked_at: booking.created_at,
          cancelled_at: booking.cancelled_at,
          completed_at: null,
        };
      })
      .filter((row): row is LogRow => Boolean(row));

    setRows(
      [...logRows, ...restoredRows].sort(
        (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
      ),
    );
    setLoading(false);
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

  return (
    <AdminShell
      title="История записей"
      description="Журнал бронирований: пользователь, тренировка, статус"
      filters={
        studioId ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск: имя, телефон, почта, тренировка"
                className="h-8 pl-8"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-full sm:w-[200px]">
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
        ) : null
      }
    >

      <div className="mx-auto max-w-6xl space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>


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
                            {(() => {
                              const name =
                                r.client_full_name ||
                                [r.client_first_name, r.client_last_name]
                                  .filter(Boolean)
                                  .join(" ") ||
                                "—";
                              if (!r.user_id || name === "—") return name;
                              return (
                                <ClientNameLink userId={r.user_id}>{name}</ClientNameLink>
                              );
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
