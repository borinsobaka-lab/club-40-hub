import { useQuery } from "@tanstack/react-query";

import { studioIdsKey } from "@/hooks/use-section-studios";
import type { Studio } from "@/hooks/use-studios";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";

/**
 * Комментарии клиентов о тренерах на модерации — «Обратная связь» →
 * «Комментарии о тренерах» (components/trainer-comments-moderation.tsx).
 * Схема — db/migrations/2026-11-14_client_trainer_comments.sql.
 */
export type TrainerComment = {
  id: string;
  trainer_id: string;
  studio_id: string | null;
  is_anonymous: boolean;
  author_name: string | null;
  author_public: string | null;
  message: string;
  status: "pending" | "approved" | "rejected";
  moderated_by_name: string | null;
  moderated_at: string | null;
  created_at: string;
  trainers: { full_name: string } | null;
};

/** Комментарии клубов раздела — общий запрос вкладки и счётчика на ней. */
export function useTrainerComments(studios: Studio[] | null) {
  const idsKey = studioIdsKey(studios);
  return useQuery({
    queryKey: ["client-trainer-comments", idsKey],
    queryFn: () => {
      let q = supabase.from("client_trainer_comments").select("*, trainers(full_name)");
      // Клубы раздела + без клуба (тренер без клубов на момент отправки) —
      // чтобы ни один комментарий не пропал из виду.
      if (idsKey) q = q.or(`studio_id.in.(${idsKey}),studio_id.is.null`);
      return unwrap<TrainerComment[]>(q.order("created_at", { ascending: false }));
    },
    enabled: studios !== null,
    meta: { errorMessage: "Не удалось загрузить комментарии о тренерах" },
  });
}
