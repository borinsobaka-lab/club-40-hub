import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useActiveStudioId } from "@/components/studio-switcher";
import { ClientCardDialog } from "@/components/client-card-dialog";
import { AmoCrmLinkIcon } from "@/components/amocrm-icon";

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

// Простой in-memory кэш crm_link, чтобы не дергать БД по разу на строку списка.
const crmCacheByClientId = new Map<string, string | null>();
const crmCacheByUserId = new Map<string, string | null>();
const crmInflight = new Map<string, Promise<string | null>>();

async function fetchCrmLink(opts: {
  clientId?: string | null;
  userId?: string | null;
  studioId?: string | null;
}): Promise<string | null> {
  const { clientId, userId, studioId } = opts;
  const key = clientId ? `c:${clientId}` : userId ? `u:${userId}:${studioId ?? ""}` : null;
  if (!key) return null;
  if (clientId && crmCacheByClientId.has(clientId)) return crmCacheByClientId.get(clientId) ?? null;
  if (userId && crmCacheByUserId.has(userId)) return crmCacheByUserId.get(userId) ?? null;
  const existing = crmInflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    let q = supabase.from("clients").select("id, user_id, crm_link").limit(1);
    if (clientId) q = q.eq("id", clientId);
    else if (userId) {
      q = q.eq("user_id", userId);
      if (studioId) q = q.eq("studio_id", studioId);
    }
    const { data } = await q.maybeSingle();
    const link = (data?.crm_link as string | null | undefined) ?? null;
    if (data?.id) crmCacheByClientId.set(data.id as string, link);
    if (data?.user_id) crmCacheByUserId.set(data.user_id as string, link);
    return link;
  })();
  crmInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    crmInflight.delete(key);
  }
}

/**
 * Кликабельное имя клиента — при нажатии открывает модальное окно
 * с карточкой клиента (как в разделе «Клиенты»).
 *
 * Если у клиента есть `crm_link`, справа от имени отображается иконка amoCRM,
 * по клику открывающая CRM-карточку клиента в новой вкладке.
 */
export function ClientNameLink({
  clientId,
  userId,
  client,
  crmLink,
  children,
  className,
}: {
  clientId?: string | null;
  userId?: string | null;
  client?: ClientLike | null;
  crmLink?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const studioId = useActiveStudioId();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<ClientLike | null>(client ?? null);
  const [loading, setLoading] = useState(false);
  const [resolvedCrm, setResolvedCrm] = useState<string | null>(
    crmLink ?? client?.crm_link ?? null,
  );

  useEffect(() => {
    if (crmLink !== undefined && crmLink !== null) {
      setResolvedCrm(crmLink);
      return;
    }
    if (client?.crm_link) {
      setResolvedCrm(client.crm_link);
      return;
    }
    let cancelled = false;
    fetchCrmLink({ clientId, userId, studioId }).then((link) => {
      if (!cancelled) setResolvedCrm(link ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, userId, studioId, crmLink, client?.crm_link]);

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
      const c = data as ClientLike;
      setLoaded(c);
      if (c.crm_link) {
        setResolvedCrm(c.crm_link);
        if (c.id) crmCacheByClientId.set(c.id, c.crm_link);
        if (c.user_id) crmCacheByUserId.set(c.user_id, c.crm_link);
      }
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <button
          type="button"
          onClick={handleClick}
          disabled={loading}
          className={cn(
            "cursor-pointer text-left whitespace-nowrap text-blue-600 underline-offset-2 hover:underline hover:text-blue-700 disabled:opacity-60 dark:text-blue-400 dark:hover:text-blue-300",
            className,
          )}
        >
          {children}
        </button>
        {resolvedCrm && <AmoCrmLinkIcon href={resolvedCrm} />}
      </span>
      <ClientCardDialog open={open} onOpenChange={setOpen} client={loaded} />
    </>
  );
}
