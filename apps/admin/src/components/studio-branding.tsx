import { useEffect } from "react";

import { setActiveStudioId, useActiveStudioId } from "@/hooks/use-active-studio";
import { useActiveStudio, useStudios } from "@/hooks/use-studios";
import { rememberStudioFormat } from "@/lib/page-skeleton-layout";

/**
 * Живёт в layout админки, ничего не рисует:
 * - выбирает первую студию, если выбранной нет или к ней больше нет доступа;
 * - красит админку в цвет активной студии: --brand (иконка активного пункта
 *   меню, «сегодня» в расписании и прочие акценты) берётся из
 *   studios.brand_color. Без студии остаётся цвет по умолчанию из styles.css;
 * - фавикон по формату клуба: пакетный — Lady Stretch, подписочный и без
 *   студии — Base40 из разметки (__root.tsx).
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

  useEffect(() => {
    if (format !== "packages") return;
    const links = [
      ...document.querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"], link[rel="apple-touch-icon"]',
      ),
    ];
    const original = links.map((link) => link.getAttribute("href"));
    for (const link of links) {
      link.href =
        link.sizes.value === "32x32" ? "/favicon-packages-32.png" : "/favicon-packages-180.png";
    }
    return () => {
      links.forEach((link, i) => {
        if (original[i]) link.setAttribute("href", original[i]);
      });
    };
  }, [format]);

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
