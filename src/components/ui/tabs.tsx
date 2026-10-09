import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

// На сервере useLayoutEffect ругается в консоль; там плашку всё равно не меряем.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

type Indicator = { left: number; top: number; width: number; height: number };

/**
 * Активный таб подсвечивает не сам триггер, а общая плашка под ним: при
 * переключении она переезжает к новому табу (transform + width), а не
 * перекрашивает кнопки. Положение меряем по DOM: смену таба ловит
 * MutationObserver на data-state, смену размеров (шрифт догрузился, ширина
 * диалога) — ResizeObserver. Первая отрисовка без анимации — плашка
 * появляется сразу на месте.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = React.useState<Indicator | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useIsomorphicLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const update = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      setIndicator(
        active
          ? {
              left: active.offsetLeft,
              top: active.offsetTop,
              width: active.offsetWidth,
              height: active.offsetHeight,
            }
          : null,
      );
    };
    update();

    const resize = new ResizeObserver(update);
    const observeTabs = () =>
      list.querySelectorAll('[role="tab"]').forEach((tab) => resize.observe(tab));
    resize.observe(list);
    observeTabs();

    const mutation = new MutationObserver(() => {
      observeTabs();
      update();
    });
    mutation.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={setRefs}
      className={cn(
        "relative inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    >
      {indicator && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 rounded-md bg-primary shadow-sm transition-[transform,width,height] duration-300 ease-out"
          style={{
            width: indicator.width,
            height: indicator.height,
            transform: `translate(${indicator.left}px, ${indicator.top}px)`,
          }}
        />
      )}
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // relative z-10 — текст поверх плашки; фона у триггера нет, его рисует TabsList.
      "relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background cursor-pointer transition-colors duration-300 data-[state=inactive]:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed data-[state=active]:text-primary-foreground",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
