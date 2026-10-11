import * as React from "react";

import { useFieldId } from "@/components/ui/field-context";
import { cn } from "@/lib/utils";

/**
 * `note` — поле заметки или комментария: «бумажка» (тёплый тон и тень,
 * styles.css, `textarea[data-note]`), чтобы заметки выделялись среди
 * обычных полей (решение владельца 2026-10-11).
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { note?: boolean }
>(({ className, id, note, ...props }, ref) => {
  const fieldId = useFieldId(id);
  return (
    <textarea
      id={fieldId}
      data-note={note ? "" : undefined}
      className={cn(
        "flex min-h-20 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
