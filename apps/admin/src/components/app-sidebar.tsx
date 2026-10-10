import { useCallback, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronUp } from "lucide-react";
// Иконки пунктов меню — Solar: Outline, у активного пункта BoldDuotone
// (см. scripts/gen-nav-icons.ts); остальной интерфейс — Hugeicons через lucide-шим.
import {
  Bag3,
  BillList,
  CalendarMinimalistic,
  ChartSquare,
  ChatRoundDots,
  ClipboardRemove,
  Dumbbell,
  History,
  TagPrice,
  TicketSale,
  UsersGroupRounded,
  WalletMoney,
  Widget5,
  type NavIcon,
} from "@/components/nav-icons";

import { AppRail } from "@/components/app-rail";
import { MOBILE_APP_ITEMS, railSectionKey } from "@/lib/nav-sections";
import { SignOutButton } from "@/components/sign-out-button";
import { StudioSwitcher } from "@/components/studio-switcher";
import { useActiveStudio } from "@/hooks/use-studios";
import { useStorageUrl } from "@/lib/storage";
import type { StudioFormat } from "@/lib/studio-formats";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = {
  title: string;
  url: string;
  icon: NavIcon;
  /**
   * Только для студий этих форматов (STUDIO_FORMATS.md). Без поля — пункт
   * общий. Пока студия не загружена, показываются только общие пункты.
   */
  formats?: StudioFormat[];
};
type NavGroup = { key: string; label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    key: "workspace",
    label: "Главное",
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
      { title: "Отмены автопр.", url: "/autorenew-cancellations", icon: ClipboardRemove },
    ],
  },
  {
    key: "finance",
    label: "Финансы",
    items: [{ title: "Касса", url: "/cash", icon: WalletMoney }],
  },
  {
    key: "feedback",
    label: "Обратная связь",
    items: [
      { title: "Обратная связь", url: "/feedback", icon: ChatRoundDots },
      { title: "NPS-опросы", url: "/nps", icon: ChartSquare },
    ],
  },
];

/** Меню раздела «Мобильное приложение» (рейка) — вместо меню клуба. */
const APP_GROUPS: NavGroup[] = [
  // Название раздела — в шапке меню, группе хватит нейтральной подписи.
  { key: "mobile", label: "Разделы", items: MOBILE_APP_ITEMS },
];

/** Пункты для формата активной студии; опустевшие группы не показываем. */
function visibleGroups(format: StudioFormat | undefined) {
  return GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.formats || (!!format && i.formats.includes(format))),
  })).filter((g) => g.items.length > 0);
}

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

/**
 * Логотип активной студии (studios.logo_url). Меню тёмное — логотип нужен
 * светлый на прозрачном фоне. Без логотипа — название студии.
 */
function StudioLogo() {
  const studio = useActiveStudio();
  const src = useStorageUrl("studios", studio?.logo_url);
  if (!studio) return <span className="block h-9" />;
  if (src)
    return (
      <img
        src={src}
        alt={studio.name}
        className="h-auto max-h-12 w-36 object-contain object-left"
      />
    );
  return <span className="truncate text-lg font-semibold">{studio.name}</span>;
}

