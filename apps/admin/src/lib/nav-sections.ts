/**
 * Разделы рейки (components/app-rail.tsx) и меню раздела «Мобильное
 * приложение» — отдельно от компонентов: их читают и рейка, и боковое меню.
 */
// Те же Solar-иконки, что у пунктов меню: Outline, у активного раздела BoldDuotone.
import {
  BellBing,
  Bolt,
  Buildings2,
  City,
  DocumentText,
  Notebook,
  Settings,
  ShieldUser,
  Smartphone,
  StarsMinimalistic,
  UserId,
  type NavIcon,
} from "@/components/nav-icons";

export type RailSectionKey = "club" | "staff" | "app" | "scripts" | "access" | "studios";

export type RailSection = {
  key: RailSectionKey;
  /**
   * Подпись в рейке. В строку помещается слово до ~7 букв; длинное
   * переносится по мягкому дефису (\u00AD) на вторую строку.
   */
  title: string;
  /** Полное название — подсказка при наведении и для скринридера. */
  fullTitle?: string;
  url?: string;
  icon: NavIcon;
  /** Страницы раздела, кроме самого url (у раздела со своим меню). */
  paths?: string[];
};

/**
 * Меню раздела «Мобильное приложение»: приложение общее для всех студий,
 * поэтому раздел — в рейке, а не в меню клуба. Боковое меню показывает эти
 * пункты вместо пунктов клуба.
 */
export const MOBILE_APP_ITEMS: { title: string; url: string; icon: NavIcon }[] = [
  { title: "Новости", url: "/news", icon: DocumentText },
  { title: "Услуги", url: "/services", icon: StarsMinimalistic },
  { title: "Пуш-уведомления", url: "/push", icon: BellBing },
  { title: "Триггеры", url: "/push-triggers", icon: Bolt },
  { title: "Настройки клуба", url: "/club-settings", icon: Settings },
];

/** Раздел без url — заготовка: виден в рейке, но не нажимается. */
export const SECTIONS: RailSection[] = [
  { key: "club", title: "Клуб", url: "/", icon: Buildings2 },
  // Сотрудники (тренеры и администраторы) общие для студий: у сотрудника
  // отмечены студии, где он работает.
  {
    key: "staff",
    title: "Сотруд\u00ADники",
    fullTitle: "Сотрудники",
    url: "/trainers",
    icon: UserId,
  },
  {
    key: "app",
    title: "Прило\u00ADжение",
    fullTitle: "Мобильное приложение",
    url: MOBILE_APP_ITEMS[0].url,
    icon: Smartphone,
    paths: MOBILE_APP_ITEMS.map((i) => i.url),
  },
  { key: "scripts", title: "Скрипты", icon: Notebook },
];

/**
 * Настройки над студиями — внизу рейки. Это одиночные страницы (как и
 * «Сотрудники»): своего меню у них нет, справа остаётся меню клуба без
 * подсвеченного пункта.
 */
export const ADMIN_SECTIONS: RailSection[] = [
  { key: "access", title: "Доступы", url: "/employees", icon: ShieldUser },
  { key: "studios", title: "Студии", url: "/studios", icon: City },
];

const matches = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

/** Раздел страницы: свои страницы у разделов рейки, всё остальное — «Клуб». */
export function railSectionKey(pathname: string): RailSectionKey {
  const own = [...SECTIONS, ...ADMIN_SECTIONS].find(
    (s) =>
      s.key !== "club" &&
      [s.url, ...(s.paths ?? [])].some((path) => path && matches(pathname, path)),
  );
  return own?.key ?? "club";
}
