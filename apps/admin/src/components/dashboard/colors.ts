import type { SaleOrigin } from "@/lib/dashboard-analytics";

/**
 * Цвета категорий — палитра «Контрастная» (решение владельца 2026-10-13), по
 * порядку, без повторов. Больше — сворачивать в «Остальное» (foldSlices),
 * ему — OTHER_COLOR; пустое кольцо (нет данных) — EMPTY_RING_COLOR.
 */
export const SERIES_COLORS = [
  "#EE5CF0", // розовый (основной)
  "#17B3A3", // бирюзовый
  "#FFBE3D", // янтарный
  "#6A5CF2", // фиолетовый
  "#FF7466", // коралловый
  "#3FA3EE", // голубой
  "#93CF55", // салатовый
  "#B07CF0", // сиреневый
  "#F48FC0", // светло-розовый
] as const;
/** Серо-синий — «Остальное», «Не указан». */
export const OTHER_COLOR = "#5C6878";
export const EMPTY_RING_COLOR = "#F1F2F4";

/**
 * Цвет закреплён за видом продажи на всех страницах дашборда: доли на
 * «Продажах» и линии «Продления и возвращения» на «Общих показателях».
 */
export const SALE_ORIGIN_COLOR: Record<SaleOrigin, string> = {
  new: SERIES_COLORS[0],
  renewal: SERIES_COLORS[1],
  return: SERIES_COLORS[2],
};
