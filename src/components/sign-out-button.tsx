import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export function SignOutButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    // Кэш запросов — данные прошлого сотрудника; следующему он не нужен.
    queryClient.clear();
    toast.success("Вы вышли из аккаунта");
    navigate({ to: "/auth" });
  };

  return (
    <Button variant="outline" className={className} onClick={handleSignOut}>
      Выйти
    </Button>
  );
}
