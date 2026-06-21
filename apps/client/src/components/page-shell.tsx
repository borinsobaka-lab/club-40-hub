import { type ReactNode } from "react";

interface PageShellProps {
  header: ReactNode;
  children: ReactNode;
}

export function PageShell({ header, children }: PageShellProps) {
  return (
    <div className="flex flex-col flex-1">
      <div className="shrink-0 bg-muted/60">{header}</div>
      <div className="flex-1 -mt-4 rounded-t-3xl bg-background shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.08)] overflow-y-auto pb-24">
        {children}
      </div>
    </div>
  );
}
