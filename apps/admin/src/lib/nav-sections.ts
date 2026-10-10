/**
 * Разделы рейки (components/app-rail.tsx), меню клуба и меню раздела
 * «Мобильное приложение» — отдельно от компонентов: их читают рейка, боковое
 * меню, guard роутов и форма «Доступов».
 */
// Те же Solar-иконки, что у пунктов меню: Outline, у активного раздела BoldDuotone.
import {
  Bag3,
  BellBing,
  BillList,
  Bolt,
  Buildings2,
  CalendarMinimalistic,
  ChartSquare,
  ChatRoundDots,
  City,
  ClipboardRemove,
  DocumentText,
  Dumbbell,
  History,
  MoneyBag,
  Notebook,
  Settings,
  ShieldUser,
  Smartphone,
  StarsMinimalistic,
  TagPrice,
  TicketSale,
  UserId,
  UsersGroupRounded,
  WalletMoney,
  Widget5,
  type NavIcon,
} from "@/components/nav-icons";
import {
  canOpenClubSection,
  canOpenRail,
  dashboardStudioIds,
  type AdminAccess,
  type ClubSectionKey,
} from "@/lib/admin-access";
import type { StudioFormat } from "@/lib/studio-formats";

export type RailSectionKey =
  | "dashboard"
  | "club"
  | "staff"
  | "app"
  | "scripts"
  | "access"
  | "studios";

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

export type NavItem = {
  title: string;
  url: string;
  icon: NavIcon;
  /**
   * Только для студий этих форматов (STUDIO_FORMATS.md). Без поля — пункт
   * общий. Пока студия не загружена, показываются только общие пункты.
   */
  formats?: StudioFormat[];
};
export type ClubNavItem = NavItem & {
  /** Ключ раздела в правах сотрудника («Доступы», lib/admin-access.ts). */
  section: ClubSectionKey;
  /** Полное название, если в меню сокращено (форма «Доступов»). */
  fullTitle?: string;
};
export type NavGroup<T extends NavItem = NavItem> = { key: string; label: string; items: T[] };

/**
 * Меню клуба (раздел рейки «Клуб»). Каждый пункт — раздел, который
 * открывается сотруднику отдельно в каждой студии («Доступы»).
 */
export const CLUB_GROUPS: NavGroup<ClubNavItem>[] = [
  {
    key: "workspace",
    label: "Главное",
    items: [
      { title: "Расписание", url: "/schedule", icon: CalendarMinimalistic, section: "schedule" },
      { title: "Клиенты", url: "/clients", icon: UsersGroupRounded, section: "clients" },
    ],
  },
  {
    key: "studio",
    label: "Студия",
    items: [
      { title: "Тренировки", url: "/workouts", icon: Dumbbell, section: "workouts" },
      // Один раздел прав «Номенклатуры», у каждого формата своя страница:
      // подписки с автопродлением / пакеты тренировок.
      {
        title: "Номенклатуры",
        url: "/memberships",
        icon: TagPrice,
        section: "memberships",
        formats: ["subscription"],
      },
      {
        title: "Номенклатуры",
        url: "/packages",
        icon: TagPrice,
        section: "memberships",
        formats: ["packages"],
      },
      { title: "Промокоды", url: "/promocodes", icon: TicketSale, section: "promocodes" },
    ],
  },
  {
    key: "stats",
    label: "Статистика",
    items: [
      { title: "Продажи", url: "/sales", icon: BillList, section: "sales" },
      { title: "Прочие продажи", url: "/other-sales", icon: Bag3, section: "other-sales" },
      { title: "История записей", url: "/bookings-log", icon: History, section: "bookings-log" },
      {
        title: "Отмены автопр.",
        fullTitle: "Отмены автопродления",
        url: "/autorenew-cancellations",
        icon: ClipboardRemove,
        section: "autorenew-cancellations",
        // У пакетов тренировок автопродления нет.
        formats: ["subscription"],
      },
    ],
  },
  {
    key: "finance",
    label: "Финансы",
    items: [{ title: "Касса", url: "/cash", icon: WalletMoney, section: "cash" }],
  },
  {
    key: "feedback",
    label: "Обратная связь",
    items: [
      { title: "Обратная связь", url: "/feedback", icon: ChatRoundDots, section: "feedback" },
      { title: "NPS-опросы", url: "/nps", icon: ChartSquare, section: "nps" },
    ],
  },
];

/**
 * Дашборд — раздел рейки над «Клубом»: на одной странице показатели всех
 * студий сотрудника по очереди. Право на него по-прежнему отмечается в
 * каждой студии (ключ dashboard в разделах клуба): студия попадает на
 * дашборд, только если он ей открыт.
 */
