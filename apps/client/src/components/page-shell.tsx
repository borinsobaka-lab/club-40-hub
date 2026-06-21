import { type ReactNode } from "react";

interface PageShellProps {
  header: ReactNode;
  children: ReactNode;
}

export function PageShell({ header, children }: PageShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 bg-muted/60">{header}</div>
      <div className="-mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-t-3xl bg-background pb-24 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.08)]">
        {children}
      </div>
    </div>
  );
}
