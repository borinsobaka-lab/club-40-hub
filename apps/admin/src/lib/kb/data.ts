/**
 * База знаний — загрузка (React Query + Supabase). Схема и права —
 * db/migrations/2026-10-24_knowledge_base.sql: RLS отдаёт только доступные
 * базы, а читателю — только опубликованное.
 *
 * Дерево базы (папки и статьи без текста) грузится целиком одним queryKey —
 * его читают и боковое меню, и страницы (крошки, содержимое папки); текст
 * статьи — отдельным запросом при открытии.
 */
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import type { KbGrant } from "./access";
import type { KbBase, KbDraft, KbNodeFull, KbTreeNode } from "./types";

export const KB_BASES_KEY = "kb_bases";
export const KB_GRANTS_KEY = "kb_grants";
export const KB_NODES_KEY = "kb_nodes";
export const KB_NODE_KEY = "kb_node";
export const KB_DRAFTS_KEY = "kb_drafts";

const TREE_COLUMNS =
  "id, base_id, parent_id, kind, title, description, sort_order, status, reader_visible, created_at, updated_at, published_at, published_by";

/** Доступные базы — для рейки и прав; заранее грузит проверка входа. */
export const kbBasesQuery = queryOptions({
  queryKey: [KB_BASES_KEY],
  queryFn: () =>
    unwrap<KbBase[]>(
      supabase
        .from("kb_bases")
        .select("id, title, rail_title, icon, description, sort_order, show_in_rail")
        .order("sort_order")
        .order("created_at"),
    ),
  staleTime: 5 * 60_000,
  meta: { errorMessage: "Не удалось загрузить базы знаний" },
});

/** Свои доступы к базам (RLS отдаёт свои строки; владельцу они не нужны). */
export const kbOwnGrantsQuery = queryOptions({
  queryKey: [KB_GRANTS_KEY, "own"],
  queryFn: async (): Promise<KbGrant[]> => {
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId) return [];
    return unwrap<KbGrant[]>(
      supabase
        .from("kb_grants")
        .select("base_id, level")
        .eq("subject_type", "user")
        .eq("subject_id", userId)
        .is("node_id", null),
    );
  },
  // Доступы меняет владелец в «Доступах»; свои он менять не может.
  staleTime: Infinity,
  meta: { errorMessage: "Не удалось загрузить доступы к базам знаний" },
});

export function kbTreeQuery(baseId: string) {
  return queryOptions({
    queryKey: [KB_NODES_KEY, baseId],
    queryFn: () =>
      unwrap<KbTreeNode[]>(
        supabase
          .from("kb_nodes")
          .select(TREE_COLUMNS)
          .eq("base_id", baseId)
          .order("sort_order")
          .order("created_at"),
      ),
    meta: { errorMessage: "Не удалось загрузить содержание базы знаний" },
  });
}

export function useKbTree(baseId: string | null) {
  return useQuery({ ...kbTreeQuery(baseId ?? ""), enabled: !!baseId });
}

export function useKbNode(nodeId: string | null) {
  return useQuery({
    queryKey: [KB_NODE_KEY, nodeId],
    queryFn: async () => {
      const rows = await unwrap<KbNodeFull[]>(
        supabase.from("kb_nodes").select(`${TREE_COLUMNS}, content`).eq("id", nodeId!),
      );
      return rows[0] ?? null;
    },
    enabled: !!nodeId,
    meta: { errorMessage: "Не удалось загрузить статью" },
  });
}

/** Черновики правок базы (только редактору): метка в дереве и в статье. */
export function useKbDrafts(baseId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [KB_DRAFTS_KEY, baseId],
    queryFn: () =>
      unwrap<Omit<KbDraft, "content">[]>(
        supabase.from("kb_drafts").select("node_id, updated_by, updated_at").eq("base_id", baseId!),
      ),
    enabled: !!baseId && enabled,
    meta: { errorMessage: "Не удалось загрузить черновики" },
  });
}

