import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  className?: string;
  style?: CSSProperties;
  spin?: boolean;
  title?: string;
};

/**
 * Bootstrap Icons wrapper. Renders a font-based <i> element.
 * Accepts h-N / w-N tailwind utilities and converts them to font-size,
 * so existing call sites that used Lucide-style sizing keep working.
 */
export function BIcon({ name, className = "", style, spin, title }: Props) {
  const sizeMatch = className.match(/(?:^|\s)h-(\d+(?:\.\d+)?)(?=\s|$)/);
  const fontSize = sizeMatch ? `${parseFloat(sizeMatch[1]) * 0.25}rem` : undefined;
  const cleaned = className
    .replace(/(?:^|\s)h-\S+/g, " ")
    .replace(/(?:^|\s)w-\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <i
      aria-hidden={title ? undefined : true}
      aria-label={title}
      title={title}
      className={cn("bi inline-block leading-none align-middle", `bi-${name}`, spin && "animate-spin", cleaned)}
      style={{ fontSize, lineHeight: 1, ...style }}
    />
  );
}
