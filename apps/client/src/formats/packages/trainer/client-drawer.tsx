import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DangerTriangle } from "@solar-icons/react";
import { toast } from "sonner";

import { BottomDrawer } from "@/components/bottom-drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { clientDisplayName, commentWhen, goalText } from "./format";
import {
  ACTIVITY_LABEL,
  EXPERIENCE_LABEL,
  HEALTH_LABEL,
  TIME_LABEL,
  healthRestrictions,
} from "./profile-labels";
import {
  addTrainerComment,
  trainerClientQuery,
  trainerCommentsQuery,
  type ClientProfile,
} from "./queries";

/**
 * Клиент, записанный на тренировку тренера (решение владельца 2026-11-05):
 * ограничения по здоровью — первыми и заметно, полная анкета и комментарии
 * тренеров (лента, новый комментарий). Вложенной шторкой поверх окна
 * тренировки. Данные — RPC trainer_client_profile / trainer_client_comments:
 * база отдаёт их только тренеру, на чью тренировку записан клиент.
 */
export function TrainerClientDrawer({
  clientId,
  onClose,
}: {
  clientId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const { data: card, isLoading, isError } = useQuery(trainerClientQuery(clientId));
  const name = card ? clientDisplayName(card) : "";

  return (
    <BottomDrawer
      nested
      open={!!clientId}
      onOpenChange={(o) => !o && onClose()}
      title={name || t("Клиент")}
    >
      {isLoading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-2xl bg-muted" />
          <div className="h-40 animate-pulse rounded-2xl bg-muted" />
        </div>
      ) : isError || !card ? (
        <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
          {t("Не удалось загрузить анкету клиента.")}
        </div>
      ) : (
        <div className="space-y-5">
          <ProfileView profile={card.profile} />
          {clientId && <CommentsSection clientId={clientId} />}
        </div>
      )}
    </BottomDrawer>
  );
}

function ProfileView({ profile }: { profile: ClientProfile | null }) {
  const t = useT();
  if (!profile) {
    return (
      <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
        {t("Клиент ещё не заполнил анкету в приложении.")}
      </div>
    );
  }
  const health = healthRestrictions(profile.health_flags, profile.health_notes);
  const rows: { label: string; value: string | null }[] = [
    { label: t("Главная цель"), value: goalText(profile.primary_goal, profile.goal_other, t) },
    { label: t("Мотивация"), value: profile.goal_motivation?.trim() || null },
    {
      label: t("Желаемая частота"),
      value:
        profile.desired_frequency != null
          ? profile.desired_frequency >= 4
            ? t("4 и больше раз в неделю")
            : t.plural(
                profile.desired_frequency,
                "{n} раз в неделю|{n} раза в неделю|{n} раз в неделю",
              )
          : null,
    },
    {
      label: t("Опыт тренировок"),
      value: profile.experience_level
        ? t(EXPERIENCE_LABEL[profile.experience_level] ?? profile.experience_level)
        : null,
    },
    {
      label: t("Текущая активность"),
      value:
        profile.current_weekly_activity != null
          ? t(
              ACTIVITY_LABEL[profile.current_weekly_activity] ??
                String(profile.current_weekly_activity),
            )
          : null,
    },
    {
      label: t("Удобное время"),
      value:
        (profile.preferred_times ?? [])
          .map((v) => (TIME_LABEL[v] ? t(TIME_LABEL[v]) : v))
          .join(", ") || null,
    },
    {
      label: t("Вес"),
      value: profile.weight_kg != null ? t("{n} кг", { n: String(profile.weight_kg) }) : null,
    },
    {
      label: t("Дата рождения"),
      value: profile.birth_date
        ? t.date(profile.birth_date, { day: "numeric", month: "long", year: "numeric" })
        : profile.birth_year
          ? String(profile.birth_year)
          : null,
    },
  ];

  return (
    <>
      {health.any ? (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
          <div className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-300">
            <DangerTriangle className="h-5 w-5" weight="Bold" />
            {t("Ограничения по здоровью")}
          </div>
          {health.flags.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {health.flags.map((f) => (
                <li key={f}>{HEALTH_LABEL[f] ? t(HEALTH_LABEL[f]) : f}</li>
              ))}
            </ul>
          )}
          {health.notes && <p className="mt-2 whitespace-pre-wrap">{health.notes}</p>}
        </div>
      ) : (
        <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
          {t("Ограничений по здоровью в анкете нет.")}
        </div>
      )}

      <section>
        <h3 className="mb-1 text-lg font-semibold">{t("Анкета")}</h3>
        <dl className="divide-y divide-border">
          {rows
            .filter((r) => r.value)
            .map((r) => (
              <div key={r.label} className="py-2.5">
                <dt className="text-xs text-muted-foreground">{r.label}</dt>
                <dd className="text-[15px]">{r.value}</dd>
              </div>
            ))}
        </dl>
      </section>
    </>
  );
}

function CommentsSection({ clientId }: { clientId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: comments = [], isLoading } = useQuery(trainerCommentsQuery(clientId));
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      await addTrainerComment(clientId, body);
      setText("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trainer-comments", clientId] }),
        // Сводка в списке записанных (число и последний).
        queryClient.invalidateQueries({ queryKey: ["trainer-entry-clients"] }),
      ]);
      toast.success(t("Комментарий сохранён"));
    } catch (e) {
      toast.error(t("Не удалось сохранить: {error}", { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{t("Комментарии тренеров")}</h3>
        {comments.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {t.plural(comments.length, "{n} комментарий|{n} комментария|{n} комментариев")}
          </span>
        )}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("Что важно знать другим тренерам о клиенте")}
        maxLength={4000}
        rows={3}
      />
      <Button className="mt-2 w-full" onClick={save} disabled={!text.trim() || saving}>
        {saving ? "..." : t("Добавить комментарий")}
      </Button>
      {isLoading ? (
        <div className="mt-3 h-16 animate-pulse rounded-2xl bg-muted" />
      ) : comments.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("Комментариев пока нет.")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-2xl bg-muted/70 p-3">
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {c.author_name ?? t("Тренер")}
                </span>{" "}
                · {commentWhen(c.created_at, t)}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[15px]">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
