import { useCallback, useSyncExternalStore } from "react";
import { endOfMonth, startOfMonth } from "date-fns";
import type { DateRange } from "react-day-picker";

/**
 * Период дашборда — свой у каждого клуба и общий для подразделов дашборда:
 * выбрали период в «Общих показателях» — в «Продажах» тот же. Живёт в памяти
 * вкладки (не в адресе: клубов на странице несколько), по умолчанию —
 * текущий месяц.
 */

const periods = new Map<string, DateRange | undefined>();
const listeners = new Set<() => void>();

export function currentMonth(): DateRange {
  const today = new Date();
  return { from: startOfMonth(today), to: endOfMonth(today) };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(studioId: string) {
  // Снимок должен быть стабильным между вызовами — умолчание кладём в Map.
  if (!periods.has(studioId)) periods.set(studioId, currentMonth());
  return periods.get(studioId);
}

// На сервере — одно и то же умолчание (стабильный объект на время рендера).
const serverDefault = currentMonth();

export function useDashboardPeriod(studioId: string) {
  const range = useSyncExternalStore(
    subscribe,
    () => read(studioId),
    () => serverDefault,
  );
  const setRange = useCallback(
    (next: DateRange | undefined) => {
      periods.set(studioId, next);
      listeners.forEach((l) => l());
    },
    [studioId],
  );
  return [range, setRange] as const;
}
