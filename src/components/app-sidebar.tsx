import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Calendar, Users, Dumbbell, Flame, Tag, MessageSquare, BarChart3, UserCog, Wallet } from "lucide-react";

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

const workspaceItems = [
  { title: "Дашборд", url: "/dashboard", icon: LayoutDashboard },
  { title: "Расписание", url: "/schedule", icon: Calendar },
  { title: "Клиенты", url: "/clients", icon: Users },
];

const studioItems = [
  { title: "Сотрудники", url: "/trainers", icon: Dumbbell },
  { title: "Тренировки", url: "/workouts", icon: Flame },
  { title: "Номенклатуры", url: "/memberships", icon: Tag },
];

const feedbackItems = [
  { title: "Обратная связь", url: "/feedback", icon: MessageSquare },
  { title: "NPS-опросы", url: "/nps", icon: BarChart3 },
];

const financeItems = [
  { title: "Касса", url: "/cash", icon: Wallet },
];

const accessItems = [
  { title: "Доступы", url: "/employees", icon: UserCog },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({
    select: (router) => router.location.pathname,
  });

  const isActive = (path: string) =>
    path === "/" ? currentPath === "/" : currentPath.startsWith(path);

  const renderItems = (items: typeof workspaceItems) => (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton
            asChild
            isActive={isActive(item.url)}
            className="text-white hover:bg-white/10 hover:text-white data-[active=true]:bg-white/10 data-[active=true]:text-white"
          >
            <Link to={item.url} className="flex items-center gap-2">
              <item.icon className="h-4 w-4 text-sidebar-icon" />
              {!collapsed && <span>{item.title}</span>}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="px-3 py-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sidebar-icon font-bold text-sidebar-dark">
            40
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-wide text-white">CLUB 40</span>
              <span className="text-xs text-white/60">Админ-панель</span>
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-white/50">Рабочее пространство</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(workspaceItems)}</SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-white/50">Студия</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(studioItems)}</SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-white/50">Финансы</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(financeItems)}</SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-white/50">Обратная связь</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(feedbackItems)}</SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="text-white/50">Доступы</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(accessItems)}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
