import type { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SignOutButton } from "@/components/sign-out-button";
import { StudioSwitcher } from "@/components/studio-switcher";

export function AdminShell({
  title,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-muted/30">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex flex-1 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-4">
                <h1
                  className="truncate text-2xl uppercase leading-none pt-1"
                  style={{
                    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                    fontWeight: 900,
                    fontStyle: "italic",
                  }}
                >
                  {title}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                {actions}
                <StudioSwitcher />
                <SignOutButton />
              </div>
            </div>
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
