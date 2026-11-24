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

/**
 * Мои ближайшие занятия: первые `limit` и есть ли ещё. С 2026-11-16 — все
 * виды, где стоит тренер: групповые, персональные, диагностики, прочая
 * активность (db/migrations/2026-11-16_zz_trainer_personal_entries.sql).
 * Сами занятия — RPC trainer_entries_view: персональные и прочие RLS клиента
 * не открывает. Пока RPC нет (клиент вышел раньше миграции) — как раньше,
 * обычным запросом (только групповые).
 */
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
      const rows = await fetchTrainerEntries(shown);
      const byId = new Map(rows.map((e) => [e.id, e]));
      const ordered = shown.map((id) => byId.get(id)).filter((e): e is PackEntry => !!e);
      return { entries: await attachSubstitutions(ordered), hasMore: list.length > limit };
    },
    enabled: !!trainerId,
    placeholderData: keepPreviousData,
  });
}

async function fetchTrainerEntries(ids: string[]): Promise<PackEntry[]> {
  const { data, error } = await untypedDb.rpc("trainer_entries_view", { p_ids: ids });
  if (!error) return (data as PackEntry[] | null) ?? [];
  const { data: rows, error: e2 } = await untypedDb
    .from("schedule_entries")
    .select(PACK_ENTRY_SELECT)
    .in("id", ids);
  if (e2) throw e2;
  return (rows as unknown as PackEntry[] | null) ?? [];
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

export type StudioAdminToday = {
  trainer_id: string;
  full_name: string | null;
  photo_url: string | null;
  telegram: string | null;
  translations?: ContentTranslations | null;
};

/**
 * Кто сегодня администратор в студии — из «Графика» админки (admin_shifts),
 * только тренеру (db/migrations/2026-11-15_zz_trainer_app_admin_on_shift.sql).
 * До миграции RPC нет — пусто, плашки нет.
 */
export function studioAdminsTodayQuery(studioId: string | null, enabled: boolean) {
  return queryOptions({
    queryKey: ["trainer-studio-admins-today", studioId],
    queryFn: async (): Promise<StudioAdminToday[]> => {
      const { data, error } = await untypedDb.rpc("trainer_studio_admins_today", {
        p_studio: studioId,
      });
      if (error) return [];
      return (data as StudioAdminToday[] | null) ?? [];
    },
    enabled: enabled && !!studioId,
    staleTime: 5 * 60_000,
  });
}

/** Проведённое занятие периода: сколько людей было и сколько за него начислено. */
export type PayoutLesson = {
  entry_id: string;
  starts_at: string;
  ends_at: string | null;
  kind: string;
  /** Название прочей активности. */
  title: string | null;
  studio_id: string;
  workout: {
    id: string;
    name: string;
    color: string | null;
    translations?: ContentTranslations | null;
  } | null;
  /** «Посетил». */
  people: number;
  /** Записи без отметки — администратор ещё не отметил посещение. */
  unmarked: number;
  amount: number;
};

export type PayoutAdjustment = {
  kind: "bonus" | "deduction";
  amount: number;
  reason: string;
  adjusted_on: string;
};

/** Начисление дня не за занятие: смена, бонус с продаж, абонементы после пробного. */
export type PayoutExtra = {
  date: string;
  kind: "shift" | "sale" | "trial_bonus";
  units: number;
  /** У продаж — поступившие за день платежи; у остальных — само начисление. */
  amount: number;
  /** Сколько начислено тренеру (у продаж — 5 % от amount). */
  bonus: number;
};

export type TrainerPayouts = {
  /** classic — выплаты 20-го и 1-го; progressive — 11-го и 26-го. */
  format: "classic" | "progressive";
  shift: number;
  /** Даты YYYY-MM-DD по Тбилиси. */
  period_from: string;
  period_to: string;
  pay_on: string;
  today: string;
  lessons: PayoutLesson[];
  lessons_count: number;
  lessons_total: number;
  shifts_total: number;
  sales_bonus: number;
  trial_bonus: number;
  trial_count: number;
  adjustments: PayoutAdjustment[];
  /** По дням: смены, бонусы с продаж, пробные (нет — база ещё без миграции). */
  extras: PayoutExtra[];
  adjustments_total: number;
  total: number;
  /** Занятий ещё впереди до конца периода. */
  upcoming_count: number;
  paid: { amount: number; paid_at: string } | null;
};

const num = (v: unknown) => Number(v) || 0;

/**
 * «Выплаты» тренера: период (shift 0 — текущий, −1 — прошлый…), проведённые
 * занятия и суммы — считает база той же функцией, что «Зарплаты» админки
 * (db/migrations/2026-11-24_zz_trainer_app_payouts.sql). Занятие проведено,
 * когда закончилось по времени.
 */
export function trainerPayoutsQuery(trainerId: string | null, shift: number) {
  return queryOptions({
    queryKey: ["trainer-payouts", trainerId, shift],
    queryFn: async (): Promise<TrainerPayouts | null> => {
      const { data, error } = await untypedDb.rpc("trainer_payouts", { p_shift: shift });
      if (error) throw error;
      const p = data as TrainerPayouts | null;
      if (!p) return null;
      // numeric из базы может прийти строкой.
      return {
        ...p,
        lessons: (p.lessons ?? []).map((l) => ({ ...l, amount: num(l.amount) })),
        adjustments: (p.adjustments ?? []).map((a) => ({ ...a, amount: num(a.amount) })),
        extras: (p.extras ?? []).map((x) => ({
          ...x,
          units: num(x.units),
          amount: num(x.amount),
          bonus: num(x.bonus),
        })),
        lessons_total: num(p.lessons_total),
        shifts_total: num(p.shifts_total),
        sales_bonus: num(p.sales_bonus),
        trial_bonus: num(p.trial_bonus),
        adjustments_total: num(p.adjustments_total),
        total: num(p.total),
        paid: p.paid ? { ...p.paid, amount: num(p.paid.amount) } : null,
      };
    },
    enabled: !!trainerId,
    placeholderData: keepPreviousData,
    // Занятие заканчивается — сумма меняется: не держим старое дольше минуты.
    staleTime: 60_000,
  });
}
