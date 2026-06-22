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

const GRID_COLS = 4;
const GRID_ROWS = 3; // 12 cells, drop 4 -> 8 evenly distributed blobs
const BLOB_COUNT = GRID_COLS * GRID_ROWS - 4;

interface PageShellProps {
  header: ReactNode;
  children: ReactNode;
}

export function PageShell({ header, children }: PageShellProps) {
  const { pathname } = useLocation();

  const blobStyles = useMemo(() => {
    const rand = seededRandom(pathname + ":blobs");
    const cells: Array<{ row: number; col: number }> = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) cells.push({ row: r, col: c });
    }
    // Fisher-Yates shuffle so the dropped cells differ per page
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const picked = cells.slice(0, BLOB_COUNT);
    const cellW = 100 / GRID_COLS;
    const cellH = 100 / GRID_ROWS;
    return picked.map(({ row, col }) => {
      const jitterX = (rand() - 0.5) * cellW * 0.7;
      const jitterY = (rand() - 0.5) * cellH * 0.7;
      return {
        top: `${(cellH * (row + 0.5) + jitterY).toFixed(2)}%`,
        left: `${(cellW * (col + 0.5) + jitterX).toFixed(2)}%`,
      };
    });
  }, [pathname]);

  const pseudoVars = useMemo(() => {
    const rand = seededRandom(pathname + ":pseudo");
    return {
      "--blob-before-top": `${Math.floor(rand() * 40)}%`,
      "--blob-before-left": `${Math.floor(rand() * 40)}%`,
      "--blob-after-bottom": `${Math.floor(rand() * 40)}%`,
      "--blob-after-right": `${Math.floor(rand() * 40)}%`,
    } as React.CSSProperties;
  }, [pathname]);

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-[#2A2B2F]">
      <div className="no-scrollbar relative z-10 h-full overflow-y-auto overscroll-contain">
        <div className="sticky top-0 z-0 text-white">
          <div className="relative">
            <div className="gradient-blobs" style={pseudoVars}>
              {blobStyles.map((style, i) => (
                <span key={i} style={style} />
              ))}
            </div>
            <div className="relative z-10">{header}</div>
          </div>
        </div>
        <div className="relative z-10 -mt-4 min-h-full rounded-t-3xl bg-background pb-24 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.08)]">
          {children}
        </div>
      </div>
    </div>
  );
}
