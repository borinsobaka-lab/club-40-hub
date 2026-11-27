import type { ComponentType } from "react";

/**
 * Переключатель-«пилюля» (решение владельца 2026-11-24: вкладки тренера на
 * главной — не подчёркнутые табы, а переключатель): серая дорожка, под
 * выбранным вариантом — белая плашка, которая переезжает с пружинкой.
 * Варианты равной ширины; плашка двигается transform'ом — без измерений.
 */
export function SegmentedSwitch<K extends string>({
  options,
  value,
  onChange,
  className = "",
  "aria-label": ariaLabel,
}: {
  options: readonly {
    key: K;
    label: string;
    icon?: ComponentType<{ className?: string; weight?: "Bold" | "Linear" | "BoldDuotone" }>;
  }[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.key === value),
  );
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`relative grid rounded-full bg-muted p-1 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-background shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.08)] transition-transform duration-[380ms] ease-[cubic-bezier(0.34,1.36,0.64,1)] motion-reduce:transition-none"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o) => {
        const active = o.key === value;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={`relative z-10 flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[15px] font-semibold transition duration-300 active:scale-[0.97] ${
              active ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {Icon && (
              <Icon
                className={`h-[18px] w-[18px] shrink-0 transition duration-300 ${active ? "text-primary" : ""}`}
                weight={active ? "Bold" : "Linear"}
              />
            )}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
