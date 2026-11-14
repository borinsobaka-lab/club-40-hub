import { queryOptions } from "@tanstack/react-query";

import { untypedDb } from "@/lib/untyped-db";

/**
 * Данные комментариев клиентов о тренере (trainer-comments.tsx). Таблица —
 * client_trainer_comments, опубликованные — RPC
 * client_trainer_comments_published без автора-учётной записи
 * (db/migrations/2026-11-14_client_trainer_comments.sql). Имя, клуб и статус
 * ставит база: клиент присылает только тренера, текст и «Анонимно».
 */

/** Как client_trainer_comments_lengths_check в базе. */
export const TRAINER_COMMENT_MAX = 2000;

export type PublishedTrainerComment = {
  id: string;
  message: string;
  /** «Анна К.»; null — анонимно. */
  author: string | null;
  created_at: string;
};

export type MyTrainerComment = {
  id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export function publishedTrainerCommentsQuery(trainerId: string) {
  return queryOptions({
    queryKey: ["trainer-comments", trainerId],
    queryFn: async (): Promise<PublishedTrainerComment[]> => {
      const { data, error } = await untypedDb.rpc("client_trainer_comments_published", {
        _trainer_id: trainerId,
      });
      if (error) throw error;
      return (data ?? []) as PublishedTrainerComment[];
    },
  });
}

/** Последний свой комментарий о тренере — чтобы показать «на модерации». */
export function myTrainerCommentQuery(trainerId: string, userId: string | null) {
  return queryOptions({
    queryKey: ["trainer-comment-mine", trainerId, userId],
    queryFn: async (): Promise<MyTrainerComment | null> => {
      const { data, error } = await untypedDb
        .from("client_trainer_comments")
        .select("id, status, created_at")
        .eq("trainer_id", trainerId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as MyTrainerComment | null) ?? null;
    },
    enabled: !!userId,
  });
}

export async function sendTrainerComment(input: {
  trainerId: string;
  message: string;
  anonymous: boolean;
}) {
  const message = input.message.trim().slice(0, TRAINER_COMMENT_MAX);
  // Без .select(): прочитать вставленную строку можно, но не нужно — статус
  // перечитает myTrainerCommentQuery.
  const { error } = await untypedDb.from("client_trainer_comments").insert({
    trainer_id: input.trainerId,
    message,
    is_anonymous: input.anonymous,
  });
  if (error) throw error;
}

/** Предыдущий комментарий ещё на модерации — база не принимает второй. */
export function isPendingError(e: unknown): boolean {
  const msg = (e as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg.includes("client_trainer_comment_pending");
}
