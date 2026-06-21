import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bell, CreditCard, LogOut, Settings, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Профиль — CLUB 40" },
      { name: "description", content: "Профиль участника CLUB 40, абонемент и настройки." },
    ],
  }),
  component: ProfilePage,
});

const menu = [
  { icon: CreditCard, label: "Абонемент" },
  { icon: Bell, label: "Уведомления" },
  { icon: Settings, label: "Настройки" },
];

function ProfilePage() {
  return (
    <div className="p-4 space-y-5">
      <Card className="p-5 flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">АК</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-lg truncate">Александр Клиент</div>
          <div className="text-xs text-muted-foreground">+7 999 123-45-67</div>
        </div>
      </Card>

      <Card className="p-4 space-y-2 bg-primary text-primary-foreground">
        <div className="text-xs uppercase opacity-80">Активный абонемент</div>
        <div className="font-semibold">Безлимит · 30 дней</div>
        <div className="flex justify-between text-sm opacity-90">
          <span>До 14 февраля</span>
          <span>осталось 24 дня</span>
        </div>
      </Card>

      <Card className="divide-y divide-border">
        {menu.map(({ icon: Icon, label }) => (
          <button
            key={label}
            className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent transition-colors"
          >
            <Icon className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1">{label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </Card>

      <Button variant="outline" className="w-full">
        <LogOut className="h-4 w-4 mr-2" />
        Выйти
      </Button>
    </div>
  );
}
