import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AltArrowRight, ChatSquare, DangerTriangle } from "@solar-icons/react";

import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import { useT } from "@/i18n";
import { mediaUrl } from "@/lib/media";
import { trainerInitials } from "../entries";
import { TrainerClientDrawer } from "./client-drawer";
import { clientDisplayName, commentWhen, goalText } from "./format";
import { trainerEntryClientsQuery, type EntryClient } from "./queries";

/**
 * «Информация для тренера» в окне тренировки (решение владельца 2026-11-05):
 * кто записан — пробные первыми, у каждого главная цель, «Ограничения» (есть
 * что-то по здоровью в анкете) и комментарии тренеров (сколько, когда
 * последний, кто). По нажатию — анкета и комментарии клиента.
 */
export function TrainerEntryClients({ entryId }: { entryId: string }) {
  const t = useT();
  const { data, isLoading, isError } = useQuery(trainerEntryClientsQuery(entryId));
  const [openClient, setOpenClient] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
        {t("Не удалось загрузить список записанных.")}
      </div>
    );
  }

  const trials = data.filter((c) => c.is_trial).length;
  return (
    <>
      <div className="mb-2 text-sm text-muted-foreground">
        {data.length === 0
          ? t("На тренировку пока никто не записан.")
          : t.plural(
              data.length,
              "Записан {n} человек|Записано {n} человека|Записано {n} человек",
            ) +
            (trials > 0
              ? " · " + t.plural(trials, "{n} на пробном|{n} на пробном|{n} на пробном")
              : "")}
      </div>
      <ul className="space-y-2">
        {data.map((c) => (
          <li key={c.client_id}>
            <ClientRow client={c} onOpen={() => setOpenClient(c.client_id)} />
          </li>
        ))}
      </ul>
      <TrainerClientDrawer clientId={openClient} onClose={() => setOpenClient(null)} />
    </>
  );
}

function ClientRow({ client: c, onOpen }: { client: EntryClient; onOpen: () => void }) {
  const t = useT();
  const name = clientDisplayName(c);
  const photo = mediaUrl(c.photo_url, "avatars");
  const goal = goalText(c.primary_goal, c.goal_other, t);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition active:bg-muted"
    >
      <SquircleAvatar size={44}>
        {photo && <SquircleAvatarImage src={photo} alt={name} />}
        <SquircleAvatarFallback className="bg-muted text-sm font-semibold text-muted-foreground">
          {trainerInitials(name)}
        </SquircleAvatarFallback>
      </SquircleAvatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-semibold">{name}</span>
          {c.is_trial && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
              {t("Пробное")}
            </span>
          )}
          {c.has_restrictions && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 dark:bg-red-950/40 dark:text-red-300">
              <DangerTriangle className="h-3.5 w-3.5" weight="Bold" />
              {t("Ограничения")}
            </span>
          )}
        </div>
        {goal && (
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {t("Цель: {goal}", { goal })}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <ChatSquare className="h-3.5 w-3.5 shrink-0" />
          {c.comments_count > 0 && c.last_comment_at ? (
            <span className="truncate">
              {t.plural(c.comments_count, "{n} комментарий|{n} комментария|{n} комментариев")} ·{" "}
              {commentWhen(c.last_comment_at, t)}
              {c.last_comment_author ? ` · ${c.last_comment_author}` : ""}
            </span>
          ) : (
            <span>{t("+ Комментарий")}</span>
          )}
        </div>
      </div>
      <AltArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}
