import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { KB_NODES_KEY, invalidateKb, kbErrorText } from "@/lib/kb/data";
import { applyMove } from "@/lib/kb/tree";
import type { KbKind, KbStatus, KbTreeNode } from "@/lib/kb/types";

/**
 * Действия редактора с деревом базы: из бокового меню и со страниц. Права
 * проверяет RLS (kb_nodes editor write) и RPC; ошибки — тостом по-русски.
 */
export function useKbActions(baseId: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const fail = (e: unknown) => toast.error(kbErrorText(e));

  const create = useCallback(
    async (kind: KbKind, parentId: string | null, title: string, description = "") => {
      const { data, error } = await supabase
        .from("kb_nodes")
        .insert({
          base_id: baseId,
          parent_id: parentId,
          kind,
          title,
          description,
          // Папку видно сразу (пустую читателю не покажем), статья — черновик
          // до публикации.
          status: kind === "folder" ? "published" : "draft",
        })
        .select("id")
        .single();
      if (error) {
        fail(error.message);
        return null;
      }
      await invalidateKb(qc, baseId);
      const id = (data as { id: string }).id;
      await navigate({
        to: "/kb/$baseId/$nodeId",
        params: { baseId, nodeId: id },
        search: kind === "article" ? { edit: true } : {},
      });
      return id;
    },
    [baseId, qc, navigate],
  );

  const update = useCallback(
    async (id: string, patch: Partial<Pick<KbTreeNode, "title" | "description" | "status">>) => {
      const { error } = await supabase.from("kb_nodes").update(patch).eq("id", id);
      if (error) {
        fail(error.message);
        return false;
      }
      await invalidateKb(qc, baseId);
      return true;
    },
    [baseId, qc],
  );

  const setStatus = useCallback(
    async (node: KbTreeNode, status: KbStatus) => {
      const ok = await update(node.id, { status });
      if (ok) {
        const what = node.kind === "folder" ? "Папка" : "Статья";
        toast.success(
          status === "archived"
            ? `${what} в архиве — читатели её больше не видят`
            : status === "draft"
              ? `${what} снята с публикации`
              : `${what} снова опубликована`,
        );
      }
      return ok;
    },
    [update],
  );

  const move = useCallback(
    async (nodeId: string, parentId: string | null, position: number) => {
      // Порядок — сразу на месте, база пересчитает его одной командой.
      qc.setQueryData<KbTreeNode[]>([KB_NODES_KEY, baseId], (prev) =>
        prev ? applyMove(prev, nodeId, parentId, position) : prev,
      );
      const { error } = await supabase.rpc("kb_move_node", {
        p_node: nodeId,
        p_parent: parentId,
        p_index: position,
      });
      if (error) fail(error.message);
      await invalidateKb(qc, baseId);
      return !error;
    },
    [baseId, qc],
  );

  const copy = useCallback(
    async (nodeId: string) => {
      const { data, error } = await supabase.rpc("kb_copy_node", { p_node: nodeId });
      if (error) {
        fail(error.message);
        return;
      }
      await invalidateKb(qc, baseId);
      toast.success("Копия создана — черновиком под оригиналом");
      await navigate({
        to: "/kb/$baseId/$nodeId",
        params: { baseId, nodeId: data as string },
        search: { edit: true },
      });
    },
    [baseId, qc, navigate],
  );

  const remove = useCallback(
    async (node: KbTreeNode) => {
      const { error } = await supabase.from("kb_nodes").delete().eq("id", node.id);
      if (error) {
        fail(error.message);
        return false;
      }
      await invalidateKb(qc, baseId);
      toast.success(node.kind === "folder" ? "Папка удалена" : "Статья удалена");
      return true;
    },
    [baseId, qc],
  );

  return { create, update, setStatus, move, copy, remove };
}
