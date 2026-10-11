import { useCallback, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronUp } from "lucide-react";
import { Notebook, Settings } from "@/components/nav-icons";
import { AppRail } from "@/components/app-rail";
import {
  CLUB_GROUPS,
  MOBILE_APP_ITEMS,
  SCRIPTS_SETTINGS_URL,
  SCRIPTS_URL,
  STAFF_ITEMS,
  railSectionKey,
  type NavGroup,
  type RailSectionKey,
} from "@/lib/nav-sections";
import { usePlaybook, useScriptAccess, useUnreadSuggestions } from "@/lib/scripts/data";
import { sectionIcon } from "@/lib/scripts/icons";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { canOpenClubSection, type AdminAccess } from "@/lib/admin-access";
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

/**
 * Разделы рейки со своим меню вместо меню клуба: оно общее для всех студий,
 * поэтому в шапке меню — название раздела, а не логотип студии. Название
 * раздела — в шапке, группе хватит нейтральной подписи.
 */
const SECTION_MENUS: Partial<Record<RailSectionKey, { title: string; groups: NavGroup[] }>> = {
  staff: {
    title: "Сотрудники",
    groups: [{ key: "staff", label: "Разделы", items: STAFF_ITEMS }],
  },
  app: {
    title: "Мобильное приложение",
    groups: [{ key: "mobile", label: "Разделы", items: MOBILE_APP_ITEMS }],
  },
};

/**
 * Пункты клуба для формата активной студии и прав сотрудника («Доступы»);
 * опустевшие группы не показываем. Пока права грузятся — меню пустое, чтобы
 * закрытые пункты не мелькали.
 */
function visibleGroups(
  format: StudioFormat | undefined,
  access: AdminAccess | null,
  studioId: string | null,
): NavGroup[] {
  if (!access) return [];
  return CLUB_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        (!i.formats || (!!format && i.formats.includes(format))) &&
        canOpenClubSection(access, studioId, i.section),
    ),
  })).filter((g) => g.items.length > 0);
}

/**
 * Меню «Скриптов LS»: разделы скриптов живут в базе (их заводят и
 * переставляют в самом разделе), поэтому меню собирается из них. У
 * «Настроек» — счётчик новых предложений, у каждого сотрудника свой.
 */
function useScriptsMenu(enabled: boolean): NavGroup[] {
  const access = useScriptAccess();
  const { data: sections = [] } = usePlaybook(enabled && !!access?.canRead);
  const { data: unread = 0 } = useUnreadSuggestions(enabled && !!access?.canEdit);
  if (!enabled) return [];
  return [
    {
      key: "scripts",
      label: "Разделы",
      items: [
        { title: "Все скрипты", url: SCRIPTS_URL, icon: Notebook, exact: true },
        ...sections.map((s) => ({
          title: s.title,
          url: `${SCRIPTS_URL}/${s.id}`,
          icon: sectionIcon(s.icon),
        })),
      ],
    },
    {
      key: "scripts-settings",
      label: "Управление",
      items: [{ title: "Настройки", url: SCRIPTS_SETTINGS_URL, icon: Settings, badge: unread }],
    },
  ];
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
  const studioId = useActiveStudioId();
  const access = useAdminAccess();
  const currentPath = useRouterState({ select: (router) => router.location.pathname });
  const railKey = railSectionKey(currentPath);
  const scriptsGroups = useScriptsMenu(railKey === "scripts");
  const sectionMenu =
    railKey === "scripts" ? { title: "Скрипты LS", groups: scriptsGroups } : SECTION_MENUS[railKey];
  const groups = sectionMenu?.groups ?? visibleGroups(studioFormat, access, studioId);
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
  const isActive = (path: string, exact = false) =>
    currentPath === path || (!exact && currentPath.startsWith(`${path}/`));

  return (
    /*
      Граница справа у shadcn задана с префиксом (group-data-[side=left]:border-r),
      голый border-r-0 её не перекрывал — между меню и рабочей областью
      оставалась светлая полоса, тёмный каркас разрывался.
    */
    <Sidebar className="border-r-0 group-data-[side=left]:border-r-0">
      {/*
        Слева — рейка разделов (AppRail; там же «Сотрудники», «Мобильное
        приложение», «Доступы» и «Студии»), справа — меню клуба или меню
        раздела («Сотрудники», «Мобильное приложение»).
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
              {/* Раздел общий для студий — логотип студии там не к месту. */}
              {sectionMenu ? (
                <span className="text-lg leading-tight font-semibold">{sectionMenu.title}</span>
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
                          <SidebarMenuItem key={item.url}>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive(item.url, item.exact)}
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
                                    isActive(item.url, item.exact)
                                      ? "text-brand before:opacity-45 group-hover/nav:before:opacity-70"
                                      : "text-white group-hover/nav:before:opacity-45",
                                  )}
                                >
                                  <item.icon
                                    active={isActive(item.url, item.exact)}
                                    className="size-[18px]"
                                  />
                                </span>
                                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                                {!!item.badge && (
                                  <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-white tabular-nums">
                                    {item.badge}
                                  </span>
                                )}
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
