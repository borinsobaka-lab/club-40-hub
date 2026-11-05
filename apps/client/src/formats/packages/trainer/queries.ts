import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import type { ContentTranslations } from "@/i18n";
import { untypedDb } from "@/lib/untyped-db";
import { PACK_ENTRY_SELECT, attachSubstitutions, type PackEntry } from "../entries";

/**
 * Тренер в приложении (решение владельца 2026-11-05): пользователь, которому
 * в карточке клиента в админке указан тренер (app_trainer_links). Всё — RPC
 * базы, они сами проверяют, что вызывающий — тренер
 * (db/migrations/2026-11-05_zz_trainer_app.sql); у остальных пусто.
 */

export type TrainerMe = {
  trainer_id: string;
  full_name: string | null;
  photo_url: string | null;
  translations?: ContentTranslations | null;
};

/** Я тренер? null — обычный клиент (до миграции RPC нет — тоже null). */
export function trainerMeQuery(userId: string | null) {
  return queryOptions({
    queryKey: ["trainer-me", userId],
    queryFn: async (): Promise<TrainerMe | null> => {
      const { data, error } = await untypedDb.rpc("trainer_app_me");
      if (error) return null;
      return (data as TrainerMe | null) ?? null;
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}

/** Сколько занятий «Моего расписания» показывать сразу и добавлять по «Показать ещё». */
export const MY_SCHEDULE_STEP = 5;

/** Мои ближайшие тренировки: первые `limit` и есть ли ещё. */
export function trainerEntriesQuery(trainerId: string | null, limit: number) {
  return queryOptions({
    queryKey: ["trainer-entries", trainerId, limit],
    queryFn: async (): Promise<{ entries: PackEntry[]; hasMore: boolean }> => {
      const { data: ids, error } = await untypedDb.rpc("trainer_my_entries", {
        p_offset: 0,
        p_limit: limit + 1,
      });
      if (error) throw error;
      const list = ((ids as string[] | null) ?? []).map(String);
      const shown = list.slice(0, limit);
      if (shown.length === 0) return { entries: [], hasMore: false };
      const { data, error: e2 } = await untypedDb
        .from("schedule_entries")
        .select(PACK_ENTRY_SELECT)
        .in("id", shown);
      if (e2) throw e2;
      const byId = new Map(((data as unknown as PackEntry[] | null) ?? []).map((e) => [e.id, e]));
      const ordered = shown.map((id) => byId.get(id)).filter((e): e is PackEntry => !!e);
      return { entries: await attachSubstitutions(ordered), hasMore: list.length > limit };
    },
    enabled: !!trainerId,
    placeholderData: keepPreviousData,
  });
}

export type EntryClient = {
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  photo_url: string | null;
  status: string;
  is_trial: boolean;
  primary_goal: string | null;
  goal_other: string | null;
  has_restrictions: boolean;
  comments_count: number;
  last_comment_at: string | null;
  last_comment_author: string | null;
};

/** Кто записан на занятие тренера: пробные первыми. */
export function trainerEntryClientsQuery(entryId: string | null) {
  return queryOptions({
    queryKey: ["trainer-entry-clients", entryId],
    queryFn: async (): Promise<EntryClient[]> => {
      const { data, error } = await untypedDb.rpc("trainer_entry_clients", { p_entry: entryId });
      if (error) throw error;
      return (data as EntryClient[] | null) ?? [];
    },
    enabled: !!entryId,
  });
}

export type ClientProfile = {
  primary_goal: string | null;
  goal_other: string | null;
  goal_motivation: string | null;
  target_timeframe: string | null;
  desired_frequency: number | null;
  experience_level: string | null;
  current_weekly_activity: number | null;
  health_flags: string[] | null;
  health_notes: string | null;
  preferred_times: string[] | null;
  weight_kg: number | string | null;
  birth_date: string | null;
  birth_year: number | null;
  onboarding_completed_at: string | null;
};

export type TrainerClientCard = {
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  photo_url: string | null;
  profile: ClientProfile | null;
};

/** Анкета клиента — только записанного на тренировку этого тренера. */
export function trainerClientQuery(clientId: string | null) {
  return queryOptions({
    queryKey: ["trainer-client", clientId],
    queryFn: async (): Promise<TrainerClientCard | null> => {
      const { data, error } = await untypedDb.rpc("trainer_client_profile", {
        p_client: clientId,
      });
      if (error) throw error;
      return (data as TrainerClientCard | null) ?? null;
    },
    enabled: !!clientId,
  });
}

export type TrainerComment = {
  id: string;
  body: string;
  author_name: string | null;
  trainer_id: string | null;
  created_at: string;
  mine: boolean;
};

/** Комментарии тренеров о клиенте, свежие сверху. */
export function trainerCommentsQuery(clientId: string | null) {
  return queryOptions({
    queryKey: ["trainer-comments", clientId],
    queryFn: async (): Promise<TrainerComment[]> => {
      const { data, error } = await untypedDb.rpc("trainer_client_comments", {
        p_client: clientId,
      });
      if (error) throw error;
      return (data as TrainerComment[] | null) ?? [];
    },
    enabled: !!clientId,
  });
}

export async function addTrainerComment(clientId: string, body: string) {
  const { error } = await untypedDb.rpc("trainer_add_comment", {
    p_client: clientId,
    p_body: body,
  });
  if (error) throw error;
}
