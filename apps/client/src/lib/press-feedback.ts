/**
 * Отклик на нажатие — один на всё приложение (решение владельца 2026-11-27:
 * «кнопки приседают»). Вызывается один раз из RootComponent (__root.tsx).
 *
 * Всё, что нажимается (кнопки, ссылки, карточки-кнопки), на время касания
 * получает атрибут `data-pressed` — стили в styles.css чуть уменьшают
 * элемент. Не `:active`:
 * - палец, который начал прокрутку, не должен «приседать» карточки списка —
 *   нажатие показывается через PRESS_DELAY_MS и снимается, если палец уехал;
 * - быстрое касание всё равно должно быть видно — после отпускания отклик
 *   держится ещё MIN_VISIBLE_MS;
 * - в iOS `:active` срабатывает не везде.
 *
 * Свой отклик у элемента (или его нет вовсе) — `data-no-press`.
 */
const PRESSABLE =
  'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [data-press]';
const PRESS_DELAY_MS = 70;
const MIN_VISIBLE_MS = 110;
const MOVE_CANCEL_PX = 8;

export function installPressFeedback(): () => void {
  let el: HTMLElement | null = null;
  let timer: number | undefined;
  let shownAt = 0;
  let startX = 0;
  let startY = 0;

  const show = () => {
    timer = undefined;
    if (!el) return;
    // Крупное (карточка во всю ширину) приседает слабее мелкой кнопки.
    el.dataset.pressed = el.offsetWidth > 220 || el.offsetHeight > 120 ? "lg" : "";
    shownAt = performance.now();
  };

  const clear = (target: HTMLElement | null) => {
    if (target) delete target.dataset.pressed;
  };

  const cancel = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    clear(el);
    el = null;
  };

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    cancel();
    const target = (e.target as Element | null)?.closest?.<HTMLElement>(PRESSABLE);
    if (
      !target ||
      target.closest("[data-no-press]") ||
      (target as HTMLButtonElement).disabled ||
      target.getAttribute("aria-disabled") === "true"
    ) {
      return;
    }
    el = target;
    startX = e.clientX;
    startY = e.clientY;
    // Мышью прокрутку не начинают — отклик сразу.
    if (e.pointerType === "mouse") show();
    else timer = window.setTimeout(show, PRESS_DELAY_MS);
  };

  const onMove = (e: PointerEvent) => {
    if (!el) return;
    if (
      Math.abs(e.clientX - startX) > MOVE_CANCEL_PX ||
      Math.abs(e.clientY - startY) > MOVE_CANCEL_PX
    ) {
      cancel();
    }
  };

  const onUp = () => {
    if (!el) return;
    const target = el;
    if (timer !== undefined) {
      // Отпустили раньше задержки — показываем коротко.
      window.clearTimeout(timer);
      show();
    }
    el = null;
    const left = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
    window.setTimeout(() => clear(target), left);
  };

  const opts = { capture: true, passive: true } as const;
  document.addEventListener("pointerdown", onDown, opts);
  document.addEventListener("pointermove", onMove, opts);
  document.addEventListener("pointerup", onUp, opts);
  document.addEventListener("pointercancel", cancel, opts);
  document.addEventListener("scroll", cancel, opts);
  return () => {
    document.removeEventListener("pointerdown", onDown, opts);
    document.removeEventListener("pointermove", onMove, opts);
    document.removeEventListener("pointerup", onUp, opts);
    document.removeEventListener("pointercancel", cancel, opts);
    document.removeEventListener("scroll", cancel, opts);
    cancel();
  };
}
