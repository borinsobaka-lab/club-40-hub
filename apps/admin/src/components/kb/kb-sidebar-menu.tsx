import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Copy,
  Ellipsis,
  FilePlus,
  FolderInput,
  FolderPlus,
  Pencil,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { ChartSquare, DocumentText, Folder } from "@/components/nav-icons";
import { DropIndicator } from "@/components/kb/drop-indicator";
import { KbMoveForm, KbNodeTitleForm } from "@/components/kb/node-dialogs";
import { useKbActions } from "@/components/kb/use-kb-actions";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ListItemButton } from "@/components/ui/list-item-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDragRow } from "@/hooks/use-drag-row";
import { supabase } from "@/integrations/supabase/client";
import { canEditKb } from "@/lib/kb/access";
import {
  invalidateKb,
  kbBasesQuery,
  kbErrorText,
  snippetParts,
  useKbDrafts,
  useKbSearch,
  useKbTree,
} from "@/lib/kb/data";
import {
  ancestorsOf,
  childrenOf,
  dropPlacement,
  indexTree,
  isWithin,
  readerNodes,
  type KbTreeIndex,
} from "@/lib/kb/tree";
import type { KbKind, KbTreeNode } from "@/lib/kb/types";
import { cn } from "@/lib/utils";

/** Открытые папки дерева — по базе, переживают перезагрузку. */
function saveOpenFolders(key: string, open: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...open]));
  } catch {
    // приватный режим — дерево просто не запомнит раскрытые папки
  }
}

function useOpenFolders(baseId: string) {
  const key = `kb_tree:${baseId}`;
  const [open, setOpen] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(window.localStorage.getItem(key) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback(
    (id: string, value?: boolean) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (value ?? !next.has(id)) next.add(id);
        else next.delete(id);
        saveOpenFolders(key, next);
        return next;
      }),
    [key],
  );
  const openAll = useCallback(
    (ids: string[]) =>
      setOpen((prev) => {
        if (ids.every((id) => prev.has(id))) return prev;
        const next = new Set([...prev, ...ids]);
        saveOpenFolders(key, next);
        return next;
      }),
    [key],
  );
  return { open, toggle, openAll };
}

type Dialogs =
  | { kind: "create"; nodeKind: KbKind; parentId: string | null }
  | { kind: "rename"; node: KbTreeNode }
  | { kind: "move"; node: KbTreeNode }
  | null;

/**
 * Меню базы знаний в боковой панели: поиск по базе и дерево папок и статей.
 * Редактор перетаскивает строки (линия — куда встанет, рамка — внутрь
 * папки), создаёт и правит из «⋯» у строки; черновики и архив у него серые.
 * Читатель видит только опубликованное без пустых папок.
 */
