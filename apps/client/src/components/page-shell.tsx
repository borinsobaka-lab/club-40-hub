import { type ReactNode } from "react";

interface PageShellProps {
  header: ReactNode;
  children: ReactNode;
}

export function PageShell({ header, children }: PageShellProps) {
  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-[#2A2B2F]">
      <div className="gradient-blobs">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="no-scrollbar relative z-10 h-full overflow-y-auto overscroll-contain">
        <div className="sticky top-0 z-0 text-white">{header}</div>
        <div className="relative z-10 -mt-4 min-h-full rounded-t-3xl bg-background pb-24 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.08)]">
          {children}
        </div>
      </div>
    </div>
  );
}
