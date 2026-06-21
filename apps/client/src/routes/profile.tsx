import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Профиль — CLUB 40" },
      { name: "description", content: "Профиль участника CLUB 40." },
    ],
  }),
  component: ProfilePage,
});

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function ProfilePage() {
  const { user, signOut } = useAuth();
  const fullName = (user?.user_metadata?.full_name as string) || "Участник";
  const email = user?.email ?? "";

  return (
    <div className="p-4 space-y-5">
      <Card className="p-5 flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
            {initials(fullName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-lg truncate">{fullName}</div>
          <div className="text-xs text-muted-foreground truncate">{email}</div>
        </div>
      </Card>

      <Button variant="outline" className="w-full" onClick={() => signOut()}>
        <LogOut className="h-4 w-4 mr-2" />
        Выйти
      </Button>
    </div>
  );
}
