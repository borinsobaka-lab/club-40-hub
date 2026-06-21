export type DayType = "strength" | "cardio" | "hybrid" | "recovery";

export const DAY_TYPES: { value: DayType; label: string }[] = [
  { value: "strength", label: "Силовая" },
  { value: "cardio", label: "Кардио" },
  { value: "hybrid", label: "Гибрид" },
  { value: "recovery", label: "Восстановление" },
];

export const DAY_TYPE_COLORS: Record<
  DayType,
  { dot: string; bg: string; text: string; border: string; hex: string }
> = {
  strength: {
    dot: "bg-rose-500",
    bg: "bg-rose-500",
    text: "text-white",
    border: "border-rose-600",
    hex: "#f43f5e",
  },
  cardio: {
    dot: "bg-sky-500",
    bg: "bg-sky-500",
    text: "text-white",
    border: "border-sky-600",
    hex: "#0ea5e9",
  },
  hybrid: {
    dot: "bg-violet-500",
    bg: "bg-violet-500",
    text: "text-white",
    border: "border-violet-600",
    hex: "#8b5cf6",
  },
  recovery: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-500",
    text: "text-white",
    border: "border-emerald-600",
    hex: "#10b981",
  },
};

export function dayTypeLabel(v: string | null | undefined) {
  return DAY_TYPES.find((t) => t.value === v)?.label ?? "—";
}

export function dayTypeColor(v: string | null | undefined) {
  if (v && v in DAY_TYPE_COLORS) {
    return DAY_TYPE_COLORS[v as DayType];
  }
  return null;
}

// Backwards compatibility aliases (kept so existing imports keep working).
export type WorkoutType = DayType;
export const WORKOUT_TYPES = DAY_TYPES;
export const WORKOUT_TYPE_COLORS = DAY_TYPE_COLORS;
export const workoutTypeLabel = dayTypeLabel;
export const workoutTypeColor = dayTypeColor;
