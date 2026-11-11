import { useQuery } from "@tanstack/react-query";

import { untypedDb } from "@/lib/untyped-db";

/**
 * «Закрытая запись» студии (решение владельца 2026-11-11, оба приложения):
 * расписание и тренировки видны, но записаться нельзя — карточки не
 * нажимаются, свободных мест не видно, подпись «Запись пока закрыта».
 * Переключатель — «Клубы» админки (`studios.booking_closed`,
 * db/migrations/2026-11-11_zz_studio_booking_closed.sql); граница — в базе
 * (`book_schedule_entry` отвечает `booking_closed`).
 *
 * Отдельный запрос, а не колонка в общих запросах студий: если приложение
 * выйдет раньше миграции, упадёт только он (запись считается открытой), а
 * выбор студии и расписание продолжат работать.
 */
export function useBookingClosed(studioId: string | null): boolean {
  const { data } = useQuery({
    queryKey: ["studio-booking-closed", studioId],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await untypedDb
        .from("studios")
        .select("booking_closed")
        .eq("id", studioId!)
        .maybeSingle();
      if (error) return false;
      return (data as { booking_closed?: boolean } | null)?.booking_closed === true;
    },
    enabled: !!studioId,
    staleTime: 60_000,
  });
  return data ?? false;
}
