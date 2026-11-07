import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { InfoNote } from "@/components/ui/form-field";
import { CardSkeleton } from "@/components/skeletons";
import { commentWhenFull, commentsCountText } from "@/lib/client-comments";
import { unwrap } from "@/lib/query";

type TrainerComment = {
  id: string;
  body: string;
  author_name: string | null;
  created_at: string;
};

/**
 * «Комментарии тренеров» во вкладке «Анкета» карточки клиента (решение
 * владельца 2026-11-05): что тренеры написали о клиенте в мобильном
 * приложении (trainer_comments, db/migrations/2026-11-05_zz_trainer_app.sql).
 * Только чтение; в таблицах админки их нет.
 */
export function TrainerCommentsBlock({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["trainer_comments", clientId],
    queryFn: () =>
      unwrap<TrainerComment[]>(
        supabase
          .from("trainer_comments")
          .select("id, body, author_name, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
      ),
    meta: { errorMessage: "Не удалось загрузить комментарии тренеров" },
  });

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="text-xs font-medium uppercase text-muted-foreground">
          Комментарии тренеров
        </div>
        {data && data.length > 0 && (
          <div className="text-xs text-muted-foreground">{commentsCountText(data.length)}</div>
        )}
      </div>
      {isLoading ? (
        <CardSkeleton rows={2} />
      ) : !data || data.length === 0 ? (
        <InfoNote variant="empty">
          Тренеры пока ничего не написали. Комментарии оставляют тренеры в мобильном приложении — у
          клиентов, записанных на их тренировки.
        </InfoNote>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.map((c) => (
            <li key={c.id} className="px-3 py-2">
              <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
              <div className="mt-0.5 text-xs text-muted-foreground">
                <span className="font-medium">{c.author_name ?? "Тренер"}</span> ·{" "}
                {commentWhenFull(c.created_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
