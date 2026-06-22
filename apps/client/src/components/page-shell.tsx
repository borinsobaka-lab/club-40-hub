import { useLocation } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";

function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h >>> 0) / 4294967296;
  };
}

const BLOB_COUNT = 18;

interface PageShellProps {
  header: ReactNode;
  children: ReactNode;
}

export function PageShell({ header, children }: PageShellProps) {
  const { pathname } = useLocation();

  const blobStyles = useMemo(() => {
    const rand = seededRandom(pathname + ":blobs");
    return Array.from({ length: BLOB_COUNT }, () => ({
      top: `${Math.floor(rand() * 95)}%`,
      left: `${Math.floor(rand() * 95)}%`,
    }));
  }, [pathname]);

  const pseudoVars = useMemo(() => {
    const beforeRand = seededRandom(pathname + ":before");
    const afterRand = seededRandom(pathname + ":after");
    return {
      "--blob-before-top": `${Math.floor(beforeRand() * 95)}%`,
      "--blob-before-left": `${Math.floor(beforeRand() * 95)}%`,
      "--blob-after-bottom": `${Math.floor(afterRand() * 95)}%`,
      "--blob-after-right": `${Math.floor(afterRand() * 95)}%`,
    } as React.CSSProperties;
  }, [pathname]);

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-[#2A2B2F]">
      <div className="gradient-blobs" style={pseudoVars}>
        {blobStyles.map((style, i) => (
          <span key={i} style={style} />
        ))}
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
