import { Link, useRouterState } from "@tanstack/react-router";
import { Dumbbell, Flame, Calendar, Users, UserCog } from "lucide-react";

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

const items = [
  { title: "Тренеры", url: "/trainers", icon: Dumbbell },
  { title: "Тренировки", url: "/workouts", icon: Flame },
  { title: "Расписание", url: "/schedule", icon: Calendar },
  { title: "Клиенты", url: "/clients", icon: Users },
  { title: "Сотрудники", url: "/employees", icon: UserCog },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({
    select: (router) => router.location.pathname,
  });

  const isActive = (path: string) =>
    path === "/" ? currentPath === "/" : currentPath.startsWith(path);

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
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} className="text-white hover:bg-white/10 hover:text-white data-[active=true]:bg-white/10 data-[active=true]:text-white">
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4 text-sidebar-icon" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
