import { useRef, useState, type ImgHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Картинка из сети, которая проявляется, когда загрузилась, а не возникает
 * рывком поверх подложки (плитки новостей и услуг). Уже лежащая в кэше
 * телефона показывается сразу, без проявления: `complete` проверяется при
 * появлении элемента.
 */
export function FadeImg({ className, onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  // Была ли картинка готова сразу — тогда без перехода.
  const instant = useRef(false);
  return (
    <img
      {...props}
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0 && !loaded) {
          instant.current = true;
          setLoaded(true);
        }
      }}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      className={cn(
        instant.current ? "" : "transition-opacity duration-300 motion-reduce:transition-none",
        loaded ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
