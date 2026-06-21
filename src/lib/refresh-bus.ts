import { useEffect, useState } from "react";

const EVENT = "club40:refresh";

export function triggerRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Returns a number that increments each time triggerRefresh() is called. Use as a useEffect dep. */
export function useRefreshSignal(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = () => setN((x) => x + 1);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  return n;
}
