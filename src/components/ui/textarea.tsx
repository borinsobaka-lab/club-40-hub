import * as React from "react";

import { useFieldId } from "@/components/ui/field-context";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, id, ...props }, ref) => {
    const fieldId = useFieldId(id);
    return (
      <textarea
        id={fieldId}
        className={cn(
          "flex min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