/** Черновик статьи для редактора (null — правок нет). */
export async function loadKbDraft(nodeId: string): Promise<KbDraft | null> {
  const rows = await unwrap<KbDraft[]>(
    supabase
      .from("kb_drafts")
      .select("node_id, content, updated_by, updated_at")
      .eq("node_id", nodeId),
  );
  return rows[0] ?? null;
}

/** После правки дерева, статьи или черновика — меню и страницы не расходятся. */
export function invalidateKb(queryClient: QueryClient, baseId?: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: baseId ? [KB_NODES_KEY, baseId] : [KB_NODES_KEY] }),
    queryClient.invalidateQueries({ queryKey: [KB_NODE_KEY] }),
    // Черновики — и списком базы, и у открытой статьи (["kb_drafts", "node", id]).
    queryClient.invalidateQueries({ queryKey: [KB_DRAFTS_KEY] }),
  ]);
}

/** Ошибки RPC и триггеров базы знаний — по-русски для тоста. */
export function kbErrorText(error: unknown, fallback = "Не удалось сохранить"): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("kb_draft_conflict"))
    return "Статью только что сохранил другой редактор. Обновите страницу, чтобы не затереть его правки.";
  if (message.includes("kb_move_into_self")) return "Папку нельзя перенести внутрь неё самой";
  if (message.includes("kb_parent_not_folder")) return "Переносить можно только в папку";
  if (message.includes("kb_forbidden") || message.includes("row-level security"))
    return "Нет права на правку этой базы знаний";
  if (message.includes("foreign key") || message.includes("kb_nodes_parent_id_fkey"))
    return "В папке есть статьи — сначала перенесите или удалите их";
  return message || fallback;
}

export type KbSearchHit = {
  id: string;
  parent_id: string | null;
  kind: "folder" | "article";
  title: string;
  status: string;
  /** Фрагмент текста: найденное — между ⟦ и ⟧. */
  snippet: string;
  rank: number;
};

/** Поиск по базе (RPC kb_search): русская морфология, начало слова, папка. */
export function useKbSearch(baseId: string, query: string, folderId: string | null) {
  const q = query.trim();
  return useQuery({
    queryKey: ["kb_search", baseId, folderId, q],
    queryFn: () =>
      unwrap<KbSearchHit[]>(
        supabase.rpc("kb_search", {
          p_query: q,
          p_base: baseId,
          p_folder: folderId,
          p_limit: 30,
        }),
      ),
    enabled: q.length >= 2,
    staleTime: 30_000,
    meta: { errorMessage: "Не удалось выполнить поиск" },
  });
}

/** Фрагмент поиска — на куски: { text, hit } (найденное подсвечивается). */
export function snippetParts(snippet: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  const re = /⟦([^⟧]*)⟧/g;
  let last = 0;
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), hit: false });
    parts.push({ text: m[1], hit: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false });
  return parts;
}

/** Имена авторов и редакторов базы (RPC kb_authors): id → «Фамилия Имя». */
export function useKbAuthors(baseId: string | null) {
  return useQuery({
    queryKey: ["kb_authors", baseId],
    queryFn: async () => {
      const rows = await unwrap<{ user_id: string; full_name: string | null }[]>(
        supabase.rpc("kb_authors", { p_base: baseId }),
      );
      return new Map(rows.map((r) => [r.user_id, r.full_name ?? ""]));
    },
    enabled: !!baseId,
    staleTime: 5 * 60_000,
    meta: { errorMessage: "Не удалось загрузить авторов статей" },
  });
}

/** Черновик правок статьи (редактору): текст и кто правил. */
export function useKbDraft(nodeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [KB_DRAFTS_KEY, "node", nodeId],
    queryFn: () => loadKbDraft(nodeId!),
    enabled: !!nodeId && enabled,
    meta: { errorMessage: "Не удалось загрузить черновик статьи" },
  });
}
