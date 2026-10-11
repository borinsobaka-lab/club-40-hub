import * as React from "react";

// На сервере useLayoutEffect ругается в консоль; там плашку всё равно не меряем.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export type Indicator = { left: number; top: number; width: number; height: number };

/**
 * Плашка под активным элементом группы (табы, сегменты): при переключении она
 * переезжает к новому элементу (transform + width), а не перекрашивает
 * кнопки. Положение меряем по DOM: смену выбора ловит MutationObserver на
 * атрибуте `attribute`, смену размеров (шрифт догрузился, ширина диалога) —
 * ResizeObserver. Первая отрисовка без анимации — плашка сразу на месте.
 *
 * `items` — селектор элементов группы, `active` — селектор активного.
 */
export function useActiveIndicator(
  listRef: React.RefObject<HTMLElement | null>,
  items: string,
  active: string,
  attribute: string,
) {
  const [indicator, setIndicator] = React.useState<Indicator | null>(null);

  useIsomorphicLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const update = () => {
      const el = list.querySelector<HTMLElement>(active);
      setIndicator(
        el
          ? {
              left: el.offsetLeft,
              top: el.offsetTop,
              width: el.offsetWidth,
              height: el.offsetHeight,
            }
          : null,
      );
    };
    update();

    const resize = new ResizeObserver(update);
    const observeItems = () => list.querySelectorAll(items).forEach((el) => resize.observe(el));
    resize.observe(list);
    observeItems();

    const mutation = new MutationObserver(() => {
      observeItems();
      update();
    });
    mutation.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [attribute],
    });

    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [items, active, attribute]);

  return indicator;
}
