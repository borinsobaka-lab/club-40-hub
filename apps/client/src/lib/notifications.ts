import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/use-auth";
import { untypedDb } from "@/lib/untyped-db";
import type { ContentTranslations } from "@/i18n";

/**
 * Лента «Уведомления» (колокольчик на главной): пуш-уведомления из админки,
 * отправленные этому клиенту (решение владельца 2026-10-15). Приходят сюда и
 * тем, кто не включил пуши на телефоне. Прочитано — в базе (на всех
 * телефонах клиента): открыл уведомление здесь или нажал на пуш. RPC
 * my_push_inbox / push_mark_read — db/migrations/2026-10-15_push_delivery.sql.
 * Текст — на языке приложения: useLocalize() (title, message из translations).
 */
export type InboxNotification = {
  notification_id: string;
  title: string;
  message: string | null;
  /** Раздел приложения (/schedule) или внешняя ссылка — кнопка «Перейти». */
  action_url: string | null;
  translations: ContentTranslations | null;
  sent_at: string;
  read_at: string | null;
};

export const pushInboxQuery = (userId: string | null) =>
  queryOptions({
    queryKey: ["push-inbox", userId],
    queryFn: async (): Promise<InboxNotification[]> => {
      const { data, error } = await untypedDb.rpc("my_push_inbox", { p_limit: 100 });
      if (error) throw error;
      return (data as InboxNotification[] | null) ?? [];
    },
    enabled: !!userId,
  });

/**
 * Ссылка перехода из админки: внешняя (https://…) — как есть, раздел
 * приложения — путь от корня. Та же логика — у сервера рассылки
 * (apps/admin/src/lib/push/payload.ts) и в public/sw.js.
 */
export function actionTarget(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return "/" + value.replace(/^\/+/, "");
}

export function useNotifications() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const query = useQuery(pushInboxQuery(userId));
  const items = query.data ?? [];

  const markRead = (ids: string[] | null) => {
    const { queryKey } = pushInboxQuery(userId);
    const now = new Date().toISOString();
    queryClient.setQueryData(queryKey, (prev) =>
      prev?.map((n) =>
        !n.read_at && (ids === null || ids.includes(n.notification_id))
          ? { ...n, read_at: now }
          : n,
      ),
    );
    void untypedDb.rpc("push_mark_read", { p_ids: ids }).then(({ error }) => {
      if (error) void queryClient.invalidateQueries({ queryKey });
    });
  };

  return {
    items,
    loading: !!userId && query.isPending,
    error: !query.data && query.isError,
    unread: items.filter((n) => !n.read_at).length,
    markRead: (id: string) => markRead([id]),
    markAllRead: () => markRead(null),
  };
}
