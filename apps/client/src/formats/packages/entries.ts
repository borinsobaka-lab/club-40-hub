import type { WorkoutDrawerData } from "@/components/workout-drawer";
import type { ContentTranslations } from "@/i18n";
import { mediaUrl } from "@/lib/media";

/**
 * Занятие расписания пакетного формата — как его выбирают расписание и
 * главная (одна карточка в обоих местах, решение владельца 2026-10-11).
 * Цвет тренировки — workouts.color (полоска слева), без типа и иконки.
 */
export type PackTrainer = {
  id: string;
  full_name: string | null;
  photo_url: string | null;
  /** Средний рейтинг (numeric — приходит строкой) и число оценок. */
  rating_avg?: number | string | null;
  rating_count?: number | null;
  /** Переводы имени (src/i18n/content.ts). */
  translations?: ContentTranslations | null;
};

export type PackEntry = {
  id: string;
  studio_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  booked_count: number;
  workout: {
    id: string;
    name: string;
    color: string | null;
    description: string | null;
    photo_url: string | null;
    capacity: number | null;
    translations?: ContentTranslations | null;
  } | null;
  trainers: { trainer: PackTrainer | null }[] | null;
};

/** select для schedule_entries (и вложенного entry в schedule_bookings). */
export const PACK_ENTRY_SELECT =
  "id, studio_id, starts_at, ends_at, capacity, booked_count, workout:workouts(id, name, color, description, photo_url, capacity, translations), trainers:schedule_entry_trainers(trainer:trainers(id, full_name, photo_url, rating_avg, rating_count, translations))";

export function entryTrainers(e: PackEntry): PackTrainer[] {
  return (e.trainers ?? []).map((t) => t.trainer).filter((t): t is PackTrainer => !!t);
}

/** Средний рейтинг тренера; нет оценок — null. */
export function trainerRating(t: PackTrainer): number | null {
  if (t.rating_avg == null || !t.rating_count) return null;
  const n = Number(t.rating_avg);
  return Number.isFinite(n) ? n : null;
}

export function trainerPhoto(t: PackTrainer) {
  return mediaUrl(t.photo_url, "trainer-photos");
}

export function trainerInitials(name: string | null) {
  const parts = (name ?? "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Цвет полоски: цвет тренировки (#rrggbb), без него — серый. */
export function entryColor(e: PackEntry): string | null {
  const c = e.workout?.color?.trim();
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
}

/** Продолжительность в минутах. */
export function durationMinutes(e: { starts_at: string; ends_at: string }) {
  const ms = new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : null;
}

/** Свободных мест; null — без ограничения (вместимость пусто/0, как в записи). */
export function spotsLeft(e: PackEntry): number | null {
  const cap = e.capacity ?? e.workout?.capacity ?? null;
  if (cap == null || cap <= 0) return null;
  return Math.max(0, cap - e.booked_count);
}

export function pluralSeats(n: number) {
  if (n % 100 >= 11 && n % 100 <= 14) return "мест";
  const r = n % 10;
  if (r === 1) return "место";
  if (r >= 2 && r <= 4) return "места";
  return "мест";
}

/** «Свободно 5 мест» / «Мест нет»; без ограничения — null. */
export function spotsLabel(e: PackEntry): string | null {
  const left = spotsLeft(e);
  if (left === null) return null;
  if (left === 0) return "Мест нет";
  return `Свободно ${left} ${pluralSeats(left)}`;
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Данные шторки тренировки. */
export function packEntryToDrawerData(e: PackEntry): WorkoutDrawerData {
  const trainers = entryTrainers(e);
  return {
    id: e.id,
    name: e.workout?.name ?? "Тренировка",
    type: null,
    description: e.workout?.description ?? null,
    photo: mediaUrl(e.workout?.photo_url, "workout-photos"),
    trainerName:
      trainers
        .map((t) => t.full_name)
        .filter(Boolean)
        .join(", ") || null,
    trainerPhoto: trainers.map(trainerPhoto).find(Boolean) ?? null,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    color: entryColor(e),
    trainers: trainers.map((t) => ({
      id: t.id,
      name: t.full_name ?? "Тренер",
      photo: trainerPhoto(t),
      rating: trainerRating(t),
    })),
    spotsLabel: spotsLabel(e),
    spotsLeft: spotsLeft(e),
    studioId: e.studio_id,
  };
}
