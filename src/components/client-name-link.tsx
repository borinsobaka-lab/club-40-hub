import { useState } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useActiveStudioId } from "@/components/studio-switcher";
import { ClientCardDialog } from "@/components/client-card-dialog";

type ClientLike = {
  id: string;
  user_id?: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  notes: string | null;
  registration_date: string | null;
  last_visit_date: string | null;
  crm_link: string | null;
  photo_url: string | null;
  avatar_url: string | null;
};

/**
 * Кликабельное имя клиента — при нажатии открывает модальное окно
 * с карточкой клиента (как в разделе «Клиенты»).
 *
 * Передайте `clientId` или `userId` (или сразу готового `client`).
 */
export function ClientNameLink({
  clientId,
  userId,
  client,
  children,
  className,
}: {
  clientId?: string | null;
  userId?: string | null;
  client?: ClientLike | null;
  children: React.ReactNode;
  className?: string;
}) {
  const studioId = useActiveStudioId();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<ClientLike | null>(client ?? null);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loaded) {
      setOpen(true);
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      let query = supabase.from("clients").select("*").limit(1);
      if (clientId) {
        query = query.eq("id", clientId);
      } else if (userId) {
        query = query.eq("user_id", userId);
        if (studioId) query = query.eq("studio_id", studioId);
      } else {
        toast.error("Карточка клиента недоступна");
        return;
      }
      const { data, error } = await query.maybeSingle();
      if (error) {
        toast.error("Не удалось загрузить клиента: " + error.message);
        return;
      }
      if (!data) {
        toast.error("Клиент не найден");
        return;
      }
      setLoaded(data as ClientLike);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={cn(
          "cursor-pointer text-left text-blue-600 underline-offset-2 hover:underline hover:text-blue-700 disabled:opacity-60 dark:text-blue-400 dark:hover:text-blue-300",
          className,
        )}
      >
        {children}
      </button>
      <ClientCardDialog open={open} onOpenChange={setOpen} client={loaded} />
    </>
  );
}
