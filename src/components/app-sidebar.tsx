import { useCallback, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronUp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
// Иконки пунктов меню — Solar: Outline, у активного пункта BoldDuotone
// (см. scripts/gen-nav-icons.ts); остальной интерфейс — Hugeicons через lucide-шим.
import {
  Bag3,
  BellBing,
  BillList,
  Bolt,
  CalendarMinimalistic,
  ChartSquare,
  ChatRoundDots,
  ClipboardRemove,
  DocumentText,
  Dumbbell,
  History,
  Settings,
  ShieldUser,
  StarsMinimalistic,
  TagPrice,
  TicketSale,
  UserId,
  UsersGroupRounded,
  WalletMoney,
  Widget5,
  type NavIcon,
} from "@/components/nav-icons";

import { BrandLogo } from "@/components/brand-logo";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = { title: string; url: string; icon: NavIcon };
type NavGroup = { key: string; label: string; items: NavItem[]; atBottom?: boolean };

const GROUPS: NavGroup[] = [
  {
    key: "workspace",
    label: "Рабочее пространство",
    items: [
      { title: "Дашборд", url: "/dashboard", icon: Widget5 },
      { title: "Расписание", url: "/schedule", icon: CalendarMinimalistic },
      { title: "Клиенты", url: "/clients", icon: UsersGroupRounded },
    ],
  },
  {
    key: "studio",
    label: "Студия",
    items: [
      { title: "Сотрудники", url: "/trainers", icon: UserId },
      { title: "Тренировки", url: "/workouts", icon: Dumbbell },
      { title: "Номенклатуры", url: "/memberships", icon: TagPrice },
      { title: "Промокоды", url: "/promocodes", icon: TicketSale },
    ],
  },
  {
    key: "stats",
    label: "Статистика",
    items: [
      { title: "Продажи", url: "/sales", icon: BillList },
      { title: "Прочие продажи", url: "/other-sales", icon: Bag3 },
      { title: "История записей", url: "/bookings-log", icon: History },
      { title: "Отмены автопродления", url: "/autorenew-cancellations", icon: ClipboardRemove },
    ],
  },
  {
    key: "finance",
    label: "Финансы",
    items: [{ title: "Касса", url: "/cash", icon: WalletMoney }],
  },
  {
    key: "mobile",
    label: "Мобильное приложение",
    items: [
      { title: "Новости", url: "/news", icon: DocumentText },
      { title: "Услуги", url: "/services", icon: StarsMinimalistic },
      { title: "Пуш-уведомления", url: "/push", icon: BellBing },
      { title: "Триггерные пуши", url: "/push-triggers", icon: Bolt },
      { title: "Настройки клуба", url: "/club-settings", icon: Settings },
    ],
  },
  {
    key: "feedback",
    label: "Обратная связь",
    items: [
      { title: "Обратная связь", url: "/feedback", icon: ChatRoundDots },
      { title: "NPS-опросы", url: "/nps", icon: ChartSquare },
    ],
  },
  {
    key: "access",
    label: "Доступы",
    items: [{ title: "Доступы", url: "/employees", icon: ShieldUser }],
    atBottom: true,
  },
];

const STORAGE_KEY = "sidebar_groups";

/** Свёрнутые блоки переживают перезагрузку — иначе меню каждый раз раскрывается заново. */
function readCollapsedGroups(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function AppSidebar() {
  const { state, isMobile, toggleSidebar } = useSidebar();
  // На мобильном панель показывается шторкой во всю ширину: там «свёрнутый»
  // режим не применяется, хотя state может быть collapsed с прошлой сессии.
  const collapsed = state === "collapsed" && !isMobile;

  const [closedGroups, setClosedGroups] = useState(readCollapsedGroups);

  const setGroupOpen = useCallback((key: string, open: boolean) => {
    setClosedGroups((prev) => {
      const next = { ...prev, [key]: !open };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // приватный режим / переполненное хранилище — не повод ломать меню
      }
      return next;
    });
  }, []);

  const currentPath = useRouterState({ select: (router) => router.location.pathname });
  // Точное совпадение или вложенный путь: голый startsWith подсвечивал
  // «Пуш-уведомления» (/push) ещё и на /push-triggers.
  const isActive = (path: string) => currentPath === path || currentPath.startsWith(`${path}/`);

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            aria-label="На главную"
            className={cn("flex min-w-0 items-center text-white", collapsed && "mx-auto")}
          >
            {collapsed ? (
              <BrandLogo mark className="h-8 w-auto" />
            ) : (
              <BrandLogo className="h-auto w-36" />
            )}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Свернуть меню"
              title="Свернуть меню"
              className="ml-auto inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Развернуть меню"
            title="Развернуть меню"
            className="mt-2 inline-flex h-7 w-full cursor-pointer items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </SidebarHeader>

      <SidebarContent className="sidebar-scroll">
        {GROUPS.map((group, index) => (
          <Collapsible
            key={group.key}
            // В свёрнутом меню блоки держим открытыми принудительно: заголовков
            // не видно, свернуть блок было бы нечем, а иконки пропали бы.
            open={collapsed || !closedGroups[group.key]}
            onOpenChange={(open) => setGroupOpen(group.key, open)}
          >
            <SidebarGroup className={group.atBottom ? "mt-auto" : undefined}>
              {/*
                В свёрнутом меню заголовков нет, и блоки слипаются в одну ленту
                иконок. Оставляем от заголовка только линейку — она и делит.
                Перед первым блоком не нужна: он и так отделён шапкой.
              */}
              {collapsed && index > 0 && <div className="mx-2 mb-1 h-px bg-white/15" />}
              {!collapsed && (
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="group/label w-full cursor-pointer gap-2 text-[13px] text-white/50 hover:text-white/70">
                    <span className="shrink-0">{group.label}</span>
                    <span className="h-px flex-1 bg-white/15" />
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=closed]/label:rotate-180" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
              )}
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.url)}
                          // Подсказка показывается только в свёрнутом меню;
                          // задержка нулевая — задана в TooltipProvider.
                          tooltip={item.title}
                          /*
                            active: перекрывать обязательно — в базовых стилях shadcn нажатая
                            кнопка красится в `sidebar-accent`, а это почти белый: на тёмной
                            панели получалась вспышка под курсором на каждый клик.
                          */
                          className="group/nav font-medium text-white hover:bg-white/10 hover:text-white active:bg-white/10 active:text-white data-[active=true]:bg-white/10 data-[active=true]:font-semibold data-[active=true]:text-white"
                        >
                          <Link to={item.url} className="flex items-center gap-2">
                            {/*
                              Свечение за иконкой при наведении — размытый круг
                              цвета currentColor: у обычного пункта белый, у
                              активного фирменный розовый, как и сама иконка.
                              overflow-visible! — в свёрнутом меню иконка
                              остаётся последним span, и truncate из базовых
                              стилей пункта обрезал бы свечение. Иконка 18px с
                              -m-px занимает место прежних 16px: в свёрнутом
                              меню на неё ровно столько и отведено.
                            */}
                            <span
                              className={cn(
                                "relative isolate inline-flex shrink-0 overflow-visible! before:absolute before:-inset-1 before:-z-10 before:rounded-full before:bg-current before:opacity-0 before:blur-[6px] before:transition-opacity before:duration-200 group-hover/nav:before:opacity-45",
                                isActive(item.url) ? "text-brand" : "text-white",
                              )}
                            >
                              <item.icon
                                active={isActive(item.url)}
                                className="-m-px size-[18px]"
                              />
                            </span>
                            {!collapsed && <span>{item.title}</span>}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
