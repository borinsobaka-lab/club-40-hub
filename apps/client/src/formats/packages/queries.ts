import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ContentTranslations } from "@/i18n";
import { untypedDb } from "@/lib/untyped-db";
import { settlePackageMemberships } from "@/lib/packages-memberships";
import { PACK_ENTRY_SELECT, type PackEntry } from "./entries";

/**
 * Запросы экранов пакетного приложения — одни и те же для самих экранов и для
 * фоновой подгрузки (usePrefetchScreens в __root.tsx): пока клиент смотрит
 * главную, расписание, абонементы и «Студия» уже лежат в кэше, и переход на
 * них открывается сразу, без скелетона.
 */

/** Окно расписания: 3 дня назад … 7 дней вперёд от начала сегодняшнего дня. */
export const SCHEDULE_DAYS_BEFORE = 3;
export const SCHEDULE_DAYS = 10;

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function scheduleRange(today: Date) {
  return {
    from: addDays(today, -SCHEDULE_DAYS_BEFORE).toISOString(),
    to: addDays(today, SCHEDULE_DAYS - SCHEDULE_DAYS_BEFORE).toISOString(),
  };
}

/** Занятия смотримой студии в окне расписания. */
export function packScheduleQuery(studioId: string | null, today: Date, enabled = true) {
  const { from, to } = scheduleRange(today);
  return queryOptions({
    queryKey: ["pack-schedule", studioId, from],
    queryFn: async (): Promise<PackEntry[]> => {
      let query = supabase
        .from("schedule_entries")
        .select(PACK_ENTRY_SELECT)
        .gte("starts_at", from)
        .lt("starts_at", to)
        // Клиенту RLS отдаёт только групповые неотменённые; сотруднику в
        // приложении — все, поэтому фильтруем явно.
        .eq("kind", "group")
        .is("cancelled_at", null);
      if (studioId) query = query.eq("studio_id", studioId);
      const { data, error } = await query.order("starts_at");
      if (error) throw error;
      return (data as unknown as PackEntry[]) ?? [];
    },
    enabled,
  });
}

export type MyScheduleBookings = { booked: string[]; waitlist: string[] };

/** Свои записи в окне расписания (id занятий) — явный фильтр по user_id: RLS даёт тренеру все брони студии. */
export function packMyBookingsQuery(userId: string | null, today: Date) {
  const { from, to } = scheduleRange(today);
  return queryOptions({
    queryKey: ["pack-my-bookings", userId, from],
    queryFn: async (): Promise<MyScheduleBookings> => {
      const { data, error } = await untypedDb
        .from("schedule_bookings")
        .select("entry_id, status, schedule_entries!inner(starts_at)")
        .eq("user_id", userId)
        .in("status", ["booked", "waitlist"])
        .gte("schedule_entries.starts_at", from)
        .lt("schedule_entries.starts_at", to);
      if (error) throw error;
      const rows = (data as { entry_id: string; status: string }[] | null) ?? [];
      return {
        booked: rows.filter((r) => r.status === "booked").map((r) => r.entry_id),
        waitlist: rows.filter((r) => r.status === "waitlist").map((r) => r.entry_id),
      };
    },
    enabled: !!userId,
  });
}

// ---- Абонементы ----

export type MembershipKind = "package" | "trial" | "personal";

export type Pack = {
  id: string;
  name: string;
  description: string | null;
  kind: MembershipKind | null;
  visits_count: number | null;
  personal_count: number | null;
  duration_days: number | null;
  price: number;
  max_payments: number | null;
  /** Тег справа от названия и его вид (2026-10-12_zz_packages_app_fixes.sql). */
  tag_text?: string | null;
  tag_style?: "soft" | "bright" | null;
  /** Блок «В подарок» — текст с разметкой. */
  gift_text?: string | null;
  /** «Что входит» — пункты из админки («Номенклатуры»). */
  benefits?: string[] | null;
  /** Переводы названия, описания, тега, подарка и пунктов (src/i18n/content.ts). */
  translations?: ContentTranslations | null;
};

export type MyMembership = {
  id: string;
  status: string;
  ends_at: string | null;
  visits_left: number | null;
  personal_left: number | null;
  balance_kind: "group" | "personal" | null;
  memberships: { name: string; translations?: ContentTranslations | null } | null;
};

