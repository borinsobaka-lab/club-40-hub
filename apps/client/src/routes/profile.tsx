import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

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

type ClientRow = Record<string, unknown> & {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

function ProfilePage() {
  const { user, signOut } = useAuth();
  const [client, setClient] = useState<ClientRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("clients")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setClient((data as ClientRow) ?? null);
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel(`clients-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clients", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fullName =
    client?.full_name ||
    (user?.user_metadata?.full_name as string) ||
    "Участник";
  const email = client?.email || user?.email || "";
  const phone = client?.phone || "";

  return (
    <div className="p-4 space-y-5">
      <Card className="p-5 flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : initials(fullName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-lg truncate">{fullName}</div>
          <div className="text-xs text-muted-foreground truncate">{email}</div>
          {phone && <div className="text-xs text-muted-foreground truncate">{phone}</div>}
        </div>
      </Card>

      <Button variant="outline" className="w-full" onClick={() => signOut()}>
        <LogOut className="h-4 w-4 mr-2" />
        Выйти
      </Button>
    </div>
  );
}
