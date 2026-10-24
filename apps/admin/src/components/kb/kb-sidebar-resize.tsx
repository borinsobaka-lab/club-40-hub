import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { KB_SIDEBAR_WIDTH } from "@/components/kb/use-kb-sidebar-width";

const { DEFAULT, MIN, MAX } = KB_SIDEBAR_WIDTH;

/**
 * Ручка на правом крае меню базы: тянуть мышью, двойной щелчок — обычная
 * ширина, стрелки ←/→ с клавиатуры.
 */
export function KbSidebarResize({
  width,
  setWidth,
}: {
  width: number;
  setWidth: (w: number, persist: boolean) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = width;
    let last = start;
    setDragging(true);
    // Пока тянут, у панели нет анимации ширины — иначе она отстаёт от мыши.
    document.body.dataset.sidebarResizing = "";
    const move = (ev: PointerEvent) => {
      last = start + ev.clientX - startX;
      setWidth(last, false);
    };
    const up = () => {
      setDragging(false);
      delete document.body.dataset.sidebarResizing;
      setWidth(last, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина меню базы знаний"
      aria-valuenow={width}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      title="Потяните, чтобы изменить ширину меню. Двойной щелчок — обычная ширина"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(DEFAULT, true)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          setWidth(width + (e.key === "ArrowLeft" ? -16 : 16), true);
        }
      }}
      className={
        "absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:right-[3px] after:w-0.5 after:rounded-full after:bg-white/0 after:transition-colors hover:after:bg-white/30 focus-visible:after:bg-white/50 " +
        (dragging ? "after:bg-white/40" : "")
      }
    />
  );
}
