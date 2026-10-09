import { useCallback, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Calendar,
  Users,
  Dumbbell,
  Flame,
  Tag,
  MessageSquare,
  BarChart3,
  UserCog,
  Wallet,
  Newspaper,
  Receipt,
  ShoppingBag,
  Sparkles,
  History,
  Ticket,
  Bell,
  Zap,
  Settings,
  RefreshCwOff,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

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

type NavItem = { title: string; url: string; icon: typeof LayoutDashboard };
type NavGroup = { key: string; label: string; items: NavItem[]; atBottom?: boolean };

const GROUPS: NavGroup[] = [
  {
    key: "workspace",
    label: "Рабочее пространство",
    items: [
      { title: "Дашборд", url: "/dashboard", icon: LayoutDashboard },
      { title: "Расписание", url: "/schedule", icon: Calendar },
      { title: "Клиенты", url: "/clients", icon: Users },
    ],
  },
  {
    key: "studio",
    label: "Студия",
    items: [
      { title: "Сотрудники", url: "/trainers", icon: Dumbbell },
      { title: "Тренировки", url: "/workouts", icon: Flame },
      { title: "Номенклатуры", url: "/memberships", icon: Tag },
      { title: "Промокоды", url: "/promocodes", icon: Ticket },
    ],
  },
  {
    key: "stats",
    label: "Статистика",
    items: [
      { title: "Продажи", url: "/sales", icon: Receipt },
      { title: "Прочие продажи", url: "/other-sales", icon: ShoppingBag },
      { title: "История записей", url: "/bookings-log", icon: History },
      { title: "Отмены автопродления", url: "/autorenew-cancellations", icon: RefreshCwOff },
    ],
  },
  {
    key: "finance",
    label: "Финансы",
    items: [{ title: "Касса", url: "/cash", icon: Wallet }],
  },
  {
    key: "mobile",
    label: "Мобильное приложение",
    items: [
      { title: "Новости", url: "/news", icon: Newspaper },
      { title: "Услуги", url: "/services", icon: Sparkles },
      { title: "Пуш-уведомления", url: "/push", icon: Bell },
      { title: "Триггерные пуши", url: "/push-triggers", icon: Zap },
      { title: "Настройки клуба", url: "/club-settings", icon: Settings },
    ],
  },
  {
    key: "feedback",
    label: "Обратная связь",
    items: [
      { title: "Обратная связь", url: "/feedback", icon: MessageSquare },
      { title: "NPS-опросы", url: "/nps", icon: BarChart3 },
    ],
  },
  {
    key: "access",
    label: "Доступы",
    items: [{ title: "Доступы", url: "/employees", icon: UserCog }],
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
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sidebar-icon font-bold text-sidebar-dark">
              40
            </div>
            {!collapsed && (
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-semibold tracking-wide text-white">
                  Base40
                </span>
                <span className="truncate text-xs text-white/60">Админ-панель</span>
              </div>
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
                          className="font-medium text-white hover:bg-white/10 hover:text-white active:bg-white/10 active:text-white data-[active=true]:bg-white/10 data-[active=true]:font-semibold data-[active=true]:text-white"
                        >
                          <Link to={item.url} className="flex items-center gap-2">
                            {/*
                              В свёрнутом меню иконка остаётся единственным
                              содержимым пункта — фирменный жёлтый контуром
                              читается тонко, поэтому там она белая.
                            */}
                            <item.icon
                              className={cn(
                                "h-4 w-4",
                                collapsed ? "text-white" : "text-sidebar-icon",
                              )}
                            />
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
