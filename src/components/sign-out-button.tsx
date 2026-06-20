import { LogOut } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function SignOutButton() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Вы вышли из аккаунта");
    navigate({ to: "/auth" });
  };

  return (
    <Button size="sm" variant="outline" onClick={handleSignOut}>
      <LogOut className="mr-2 h-4 w-4" />
      Выйти
    </Button>
  );
}
