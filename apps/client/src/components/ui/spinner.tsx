import { Refresh } from "@solar-icons/react";

import { cn } from "@/lib/utils";

/** Крутилка ожидания внутри кнопки — вместо «...» (размер задаёт кнопка). */
export function Spinner({ className }: { className?: string }) {
  return (
    <Refresh className={cn("animate-spin", className)} weight="BoldDuotone" aria-hidden="true" />
  );
}
