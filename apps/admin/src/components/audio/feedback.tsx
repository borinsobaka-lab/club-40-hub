import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { plural } from "@/lib/academy/logic";
import { aaRpc, aaWrite, invalidateAudio } from "@/lib/audio/data";
import type { AaFeedback } from "@/lib/audio/types";
import { cn } from "@/lib/utils";

/**
 * «Согласен / не согласен» с оценкой метрики в разговоре. Голос — к
 * конкретной оценке: несогласия копятся в «Метриках и промптах» у промпта
 * этой метрики. Повторное нажатие выбранного — снять свой голос; комментарий
 * спрашивается только у несогласия.
 */
export function FeedbackControl({
  dialogId,
  metricId,
  items,
  myId,
}: {
  dialogId: string;
  metricId: string;
  /** Отзывы смены (все). */
  items: AaFeedback[];
  myId: string | null;
}) {
  const qc = useQueryClient();
  const target = items.filter((f) => f.dialog_id === dialogId && f.metric_id === metricId);
  const mine = target.find((f) => f.author_id && f.author_id === myId) ?? null;
  const others = target.filter((f) => f !== mine);
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [busy, setBusy] = useState(false);

  const vote = async (agree: boolean, text = "") => {
    if (busy) return;
    setBusy(true);
    try {
      if (mine && mine.agree === agree && text === (mine.comment ?? "")) {
        await aaWrite(supabase.from("aa_feedback").delete().eq("id", mine.id));
        setComment("");
      } else {
        await aaRpc("aa_feedback_set", {
          p_dialog_id: dialogId,
          p_metric_id: metricId,
          p_agree: agree,
          p_comment: agree ? "" : text,
        });
      }
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить отзыв");
    } finally {
      setBusy(false);
    }
  };

  const disagreeOthers = others.filter((f) => !f.agree).length;

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Оценка справедлива?</span>
        <Button
          size="xs"
          variant={mine?.agree === true ? "success" : "outline"}
          aria-pressed={mine?.agree === true}
          disabled={busy}
          title={mine?.agree === true ? "Снять свой голос" : undefined}
          onClick={() => void vote(true)}
        >
          <ThumbsUp />
          Согласен
        </Button>
        <Button
          size="xs"
          variant={mine?.agree === false ? "destructive" : "outline"}
          aria-pressed={mine?.agree === false}
          disabled={busy}
          title={mine?.agree === false ? "Снять свой голос" : undefined}
          onClick={() => void vote(false, mine?.agree === false ? (mine.comment ?? "") : comment)}
        >
          <ThumbsDown />
          Не согласен
        </Button>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {disagreeOthers > 0 && (
          <span className="text-xs text-rose-700">
            ещё {disagreeOthers}{" "}
            {plural(disagreeOthers, ["несогласие", "несогласия", "несогласий"])}
          </span>
        )}
      </div>
      {mine && !mine.agree && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void vote(false, comment.trim());
          }}
        >
          <Input
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Что именно не так? Увидит тот, кто правит промпт метрики"
          />
          {comment.trim() !== (mine.comment ?? "") && (
            <Button type="submit" variant="outline" disabled={busy}>
              Сохранить
            </Button>
          )}
        </form>
      )}
      {others.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {others.map((f) => (
            <li key={f.id}>
              <b className={cn("font-medium", f.agree ? "text-emerald-700" : "text-rose-700")}>
                {f.agree ? "согласен" : "не согласен"}
              </b>{" "}
              — {f.author_name || "сотрудник"}
              {f.comment && <span className="text-foreground">: {f.comment}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
