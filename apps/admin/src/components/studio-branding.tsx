import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

import { setActiveStudioId, useActiveStudioId } from "@/hooks/use-active-studio";
import { useActiveStudio, useStudios } from "@/hooks/use-studios";
import { readableOn, textOnTint } from "@/lib/color-contrast";
import { kbBasesQuery } from "@/lib/kb/data";
import { kbBaseIdOf } from "@/lib/nav-sections";
import { rememberStudioFormat } from "@/lib/page-skeleton-layout";

/** Фон меню (`--sidebar` в styles.css). */
const SIDEBAR_HEX = "#1a2027";

/**
 * Живёт в layout админки, ничего не рисует:
 * - выбирает первую студию, если выбранной нет или к ней больше нет доступа;
 * - красит админку в цвет активной студии: --brand (иконка активного пункта
 *   меню, «сегодня» в расписании и прочие акценты) берётся из
 *   studios.brand_color. Без студии остаётся цвет по умолчанию из styles.css.
 *   Внутри базы знаний со своим цветом (kb_bases.brand_color, решение
 *   владельца 2026-10-25) — её цвет: всё, что красится цветом клуба
 *   (надзаголовки, точки и метки правок, оглавление), красится цветом базы.
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

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const kbBaseId = kbBaseIdOf(pathname);
  const { data: kbBases } = useQuery({ ...kbBasesQuery, enabled: !!kbBaseId });
  const kbColor = kbBaseId ? kbBases?.find((b) => b.id === kbBaseId)?.brand_color : null;
  const color = kbColor || active?.brand_color;
  // Цвет базы — как задан (решение владельца 2026-10-25): на белом не
  // темнеет; подстраивается только иконка на тёмном (меню, плашка вкладок).
  const exact = !!kbColor;
  useEffect(() => {
    if (!color) return;
    const root = document.documentElement;
    const vars = brandVars(color, exact);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [color, exact]);

  return null;
}

/**
 * Цвет клуба выбирает владелец, поэтому производные считаем от него: значок
 * активного пункта на тёмном меню (≥ 3:1), «сегодня» текстом на белом
 * (≥ 4.5:1) и текст на заливке цветом клуба — белый или тёмный, что
 * читается. Без этого тёмно-красный бренд терялся в меню, а белая цифра на
 * светлом бренде пропадала.
 */
function brandVars(color: string, exact = false): Record<string, string> {
  return {
    "--brand": color,
    "--brand-on-dark": readableOn(color, SIDEBAR_HEX),
    "--brand-on-light": exact ? color : readableOn(color, "#ffffff", 4.5),
    "--brand-foreground": textOnTint(color, 1) === "light" ? "#ffffff" : "var(--foreground)",
  };
}
