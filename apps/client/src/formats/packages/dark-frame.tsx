import type { ReactNode } from "react";

import { GlowBlobs, HeaderBackdrop } from "@/components/page-shell";

/**
 * Полноэкранный экран пакетного приложения в оформлении разделов (PageShell):
 * сверху тёмная зона с огоньками, под ней белая скруглённая панель с
 * содержимым; кнопка (footer) — внизу панели. Онбординг и вход.
 * tall — вход, вступление и финал анкеты: тёмная зона занимает всё
 * свободное место (заголовок — внизу, огоньки — на всю её высоту), белая
 * панель — по содержимому, без пустого места над кнопкой.
 */
export function DarkFrame({
  tall = false,
  header,
  footer,
  children,
}: {
  tall?: boolean;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      {/* Фон и огоньки — те же, что у разделов приложения. */}
      <HeaderBackdrop full={tall} />
      <div
        className={`relative z-10 text-white pt-[max(env(safe-area-inset-top),0.75rem)] ${
          tall ? "flex min-h-0 flex-1 flex-col justify-end" : "shrink-0"
        }`}
      >
        {header}
      </div>
      <div
        className={`relative z-10 -mt-4 flex flex-col overflow-hidden rounded-t-3xl bg-background shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.08)] ${
          tall ? "max-h-[70%] shrink-0" : "min-h-0 flex-1"
        }`}
      >
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
        <div className="px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]">{footer}</div>
      </div>
    </div>
  );
}

/**
 * Иллюстрация в тёмной зоне (вход, вступление и финал анкеты): занимает
 * свободное место между логотипом и заголовком, не выше 400px. Края картинки
 * растворяются в фоне, а огоньки идут поверх неё по краям — в центре, где
 * сам рисунок, их нет (маски — .art-fade и .art-glow-over в styles.css).
 */
export function Illustration({ src }: { src: string }) {
  return (
    <div className="relative my-auto min-h-0 w-full max-h-[400px] flex-1">
      <img
        src={src}
        alt=""
        className="art-fade absolute inset-0 m-auto h-full w-full object-contain"
      />
      <GlowBlobs className="art-glow-over" />
    </div>
  );
}
