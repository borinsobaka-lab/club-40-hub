import type { ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Cat, RefreshCw } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SignOutButton } from "@/components/sign-out-button";
import { StudioSwitcher } from "@/components/studio-switcher";
import { Button } from "@/components/ui/button";
import { triggerRefresh } from "@/lib/refresh-bus";



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
  const router = useRouter();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-muted/30">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex flex-1 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
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
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Обновить"
                  onClick={() => router.invalidate()}
                >
                  <RefreshCw className="h-5 w-5" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {actions}
                <Link
                  to="/assistant"
                  className="ai-gradient group relative inline-flex h-9 items-center gap-2 overflow-hidden rounded-md px-3 text-sm font-medium text-white shadow-sm transition hover:shadow-md"
                >
                  <Cat className="h-4 w-4" />
                  <span>Kate</span>
                </Link>
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