export function AppSidebar() {
  const studioFormat = useActiveStudio()?.format;
  const currentPath = useRouterState({ select: (router) => router.location.pathname });
  const isAppSection = railSectionKey(currentPath) === "app";
  const groups = isAppSection ? APP_GROUPS : visibleGroups(studioFormat);
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

  // Шторка на телефоне сама не закрывается по переходу: страница менялась
  // под ней, и после каждого пункта меню шторку приходилось смахивать руками.
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Точное совпадение или вложенный путь: голый startsWith подсвечивал
  // «Пуш-уведомления» (/push) ещё и на /push-triggers.
  const isActive = (path: string) => currentPath === path || currentPath.startsWith(`${path}/`);

  return (
    <Sidebar className="border-r-0">
      {/*
        Слева — рейка разделов (AppRail; там же «Сотрудники», «Мобильное
        приложение», «Доступы» и «Студии»), справа — меню клуба или меню
        раздела «Мобильное приложение».
        Ширина панели (--sidebar-width) уже включает рейку; в шторке на
        телефоне рейка тоже есть, переход по ней закрывает шторку.
      */}
      <div className="flex h-full min-h-0">
        <AppRail onNavigate={closeMobile} />
        <div className="flex min-w-0 flex-1 flex-col">
          <SidebarHeader className="px-3 py-4">
            <Link
              to="/"
              aria-label="На главную"
              className="flex items-center text-white"
              onClick={closeMobile}
            >
              {/* Приложение общее для студий — логотип студии там не к месту. */}
              {isAppSection ? (
                <span className="text-lg leading-tight font-semibold">Мобильное приложение</span>
              ) : (
                <StudioLogo />
              )}
            </Link>
          </SidebarHeader>

          {/*
            Блоки плотнее, чем в shadcn: там между последним пунктом блока и
            заголовком следующего набегало ~33px пустоты (gap-2 + p-2 снизу +
            p-2 сверху + высокая строка заголовка h-8). Теперь gap-1, py-1 и
            заголовок h-7 — в меню по высоте помещается больше пунктов.
          */}
          <SidebarContent className="sidebar-scroll gap-1">
            {groups.map((group) => (
              <Collapsible
                key={group.key}
                open={!closedGroups[group.key]}
                onOpenChange={(open) => setGroupOpen(group.key, open)}
              >
                <SidebarGroup className="py-1">
                  <SidebarGroupLabel asChild>
                    <CollapsibleTrigger className="group/label h-7 w-full cursor-pointer gap-2 text-[13px] text-white/50 hover:text-white/70">
                      <span className="shrink-0">{group.label}</span>
                      <span className="h-px flex-1 bg-white/15" />
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=closed]/label:rotate-180" />
                    </CollapsibleTrigger>
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {group.items.map((item) => (
                          <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive(item.url)}
                              /*
                            active: перекрывать обязательно — в базовых стилях shadcn нажатая
                            кнопка красится в `sidebar-accent`, а это почти белый: на тёмной
                            панели получалась вспышка под курсором на каждый клик.
                          */
                              className="group/nav font-medium text-white hover:bg-white/10 hover:text-white active:bg-white/10 active:text-white data-[active=true]:bg-white/10 data-[active=true]:font-semibold data-[active=true]:text-white"
                            >
                              <Link
                                to={item.url}
                                className="flex items-center gap-2"
                                onClick={closeMobile}
                              >
                                {/*
                              Свечение за иконкой — размытый круг цвета
                              currentColor. У обычного пункта белое и только
                              при наведении; у активного розовое, как и сама
                              иконка, горит всегда и ярче под курсором.
                            */}
                                <span
                                  className={cn(
                                    "relative isolate inline-flex shrink-0 before:absolute before:-inset-1 before:-z-10 before:rounded-full before:bg-current before:opacity-0 before:blur-[6px] before:transition-opacity before:duration-200",
                                    isActive(item.url)
                                      ? "text-brand before:opacity-45 group-hover/nav:before:opacity-70"
                                      : "text-white group-hover/nav:before:opacity-45",
                                  )}
                                >
                                  <item.icon active={isActive(item.url)} className="size-[18px]" />
                                </span>
                                <span>{item.title}</span>
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

          {/*
        До lg выбор студии и «Выйти» не помещаются в шапку страницы рядом с
        заголовком и действиями — они живут здесь, внизу меню (на телефоне —
        в шторке). На широком экране они в шапке, а этот блок скрыт.
      */}
          <SidebarFooter className="gap-2 border-t border-white/10 p-3 lg:hidden">
            <StudioSwitcher triggerClassName="w-full border-white/15 bg-white/5 text-white [&>svg]:text-white" />
            <SignOutButton className="w-full border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" />
          </SidebarFooter>
        </div>
      </div>
    </Sidebar>
  );
}
