/**
 * Плавная прокрутка на телефоне (жалоба владельца 2026-11-14: «частота кадров
 * низкая в PWA на Android»). Вызывается один раз из RootComponent (__root.tsx).
 *
 * - `<html data-scrolling>` — пока что-то прокручивается (страница, лента
 *   новостей, шторка) и ещё SCROLL_IDLE_MS после: огоньки шапки
 *   (.gradient-blobs) на это время замирают (styles.css). Их 8 больших
 *   полупрозрачных слоёв в бесконечной анимации — видеокарта телефона
 *   собирала бы их в каждом кадре вместе с прокруткой.
 *
 * Стекло нижнего меню (.glass-dark, backdrop-filter) оставлено везде: на
 * Android его убирали (2026-11-14), но без размытия меню либо слишком тёмное,
 * либо плохо читается — владелец вернул стекло.
 */
const SCROLL_IDLE_MS = 180;

export function installScrollPerf(): () => void {
  const root = document.documentElement;

  let timer: number | undefined;
  const onScroll = () => {
    if (timer === undefined) root.dataset.scrolling = "";
    else window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      delete root.dataset.scrolling;
    }, SCROLL_IDLE_MS);
  };
  // scroll не всплывает — ловим на погружении: так видны все контейнеры.
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    document.removeEventListener("scroll", onScroll, { capture: true });
    if (timer !== undefined) window.clearTimeout(timer);
    delete root.dataset.scrolling;
  };
}