export function KbSidebarMenu({ baseId, onNavigate }: { baseId: string; onNavigate: () => void }) {
  const access = useAdminAccess();
  const level = access?.isOwner ? "manage" : access?.kb?.[baseId];
  const canEdit = canEditKb(level);
  const { data: bases } = useQuery(kbBasesQuery);
  const base = bases?.find((b) => b.id === baseId);
  const { data: allNodes, isLoading } = useKbTree(baseId);
  const { data: drafts } = useKbDrafts(baseId, canEdit);
  const actions = useKbActions(baseId);
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<Dialogs>(null);

  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const currentId = /^\/kb\/[^/]+\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null;

  const nodes = useMemo(
    () => (canEdit ? (allNodes ?? []) : readerNodes(allNodes ?? [])),
    [allNodes, canEdit],
  );
  const index = useMemo(() => indexTree(nodes), [nodes]);
  const draftIds = useMemo(() => new Set((drafts ?? []).map((d) => d.node_id)), [drafts]);
  const folders = useOpenFolders(baseId);
  const { openAll } = folders;

  // Открытая статья видна в дереве: папки над ней раскрываются.
  useEffect(() => {
    if (!currentId || !index.byId.has(currentId)) return;
    const ids = ancestorsOf(index, currentId).map((a) => a.id);
    if (index.byId.get(currentId)?.kind === "folder") ids.push(currentId);
    openAll(ids);
  }, [currentId, index, openAll]);

  // Поиск: во всей базе или в папке, где стоим.
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const current = currentId ? index.byId.get(currentId) : undefined;
  const scopeFolder = current
    ? current.kind === "folder"
      ? current
      : index.byId.get(current.parent_id ?? "")
    : undefined;
  const [inFolder, setInFolder] = useState(false);
  const search = useKbSearch(baseId, debounced, inFolder && scopeFolder ? scopeFolder.id : null);

  const publish = async (node: KbTreeNode) => {
    const { error } = await supabase.rpc("kb_publish", { p_node: node.id });
    if (error) {
      toast.error(kbErrorText(error.message));
      return;
    }
    await invalidateKb(qc, baseId);
    toast.success("Статья опубликована");
  };

  const remove = async (node: KbTreeNode) => {
    const ok = await confirm({
      title:
        node.kind === "folder"
          ? `Удалить папку «${node.title}»?`
          : `Удалить статью «${node.title}»?`,
      description:
        "Удаляется насовсем, вместе с историей и отметками о прочтении. Если может пригодиться — лучше в архив.",
    });
    if (ok) await actions.remove(node);
  };

  const rowMenu = (node: KbTreeNode): MenuItem[] => {
    const isFolder = node.kind === "folder";
    const hasChildren = childrenOf(index, node.id).length > 0;
    const items: MenuItem[] = [];
    if (isFolder) {
      items.push(
        {
          label: "Статья в папке",
          icon: FilePlus,
          onSelect: () => setDialog({ kind: "create", nodeKind: "article", parentId: node.id }),
        },
        {
          label: "Папка в папке",
          icon: FolderPlus,
          onSelect: () => setDialog({ kind: "create", nodeKind: "folder", parentId: node.id }),
        },
      );
    }
    items.push({
      label: isFolder ? "Название и описание" : "Переименовать",
      icon: Pencil,
      onSelect: () => setDialog({ kind: "rename", node }),
    });
    items.push({
      label: "Переместить…",
      icon: FolderInput,
      onSelect: () => setDialog({ kind: "move", node }),
    });
    if (!isFolder) {
      items.push({ label: "Сделать копию", icon: Copy, onSelect: () => actions.copy(node.id) });
      if (node.status === "draft")
        items.push({ label: "Опубликовать", icon: Send, onSelect: () => publish(node) });
    } else if (node.status === "draft") {
      items.push({
        label: "Опубликовать папку",
        icon: Send,
        onSelect: () => actions.setStatus(node, "published"),
      });
    }
    if (node.status === "published")
      items.push({
        label: "Снять с публикации",
        icon: Undo2,
        onSelect: () => actions.setStatus(node, "draft"),
      });
    items.push(
      node.status === "archived"
        ? {
            label: "Вернуть из архива",
            icon: ArchiveRestore,
            onSelect: () => actions.setStatus(node, isFolder ? "published" : "draft"),
          }
        : { label: "В архив", icon: Archive, onSelect: () => actions.setStatus(node, "archived") },
    );
    // Опубликованное и папку с содержимым не удаляем: сначала архив или перенос.
    if (node.status !== "published" && !hasChildren)
      items.push({
        label: "Удалить",
        icon: Trash2,
        destructive: true,
        onSelect: () => remove(node),
      });
    return items;
  };

  const onDropNode = (
    sourceId: string,
    targetId: string,
    op: Parameters<typeof dropPlacement>[3],
  ) => {
    const placement = dropPlacement(index, sourceId, targetId, op);
    if (!placement) return;
    if (op === "combine") folders.toggle(targetId, true);
    void actions.move(sourceId, placement.parentId, placement.position);
  };

  const renderLevel = (parentId: string | null, depth: number) =>
    childrenOf(index, parentId).map((node) => (
      <TreeRow
        key={node.id}
        node={node}
        depth={depth}
        index={index}
        baseId={baseId}
        active={node.id === currentId}
        open={folders.open.has(node.id)}
        hasDraft={draftIds.has(node.id)}
        canEdit={canEdit}
        menu={canEdit ? rowMenu(node) : []}
        onToggle={() => folders.toggle(node.id)}
        onDropNode={onDropNode}
        onNavigate={onNavigate}
      >
        {node.kind === "folder" && folders.open.has(node.id) && renderLevel(node.id, depth + 1)}
      </TreeRow>
    ));

  const showResults = debounced.trim().length >= 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 px-3 pb-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Поиск по базе"
          aria-label="Поиск по базе знаний"
          className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:bg-white/10"
        />
        {query && scopeFolder && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
            <Checkbox
              checked={inFolder}
              onCheckedChange={(v) => setInFolder(v === true)}
              className="border-white/40"
            />
            <span className="truncate">Только в «{scopeFolder.title}»</span>
          </label>
        )}
      </div>

      <nav
        aria-label="Содержание базы знаний"
        className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {showResults ? (
          <SearchResults
            baseId={baseId}
            index={index}
            hits={search.data}
            loading={search.isLoading}
            onNavigate={onNavigate}
          />
        ) : isLoading ? (
          <div className="space-y-1.5 px-1 pt-1">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton
                key={i}
                className="h-6 bg-white/10"
                style={{ marginLeft: i % 3 ? 16 : 0 }}
              />
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <p className="px-2 py-3 text-sm text-white/50">
            {canEdit
              ? "Пока пусто. Начните с папки-раздела или статьи."
              : "Здесь пока ничего не опубликовано."}
          </p>
        ) : (
          <ul role="tree" className="space-y-px">
            {renderLevel(null, 0)}
          </ul>
        )}
      </nav>

      <div className="space-y-1 border-t border-white/10 p-2">
        {canEdit && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-white hover:bg-white/10 hover:text-white"
              onClick={() =>
                setDialog({ kind: "create", nodeKind: "folder", parentId: scopeFolder?.id ?? null })
              }
            >
              <FolderPlus />
              Папка
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-white hover:bg-white/10 hover:text-white"
              onClick={() =>
                setDialog({
                  kind: "create",
                  nodeKind: "article",
                  parentId: scopeFolder?.id ?? null,
                })
              }
            >
              <FilePlus />
              Статья
            </Button>
          </div>
        )}
        {canEdit && (
          <Link
            to="/kb/$baseId/report"
            params={{ baseId }}
            onClick={onNavigate}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium text-white hover:bg-white/10",
              pathname.endsWith("/report") && "bg-white/10 font-semibold",
            )}
          >
            <ChartSquare active={pathname.endsWith("/report")} className="size-[18px]" />
            Отчёт по чтению
          </Link>
        )}
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          {dialog?.kind === "create" && (
            <KbNodeTitleForm
              kind={dialog.nodeKind}
              node={null}
              place={{ nodes, baseTitle: base?.title ?? "База", parentId: dialog.parentId }}
              onSave={async (title, description, parentId) => {
                const id = await actions.create(dialog.nodeKind, parentId, title, description);
                if (id && parentId) folders.toggle(parentId, true);
                if (id) onNavigate();
                return id;
              }}
              onDone={() => setDialog(null)}
            />
          )}
          {dialog?.kind === "rename" && (
            <KbNodeTitleForm
              kind={dialog.node.kind}
              node={dialog.node}
              onSave={(title, description) =>
                actions.update(dialog.node.id, { title, description })
              }
              onDone={() => setDialog(null)}
            />
          )}
          {dialog?.kind === "move" && (
            <KbMoveForm
              node={dialog.node}
              nodes={nodes}
              baseTitle={base?.title ?? "База"}
              onMove={(parentId, position) => {
                if (parentId) folders.toggle(parentId, true);
                return actions.move(dialog.node.id, parentId, position);
              }}
              onDone={() => setDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}

type MenuItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  destructive?: boolean;
};

function TreeRow({
  node,
  depth,
  index,
  baseId,
  active,
  open,
  hasDraft,
  canEdit,
  menu,
  onToggle,
  onDropNode,
  onNavigate,
  children,
}: {
  node: KbTreeNode;
  depth: number;
  index: KbTreeIndex;
  baseId: string;
  active: boolean;
  open: boolean;
  hasDraft: boolean;
  canEdit: boolean;
  menu: MenuItem[];
  onToggle: () => void;
  onDropNode: (sourceId: string, targetId: string, op: Parameters<typeof dropPlacement>[3]) => void;
  onNavigate: () => void;
  children?: React.ReactNode;
}) {
  const isFolder = node.kind === "folder";
  const drag = useDragRow<HTMLDivElement>({
    id: node.id,
    type: `kb-node:${baseId}`,
    disabled: !canEdit,
    canCombine: isFolder,
    canDrop: (sourceId) => !isWithin(index, node.id, sourceId),
    onDrop: (sourceId, op) => onDropNode(sourceId, node.id, op),
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const muted = node.status !== "published";
  const statusHint =
    node.status === "archived" ? "В архиве" : node.status === "draft" ? "Черновик" : undefined;

  return (
    <li role="treeitem" aria-expanded={isFolder ? open : undefined} aria-selected={active}>
      {/*
        Строка без иконок, обычным начертанием (решение владельца 2026-10-25,
        по образцу справочных центров): иконка и полужирный — только у корня,
        названия базы в шапке меню. Папку отличает шеврон после названия.
      */}
      <div
        ref={drag.ref}
        className={cn(
          "group/kbrow relative flex h-8 items-center rounded-md text-sm text-white/75 hover:bg-white/10 hover:text-white [[data-mobile=true]_&]:h-10",
          active && "bg-white/10 text-white",
          drag.dragging && "opacity-40",
        )}
      >
        <DropIndicator instruction={drag.instruction} onDark />
        <Link
          to="/kb/$baseId/$nodeId"
          params={{ baseId, nodeId: node.id }}
          onClick={onNavigate}
          // Ссылка сама по себе перетаскивается браузером (как адрес) и
          // перебивала бы перенос строки.
          draggable={false}
          title={statusHint ? `${node.title} — ${statusHint.toLowerCase()}` : node.title}
          // Стрелки, как в дереве: → раскрыть папку, ← свернуть.
          onKeyDown={(e) => {
            if (!isFolder) return;
            if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) {
              e.preventDefault();
              onToggle();
            }
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pr-1 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span
            className={cn(
              "min-w-0 truncate",
              muted && "text-white/45",
              node.status === "archived" && "italic",
            )}
          >
            {node.title || "Без названия"}
          </span>
          {isFolder && (
            // Шеврон сворачивает и раскрывает, не открывая папку; с клавиатуры
            // — стрелками на строке.
            <span
              aria-hidden
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle();
              }}
              className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-white/45 hover:bg-white/10 hover:text-white"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </span>
          )}
          {hasDraft && (
            <span
              className="ml-auto size-1.5 shrink-0 rounded-full bg-brand-on-dark"
              title="Есть неопубликованные правки"
              aria-label="Есть неопубликованные правки"
            />
          )}
        </Link>
        {menu.length > 0 && (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`«${node.title}»: действия`}
                className={cn(
                  "mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/kbrow:opacity-100",
                  menuOpen && "opacity-100",
                )}
              >
                <Ellipsis className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="right" className="w-60 p-1">
              {menu.map((item) => (
                <ListItemButton
                  key={item.label}
                  className={cn(item.destructive && "text-destructive hover:text-destructive")}
                  onClick={() => {
                    setMenuOpen(false);
                    item.onSelect();
                  }}
                >
                  <item.icon className={cn(!item.destructive && "text-muted-foreground")} />
                  {item.label}
                </ListItemButton>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {children && (
        <ul role="group" className="space-y-px">
          {children}
        </ul>
      )}
    </li>
  );
}

function SearchResults({
  baseId,
  index,
  hits,
  loading,
  onNavigate,
}: {
  baseId: string;
  index: KbTreeIndex;
  hits: ReturnType<typeof useKbSearch>["data"];
  loading: boolean;
  onNavigate: () => void;
}) {
  if (loading)
    return (
      <div className="space-y-2 px-1 pt-1">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-12 bg-white/10" />
        ))}
      </div>
    );
  if (!hits?.length) return <p className="px-2 py-3 text-sm text-white/50">Ничего не нашлось</p>;
  return (
    <ul className="space-y-0.5" aria-label="Найдено">
      {hits.map((h) => {
        const path = ancestorsOf(index, h.id)
          .map((a) => a.title)
          .join(" › ");
        return (
          <li key={h.id}>
            <Link
              to="/kb/$baseId/$nodeId"
              params={{ baseId, nodeId: h.id }}
              onClick={onNavigate}
              className="block rounded-md px-2 py-1.5 text-sm text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <span className="flex items-center gap-1.5 font-medium">
                {h.kind === "folder" ? (
                  <Folder className="size-3.5 shrink-0 text-white/60" />
                ) : (
                  <DocumentText className="size-3.5 shrink-0 text-white/60" />
                )}
                <span className={cn("truncate", h.status !== "published" && "text-white/50")}>
                  {h.title || "Без названия"}
                </span>
              </span>
              {path && <span className="block truncate text-xs text-white/45">{path}</span>}
              {h.snippet && (
                <span className="mt-0.5 line-clamp-2 text-xs text-white/60">
                  {snippetParts(h.snippet).map((p, i) =>
                    p.hit ? (
                      <mark key={i} className="rounded-sm bg-transparent font-semibold text-white">
                        {p.text}
                      </mark>
                    ) : (
                      <span key={i}>{p.text}</span>
                    ),
                  )}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
