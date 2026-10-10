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
    dot: "bg-blue-500",
    bg: "bg-blue-500",
    text: "text-white",
    border: "border-blue-600",
    hex: "#3b82f6",
  },
  cardio: {
    dot: "bg-red-500",
    bg: "bg-red-500",
    text: "text-white",
    border: "border-red-600",
    hex: "#ef4444",
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
