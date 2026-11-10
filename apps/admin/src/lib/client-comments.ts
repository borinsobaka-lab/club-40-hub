import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/format";
import { effectiveStatus, MEMBERSHIP_STATUS_LABEL } from "@/lib/membership-status";
import { unwrap } from "@/lib/query";

/**
 * Комментарии по клиенту и его абонементам — одной лентой (решение владельца
 * 2026-11-01; схема — db/migrations/2026-11-01_zzzzz_client_comments.sql).
 * Здесь — типы, запросы и подписи без React-разметки (подписи — с тестом).
 */

export type CommentKind = "note" | "sale" | "imported";

export type ClientComment = {
  id: string;
  client_id: string;
  sale_id: string | null;
  kind: CommentKind;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  edited_at: string | null;
};

/** Сводка у клиента (вместе с абонементами) — RPC client_comment_stats. */
export type CommentStats = {
  client_id: string;
  comments_count: number;
  last_at: string;
  last_kind: CommentKind;
  last_author: string | null;
  last_body: string;
  last_sale_id: string | null;
};

/** Абонемент клиента для подписи комментария и выбора «К чему». */
export type CommentSale = {
  id: string;
  sold_at: string;
  memberships: { name: string | null } | null;
  client_memberships:
    | {
        status: string | null;
        ends_at: string | null;
        started_at: string | null;
        starts_on_first_visit: boolean | null;
      }[]
    | null;
};

export const COMMENTS_KEY = "client_comments";

const COMMENT_COLUMNS =
  "id, client_id, sale_id, kind, body, author_id, author_name, created_at, edited_at";

/**
 * Сводки комментариев для списка клиентов — одним запросом на страницу
 * таблицы или список отчёта. Ключ — отсортированные id: та же страница из
 * разных мест берётся из кэша.
 */
export function useCommentStats(clientIds: (string | null | undefined)[]) {
  const ids = useMemo(
    () => [...new Set(clientIds.filter((x): x is string => !!x))].sort(),
    [clientIds],
  );
  const query = useQuery({
    queryKey: [COMMENTS_KEY, "stats", ids.join(",")],
    queryFn: () =>
      unwrap<CommentStats[]>(supabase.rpc("client_comment_stats", { p_client_ids: ids })),
    enabled: ids.length > 0,
    staleTime: 60_000,
    meta: { errorMessage: "Не удалось загрузить комментарии" },
  });
  const byClient = useMemo(() => {
    const map = new Map<string, CommentStats>();
    for (const s of query.data ?? []) map.set(s.client_id, s);
    return map;
  }, [query.data]);
  return { byClient, isLoading: query.isLoading && ids.length > 0, isError: query.isError };
}

/** Вся лента клиента: о нём и о всех его абонементах, свежие сверху. */
export function useClientComments(clientId: string, enabled = true) {
  return useQuery({
    queryKey: [COMMENTS_KEY, "client", clientId],
    queryFn: () =>
      unwrap<ClientComment[]>(
        supabase
          .from("client_comments")
          .select(COMMENT_COLUMNS)
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
      ),
    enabled,
    meta: { errorMessage: "Не удалось загрузить комментарии клиента" },
  });
}

/** Абонементы клиента (текущие и прошлые) — подписи комментариев. */
export function useCommentSales(clientId: string, enabled = true) {
  return useQuery({
    queryKey: [COMMENTS_KEY, "sales", clientId],
    queryFn: () =>
      unwrap<CommentSale[]>(
        supabase
          .from("sales")
          .select(
            "id, sold_at, memberships(name), client_memberships(status, ends_at, started_at, starts_on_first_visit)",
          )
          .eq("client_id", clientId)
          .order("sold_at", { ascending: false })
          .order("created_at", { ascending: false }),
      ),
    enabled,
    meta: { errorMessage: "Не удалось загрузить абонементы клиента" },
  });
}

// ---------------------------------------------------------------- подписи

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Когда оставлен комментарий — коротко, для «бумажки» в таблице: «сегодня
 * 14:05», «вчера 09:30», «12 окт», в прошлом году — «12.10.2025».
 * Перенесённый из прежних полей — «без даты»: их время — время создания
 * клиента или продажи, а не комментария.
 */
export function commentWhen(iso: string, kind?: CommentKind, now = new Date()): string {
  if (kind === "imported") return "без даты";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days <= 0) return `сегодня ${time}`;
  if (days === 1) return `вчера ${time}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return formatDate(iso);
}

/** Полная дата и время — в окне ленты. */
export function commentWhenFull(iso: string, kind?: CommentKind): string {
  if (kind === "imported") return "Перенесено из прежнего поля, без даты";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Сколько дней назад — для подсветки свежего комментария (0 — сегодня). */
export function commentAgeDays(iso: string, kind?: CommentKind, now = new Date()): number | null {
  if (kind === "imported") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((dayStart(now) - dayStart(d)) / 86_400_000));
}

/** Комментарий свежий — писали за последние 3 дня: «бумажка» ярче. */
export const FRESH_COMMENT_DAYS = 3;

/** «3 комментария». */
export function commentsCountText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "комментарий"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "комментария"
        : "комментариев";
  return `${n} ${word}`;
}

/** Автор строки ленты: перенесённый и записанный без сотрудника — без имени. */
export function commentAuthor(c: { author_name: string | null; kind: CommentKind }): string {
  if (c.author_name?.trim()) return c.author_name.trim();
  return c.kind === "imported" ? "Прежний комментарий" : "Без автора";
}

export type SaleState = "current" | "past";

/** Абонемент продажи сейчас действует (в том числе заморожен или ждёт)? */
export function saleState(sale: CommentSale, today?: string): SaleState {
  const cm = sale.client_memberships?.[0];
  if (!cm) return "past";
  const s = effectiveStatus(cm, today);
  return s === "active" || s === "awaiting" || s === "frozen" || s === "pending"
    ? "current"
    : "past";
}

/** «Пакет 8 от 12.10.2026». */
export function saleLabel(sale: Pick<CommentSale, "sold_at" | "memberships">): string {
  return `${sale.memberships?.name ?? "Абонемент"} от ${formatDate(sale.sold_at)}`;
}

/** Статус абонемента продажи словами: «Активен», «Истёк»… */
export function saleStatusText(sale: CommentSale, today?: string): string {
  const cm = sale.client_memberships?.[0];
  if (!cm) return "Без абонемента";
  const s = effectiveStatus(cm, today);
  return MEMBERSHIP_STATUS_LABEL[s] ?? s;
}

/**
 * Можно ли править и удалять: свой — да; без автора (перенесён из прежних
 * полей, записан сервером или переносом из 1С) — любой сотрудник, как
 * прежнее поле. То же проверяет RLS.
 */
export function canEditComment(c: Pick<ClientComment, "author_id">, me: string | null | undefined) {
  return c.author_id == null || (!!me && c.author_id === me);
}
