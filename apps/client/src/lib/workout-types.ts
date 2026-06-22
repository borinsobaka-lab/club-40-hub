import {
  HeartPulse,
  Lightning,
  Shuffle,
  Leaf,
  Pulse,
  type Icon,
} from "@solar-icons/react";

export const TYPE_META: Record<
  string,
  { label: string; icon: LucideIcon; color: string; bg: string; stripe: string }
> = {
  cardio: { label: "Кардио", icon: HeartPulse, color: "text-blue-600", bg: "bg-blue-500/10", stripe: "bg-blue-500" },
  strength: { label: "Силовая", icon: Zap, color: "text-red-600", bg: "bg-red-500/10", stripe: "bg-red-500" },
  hybrid: { label: "Гибрид", icon: Shuffle, color: "text-violet-600", bg: "bg-violet-500/10", stripe: "bg-violet-500" },
  recovery: { label: "Восстановление", icon: Flower2, color: "text-emerald-600", bg: "bg-emerald-500/10", stripe: "bg-emerald-500" },
};

export const TYPE_ORDER = ["cardio", "strength", "hybrid", "recovery"];

const FALLBACK_ICON = Activity;

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