/** Сегодня по Тбилиси (ends_at — дата, как считает база). */
function tbilisiDateISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tbilisi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Номенклатура смотримой студии (витрина «Абонементов»). */
export function packCatalogQuery(studioId: string | null, enabled = true) {
  return queryOptions({
    queryKey: ["pack-memberships", studioId],
    queryFn: async (): Promise<Pack[]> => {
      let q = untypedDb
        .from("memberships")
        // «*», а не список колонок: тег и подарок (миграция 2026-10-12) приходят,
        // когда они есть в базе, и не ломают запрос до её выкатки.
        .select("*")
        .eq("is_active", true);
      if (studioId) q = q.eq("studio_id", studioId);
      const { data, error } = await q
        .order("sort_order", { ascending: true })
        .order("price", { ascending: true });
      if (error) throw error;
      return (data as Pack[] | null) ?? [];
    },
    enabled,
  });
}

/** Свои абонементы — по карточке клиента (своя студия), не по смотримой. */
export function packMyMembershipsQuery(userId: string | null) {
  return queryOptions({
    queryKey: ["pack-my-memberships", userId],
    queryFn: async (): Promise<MyMembership[]> => {
      await settlePackageMemberships();
      const { data: client, error: cErr } = await untypedDb
        .from("clients")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!client) return [];
      const { data, error } = await untypedDb
        .from("client_memberships")
        .select("id, status, ends_at, visits_left, personal_left, balance_kind, memberships(name, translations)")
        .eq("client_id", (client as { id: string }).id)
        .in("status", ["active", "frozen", "pending"])
        .or(`ends_at.is.null,ends_at.gte.${tbilisiDateISO()},status.eq.frozen`)
        .order("balance_kind", { ascending: true })
        .order("status", { ascending: true });
      if (error) throw error;
      return (data as unknown as MyMembership[] | null) ?? [];
    },
    enabled: !!userId,
  });
}

// ---- «Студия» ----

export type StudioInfo = {
  about: string | null;
  photo_path: string | null;
  google_maps_url: string | null;
  yandex_maps_url: string | null;
  instagram_url: string | null;
  whatsapp_url: string | null;
  messenger_url: string | null;
  /** Перевод «О студии» (src/i18n/content.ts). */
  translations?: ContentTranslations | null;
};

export type StudioTrainer = {
  id: string;
  full_name: string;
  photo_url: string | null;
  bio: string | null;
  role: string | null;
  rating_avg: number | null;
  rating_count: number;
  tip_url: string | null;
  /** Переводы имени и «О тренере» (src/i18n/content.ts). */
  translations?: ContentTranslations | null;
};

const TRAINER_CARD_COLUMNS =
  "id, full_name, photo_url, bio, role, rating_avg, rating_count, tip_url, translations";

/** numeric приходит строкой. */
function normalizeTrainer(t: StudioTrainer): StudioTrainer {
  return { ...t, rating_avg: t.rating_avg == null ? null : Number(t.rating_avg) };
}

/** Карточка одного тренера (шторка тренера из окна тренировки). */
export function trainerCardQuery(trainerId: string | null) {
  return queryOptions({
    queryKey: ["trainer-card", trainerId],
    queryFn: async (): Promise<StudioTrainer | null> => {
      const { data, error } = await untypedDb
        .from("trainers")
        .select(TRAINER_CARD_COLUMNS)
        .eq("id", trainerId)
        .maybeSingle();
      if (error) throw error;
      return data ? normalizeTrainer(data as StudioTrainer) : null;
    },
    enabled: !!trainerId,
  });
}

export function studioInfoQuery(studioId: string | null, enabled = true) {
  return queryOptions({
    queryKey: ["studio-info", studioId],
    queryFn: async (): Promise<StudioInfo | null> => {
      const { data, error } = await untypedDb
        .from("studio_app_settings")
        .select(
          "about, photo_path, google_maps_url, yandex_maps_url, instagram_url, whatsapp_url, messenger_url, translations",
        )
        .eq("studio_id", studioId)
        .maybeSingle();
      if (error) throw error;
      return (data as StudioInfo | null) ?? null;
    },
    enabled: enabled && !!studioId,
  });
}

export function studioTrainersQuery(studioId: string | null, enabled = true) {
  return queryOptions({
    queryKey: ["studio-trainers", studioId],
    queryFn: async (): Promise<StudioTrainer[]> => {
      const { data, error } = await untypedDb
        .from("trainer_studios")
        .select(`trainer:trainers(${TRAINER_CARD_COLUMNS})`)
        .eq("studio_id", studioId);
      if (error) throw error;
      return ((data as unknown as { trainer: StudioTrainer | null }[] | null) ?? [])
        .map((r) => r.trainer)
        .filter((t): t is StudioTrainer => !!t && t.role !== "admin")
        .map(normalizeTrainer)
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
    },
    enabled: enabled && !!studioId,
  });
}