export const DASHBOARD_ITEM: ClubNavItem = {
  title: "Дашборд",
  url: "/dashboard",
  icon: Widget5,
  section: "dashboard",
};

/** Разделы студии в форме «Доступов»: дашборд и меню клуба. */
export const STUDIO_SECTION_GROUPS: NavGroup<ClubNavItem>[] = [
  { key: "dashboard", label: "Дашборд", items: [DASHBOARD_ITEM] },
  ...CLUB_GROUPS,
];

/**
 * Меню раздела «Мобильное приложение»: приложение общее для всех студий,
 * поэтому раздел — в рейке, а не в меню клуба. Боковое меню показывает эти
 * пункты вместо пунктов клуба.
 */
export const MOBILE_APP_ITEMS: NavItem[] = [
  { title: "Новости", url: "/news", icon: DocumentText },
  { title: "Услуги", url: "/services", icon: StarsMinimalistic },
  { title: "Пуш-уведомления", url: "/push", icon: BellBing },
  { title: "Триггеры", url: "/push-triggers", icon: Bolt },
  { title: "Настройки клуба", url: "/club-settings", icon: Settings },
];

/**
 * Меню раздела «Сотрудники»: справочник общий для всех студий, поэтому, как
 * и у «Мобильного приложения», своё меню вместо меню клуба.
 */
export const STAFF_ITEMS: NavItem[] = [
  { title: "Сотрудники", url: "/trainers", icon: UserId },
  { title: "Зарплатные ставки", url: "/pay-rates", icon: MoneyBag },
];

/** Раздел без url — заготовка: виден в рейке, но не нажимается. */
export const SECTIONS: RailSection[] = [
  // Над студиями: своего меню нет, справа остаётся меню клуба.
  { key: "dashboard", title: "Дашборд", url: DASHBOARD_ITEM.url, icon: Widget5 },
  // Вход в клуб — первая страница его меню; закрытую в активной студии
  // AccessGate сменит на первую доступную.
  { key: "club", title: "Клуб", url: CLUB_GROUPS[0].items[0].url, icon: Buildings2 },
  // Сотрудники (тренеры и администраторы) общие для студий: у сотрудника
  // отмечены студии, где он работает.
  {
    key: "staff",
    title: "Сотруд\u00ADники",
    fullTitle: "Сотрудники",
    url: STAFF_ITEMS[0].url,
    icon: UserId,
    paths: STAFF_ITEMS.map((i) => i.url),
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
 * Настройки над студиями — внизу рейки. Это одиночные страницы: своего
 * меню у них нет, справа остаётся меню клуба без подсвеченного пункта.
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

/** Пункт меню клуба, которому принадлежит страница (null — не пункт меню). */
export function clubNavItemOf(pathname: string): ClubNavItem | null {
  for (const group of CLUB_GROUPS) {
    const item = group.items.find((i) => matches(pathname, i.url));
    if (item) return item;
  }
  return null;
}

/**
 * Можно ли сотруднику открыть страницу. Это только интерфейс (меню и
 * guard в _authenticated/route.tsx): данные студии ограничивает RLS, разделы
 * рейки — ещё и has_admin_section в RLS.
 */
export function canOpenPath(
  access: AdminAccess,
  studioId: string | null,
  pathname: string,
): boolean {
  const section = railSectionKey(pathname);
  if (section === "access") return access.isOwner;
  // Дашборд над студиями: открыт, если открыт хоть в одной студии.
  if (section === "dashboard") return dashboardStudioIds(access).length > 0;
  if (section === "staff" || section === "app") return canOpenRail(access, section);
  if (section === "club") {
    const item = clubNavItemOf(pathname);
    return item ? canOpenClubSection(access, studioId, item.section) : canOpenRail(access, "club");
  }
  return true;
}

/** Первая страница, которую сотруднику можно открыть (null — ни одной). */
export function firstAllowedUrl(access: AdminAccess, studioId: string | null): string | null {
  // Сначала страницы клуба: «Клуб» в рейке ведёт на первую из них, и при
  // закрытой должен попасть на другую страницу клуба, а не на дашборд.
  const urls = [
    ...CLUB_GROUPS.flatMap((g) => g.items.map((i) => i.url)),
    ...[...SECTIONS, ...ADMIN_SECTIONS].flatMap((s) => (s.url && s.key !== "club" ? [s.url] : [])),
  ];
  return urls.find((url) => canOpenPath(access, studioId, url)) ?? null;
}
