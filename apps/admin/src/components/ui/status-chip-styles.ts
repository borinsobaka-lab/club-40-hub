/**
 * Вид чипа статуса — отдельно от компонентов (как field-styles.ts): классы
 * берут и чипы-кнопки, собранные не StatusChip. Смысл тонов — status-chip.tsx.
 */
export type StatusTone = "positive" | "negative" | "info" | "warning" | "neutral" | "strong";

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  positive: "bg-emerald-100 text-emerald-700",
  negative: "bg-rose-100 text-rose-700",
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-800",
  neutral: "bg-muted text-muted-foreground",
  strong: "bg-primary text-primary-foreground",
};

/** Геометрия чипа — для мест, где чип собран не этим компонентом (кнопка-чип). */
export const statusChipBase =
  "inline-flex shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0";

export const statusChipSize = {
  /** Обычный: таблицы, карточки, окна. */
  default: "px-2 py-0.5 text-xs",
  /** Компактный: внутри плотной строки (клиент в окне занятия, карточка занятия). */
  sm: "px-1.5 text-xs leading-4",
} as const;
