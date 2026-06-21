import type { ReactNode } from "react";

/**
 * Visual layout used across mobile screens.
 * Top zone — gray "background plate" with the page header / hero.
 * Bottom zone — rounded-top sheet with the actual content, sliding over the plate.
 */
export function PageShell({
  header,
  children,
  sheetClassName = "",
}: {
  header: ReactNode;
  children: ReactNode;
  sheetClassName?: string;
}) {
  return (
    <div className="min-h-full bg-muted/60">
      <div className="pt-2 pb-6">{header}</div>
      <div
        className={`relative -mt-4 rounded-t-3xl bg-background shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.08)] min-h-[60vh] ${sheetClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

/** Standard "Title + subtitle on gray plate" header used on inner sections. */
export function PageTitleHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="px-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {right}
    </div>
  );
}
