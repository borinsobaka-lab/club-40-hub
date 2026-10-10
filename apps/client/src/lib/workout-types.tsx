import type { ComponentType } from "react";
import { HeartPulse, Leaf, Pulse } from "@solar-icons/react";
import Dumbbell from "@solar-icons/react/icons/sports/Dumbbell";
import Filters from "@solar-icons/react/icons/tools/Filters";
import type { WorkoutDrawerData } from "@/components/workout-drawer";
import { mediaUrl } from "@/lib/media";

/** Занятие из schedule_entries в том виде, в каком его выбирают страницы. */
export type ScheduleEntryForDrawer = {
  id: string;
  starts_at: string;
  ends_at: string;
  workout: {
    name: string;
    type: string | null;
    description: string | null;
    photo_url: string | null;
  } | null;
  trainers: { trainer: { full_name: string | null; photo_url: string | null } | null }[] | null;
};

/** Данные шторки тренировки (общие для главной и расписания). */
export function entryToDrawerData(entry: ScheduleEntryForDrawer): WorkoutDrawerData {
  const trainerList = (entry.trainers ?? [])
    .map((t) => t.trainer)
    .filter((t): t is NonNullable<typeof t> => !!t);
  const trainerName =
    trainerList
      .map((t) => t.full_name)
      .filter((n): n is string => !!n)
      .join(", ") || null;
  return {
    id: entry.id,
    name: entry.workout?.name ?? "Занятие",
    type: entry.workout?.type ?? null,
    description: entry.workout?.description ?? null,
    photo: mediaUrl(entry.workout?.photo_url, "workout-photos"),
    trainerName,
    trainerPhoto: mediaUrl(trainerList.find((t) => !!t.photo_url)?.photo_url, "trainer-photos"),
    startsAt: entry.starts_at,
    endsAt: entry.ends_at,
  };
}

const DumbbellIcon = (props: { className?: string }) => (
  <Dumbbell {...props} weight="BoldDuotone" />
);
const FiltersIcon = (props: { className?: string }) => <Filters {...props} weight="BoldDuotone" />;

export const TYPE_META: Record<
  string,
  {
    label: string;
    icon: ComponentType<{ className?: string }>;
    color: string;
    bg: string;
    stripe: string;
  }
> = {
  cardio: {
    label: "Кардио",
    icon: HeartPulse,
    color: "text-red-600",
    bg: "bg-red-500/10",
    stripe: "bg-red-500",
  },
  strength: {
    label: "Силовая",
    icon: DumbbellIcon,
    color: "text-blue-600",
    bg: "bg-blue-500/10",
    stripe: "bg-blue-500",
  },
  hybrid: {
    label: "Гибрид",
    icon: FiltersIcon,
    color: "text-violet-600",
    bg: "bg-violet-500/10",
    stripe: "bg-violet-500",
  },
  recovery: {
    label: "Восстановление",
    icon: Leaf,
    color: "text-emerald-600",
    bg: "bg-emerald-500/10",
    stripe: "bg-emerald-500",
  },
};

export const TYPE_ORDER = ["cardio", "strength", "hybrid", "recovery"];

const FALLBACK_ICON = Pulse;

export function workoutTypeMeta(type: string | null | undefined) {
  if (!type)
    return {
      label: "Тренировка",
      icon: FALLBACK_ICON,
      color: "text-muted-foreground",
      bg: "bg-muted",
      stripe: "bg-muted-foreground/40",
    };
  const key = type.toLowerCase().trim();
  if (TYPE_META[key]) return TYPE_META[key];
  const byLabel = Object.values(TYPE_META).find((m) => m.label.toLowerCase() === key);
  return (
    byLabel ?? {
      label: type,
      icon: FALLBACK_ICON,
      color: "text-muted-foreground",
      bg: "bg-muted",
      stripe: "bg-muted-foreground/40",
    }
  );
}
