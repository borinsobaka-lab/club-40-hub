export type WorkoutType = "strength" | "cardio" | "hybrid" | "recovery";

export const WORKOUT_TYPES: { value: WorkoutType; label: string }[] = [
  { value: "strength", label: "Силовая" },
  { value: "cardio", label: "Кардио" },
  { value: "hybrid", label: "Гибрид" },
  { value: "recovery", label: "Восстановление" },
];

// Distinct, accessible colors per workout type.
export const WORKOUT_TYPE_COLORS: Record<
  WorkoutType,
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
    dot: "bg-amber-500",
    bg: "bg-amber-500",
    text: "text-white",
    border: "border-amber-600",
    hex: "#f59e0b",
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

export function workoutTypeLabel(v: string | null | undefined) {
  return WORKOUT_TYPES.find((t) => t.value === v)?.label ?? "—";
}

export function workoutTypeColor(v: string | null | undefined) {
  if (v && v in WORKOUT_TYPE_COLORS) {
    return WORKOUT_TYPE_COLORS[v as WorkoutType];
  }
  return null;
}
