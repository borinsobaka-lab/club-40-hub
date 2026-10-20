import { useEffect } from "react";

import { setActiveStudioId, useActiveStudioId } from "@/hooks/use-active-studio";
import { useActiveStudio, useStudios } from "@/hooks/use-studios";
import { rememberStudioFormat } from "@/lib/page-skeleton-layout";

/**
 * Живёт в layout админки, ничего не рисует:
 * - выбирает первую студию, если выбранной нет или к ней больше нет доступа;
 * - красит админку в цвет активной студии: --brand (иконка активного пункта
 *   меню, «сегодня» в расписании и прочие акценты) берётся из
 *   studios.brand_color. Без студии остаётся цвет по умолчанию из styles.css.
 * Фавикон с 2026-10-20 один на всю админку (__root.tsx), по формату клуба не
 * меняется.
 */
export function StudioBranding() {
  const { data: studios } = useStudios();
  const activeId = useActiveStudioId();
  const active = useActiveStudio();

  useEffect(() => {
    if (!studios?.length) return;
    if (!activeId || !studios.some((s) => s.id === activeId)) setActiveStudioId(studios[0].id);
  }, [studios, activeId]);

  // Формат клуба — для скелетонов страниц, чья раскладка от него зависит
  // («Продажи», «Тренировки», «Расписание»): при следующем открытии он нужен
  // раньше, чем придёт список клубов.
  const format = active?.format;
  useEffect(() => rememberStudioFormat(format), [format]);

  const color = active?.brand_color;
  useEffect(() => {
    if (!color) return;
    const root = document.documentElement;
    root.style.setProperty("--brand", color);
    return () => {
      root.style.removeProperty("--brand");
    };
  }, [color]);

  return null;
}
