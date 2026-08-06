import type { ComponentType } from "react";
import { HeartPulse, Leaf, Pulse } from "@solar-icons/react";
import Dumbbell from "@solar-icons/react/icons/sports/Dumbbell";
import Filters from "@solar-icons/react/icons/tools/Filters";

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
