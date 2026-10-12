import { queryOptions } from "@tanstack/react-query";

import { PACK_ENTRY_SELECT } from "@/formats/packages/entries";
import { untypedDb } from "@/lib/untyped-db";
import { IS_PACKAGES } from "@/lib/terms";

type Trainer = { id: string; full_name: string | null; photo_url: string | null };

export type MyBooking = {
  entry_id: string;
  entry: {
    id: string;
    starts_at: string;
    ends_at: string;
    workout: {
      name: string;
      type: string | null;
      description: string | null;
      photo_url: string | null;
    } | null;
    trainers: { trainer: Trainer | null }[] | null;
  } | null;
};

/**
 * Предстоящие записи клиента — блок «Тренировки» на главной. Вынесен из
 * routes/index.tsx, чтобы каркас (__root.tsx) запрашивал его сразу после
 * входа, параллельно с проверкой анкеты, а не после неё.
 */
export function homeBookingsQuery(userId: string | null) {
  return queryOptions({
    queryKey: ["home-bookings", userId],
    queryFn: async (): Promise<MyBooking[]> => {
      // Явный фильтр по user_id: RLS позволяет тренеру видеть все брони студии,
      // и без него у сотрудника в клиентском приложении чужие записи выглядели
      // бы как его собственные.
      // Только предстоящие (через !inner-связь с занятием) — без всей истории
      // броней; групповые неотменённые — как в расписании.
      const { data, error } = await untypedDb
        .from("schedule_bookings")
        .select(
          IS_PACKAGES
            ? // Пакетное — карточка как в расписании: цвет, места, фото тренеров.
              `entry_id, entry:schedule_entries!inner(${PACK_ENTRY_SELECT})`
            : "entry_id, entry:schedule_entries!inner(id, starts_at, ends_at, workout:workouts(name, type, description, photo_url, translations), trainers:schedule_entry_trainers(trainer:trainers(id, full_name, photo_url, translations)))",
        )
        .eq("user_id", userId)
        .eq("status", "booked")
        .gte("entry.starts_at", new Date().toISOString())
        .eq("entry.kind", "group")
        .is("entry.cancelled_at", null)
        .limit(50);
      if (error) throw error;
      return (data as unknown as MyBooking[] | null) ?? [];
    },
    enabled: !!userId,
  });
}
