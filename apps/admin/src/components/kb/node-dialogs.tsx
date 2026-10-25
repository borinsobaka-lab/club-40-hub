import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DocumentText, Folder, Notebook } from "@/components/nav-icons";
import { SearchInput } from "@/components/ui/search-input";
import { KbStatusBadge } from "@/components/kb/kb-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { ListItemButton } from "@/components/ui/list-item-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ancestorsOf, childrenOf, indexTree, isWithin } from "@/lib/kb/tree";
import type { KbKind, KbTreeNode } from "@/lib/kb/types";

/** Папки дерева по порядку с глубиной — для выбора «куда»; `skip` — без этой ветки. */
function folderOptions(nodes: KbTreeNode[], skip?: string): { node: KbTreeNode; depth: number }[] {
  const index = indexTree(nodes);
  const out: { node: KbTreeNode; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of childrenOf(index, parent)) {
      if (n.kind !== "folder" || (skip && isWithin(index, n.id, skip))) continue;
      out.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const ROOT = "__root__";

/**
 * Новая папка или статья (название и где создать), правка названия и
 * описания папки. «Где создать» видно всегда: кнопки «Папка» / «Статья» в
 * меню и на странице папки создают в разных местах — окно показывает, где
 * именно, и даёт поменять.
 */
export function KbNodeTitleForm({
  kind,
  node,
  place,
  onSave,
  onDone,
}: {
  kind: KbKind;
  /** null — новая. */
  node: KbTreeNode | null;
  /** Для новой: дерево базы и папка по умолчанию (null — верхний уровень). */
  place?: { nodes: KbTreeNode[]; baseTitle: string; parentId: string | null };
  onSave: (
    title: string,
    description: string,
    parentId: string | null,
  ) => Promise<boolean | string | null>;
  onDone: () => void;
}) {
  const [parentId, setParentId] = useState<string | null>(place?.parentId ?? null);
  const folders = useMemo(() => (place ? folderOptions(place.nodes) : []), [place]);
  const [title, setTitle] = useState(node?.title ?? "");
  const [description, setDescription] = useState(node?.description ?? "");
  const [saving, setSaving] = useState(false);
  const isFolder = kind === "folder";

  const save = async () => {
    const t = title.trim();
    if (!t) {
      toast.error(isFolder ? "Укажите название папки" : "Укажите название статьи");
      return;
    }
    setSaving(true);
    try {
      if (await onSave(t, description.trim(), parentId)) onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {node
            ? isFolder
              ? "Папка"
              : "Название статьи"
            : isFolder
              ? "Новая папка"
              : "Новая статья"}
        </DialogTitle>
        <DialogDescription>
          {isFolder
            ? "Папка собирает статьи и другие папки. Читателям пустая папка не видна."
            : "Статья создаётся черновиком: читатели увидят её после публикации."}
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={save}>
        <DialogBody>
          <div className="space-y-4">
            {place && !node && (
              <FormField
                label="Где создать"
                tip="Папка, в которой появится новая папка или статья. Потом её можно перенести перетаскиванием в меню."
              >
                <Select
                  value={parentId ?? ROOT}
                  onValueChange={(v) => setParentId(v === ROOT ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOT}>{place.baseTitle} — верхний уровень</SelectItem>
                    {folders.map(({ node: f, depth }) => (
                      <SelectItem key={f.id} value={f.id} textValue={f.title}>
                        <span
                          style={{ paddingLeft: depth * 14 }}
                          className="flex items-center gap-2"
                        >
                          <Folder className="size-4 text-muted-foreground" />
                          {f.title || "Без названия"}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Название" required>
              <Input
                autoFocus
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </FormField>
            {isFolder && (
              <FormField
                label="Описание"
                tip="Короткое вступление над списком статей папки — что в ней и для кого."
              >
                <Textarea
                  value={description}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {node ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

/**
 * «Переместить…» — выбор папки из списка: запасной путь к перетаскиванию
 * (на телефоне, в длинном дереве). Узел встаёт в конец выбранной папки.
 */
export function KbMoveForm({
  node,
  nodes,
  baseTitle,
  onMove,
  onDone,
}: {
  node: KbTreeNode;
  nodes: KbTreeNode[];
  baseTitle: string;
  onMove: (parentId: string | null, position: number) => Promise<boolean>;
  onDone: () => void;
}) {
  const index = useMemo(() => indexTree(nodes), [nodes]);
  const [target, setTarget] = useState<string | null>(node.parent_id);
  const [saving, setSaving] = useState(false);

  // Папки дерева с отступом по глубине, без самого узла и его вложенных.
  const folders = folderOptions(nodes, node.id);

  const save = async () => {
    if (target === node.parent_id) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      const count = childrenOf(index, target).filter((n) => n.id !== node.id).length;
      if (await onMove(target, count)) onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Переместить «{node.title || "Без названия"}»</DialogTitle>
        <DialogDescription>
          Выберите папку — {node.kind === "folder" ? "папка" : "статья"} встанет в её конец. Порядок
          внутри папки меняется перетаскиванием в меню.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={save}>
        <DialogBody>
          <div className="space-y-0.5">
            <ListItemButton active={target === null} onClick={() => setTarget(null)}>
              <Notebook className="text-muted-foreground" />
              {baseTitle} — верхний уровень
            </ListItemButton>
            {folders.map(({ node: f, depth }) => (
              <ListItemButton
                key={f.id}
                active={target === f.id}
                onClick={() => setTarget(f.id)}
                style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}
              >
                <Folder className="text-muted-foreground" />
                <span className="truncate">{f.title || "Без названия"}</span>
              </ListItemButton>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Переместить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

/**
 * «Ссылка на статью» из меню «/» редактора: выбор статьи этой базы по
 * названию. Ссылка — адрес статьи в админке (/kb/база/статья): переименование
 * её не ломает.
 */
export function KbArticlePickerForm({
  baseId,
  nodes,
  excludeId,
  onPick,
}: {
  baseId: string;
  nodes: KbTreeNode[];
  excludeId: string;
  onPick: (link: { title: string; href: string } | null) => void;
}) {
  const index = useMemo(() => indexTree(nodes), [nodes]);
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const articles = nodes
    .filter((n) => n.kind === "article" && n.id !== excludeId && n.status !== "archived")
    .filter((n) => !term || n.title.toLowerCase().includes(term))
    // Опубликованные — первыми: ссылку на черновик читатель не откроет.
    .sort((a, b) => Number(!a.reader_visible) - Number(!b.reader_visible))
    .slice(0, 50);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ссылка на статью</DialogTitle>
        <DialogDescription>
          Ссылка встанет на место курсора. Переименование статьи её не сломает. Статью-черновик
          читатели по ссылке не откроют, пока её не опубликуют.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-3">
          <SearchInput autoFocus value={q} onChange={setQ} placeholder="Название статьи" />
          <div className="space-y-0.5">
            {articles.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Ничего не нашлось</p>
            ) : (
              articles.map((a) => (
                <ListItemButton
                  key={a.id}
                  onClick={() => onPick({ title: a.title, href: `/kb/${baseId}/${a.id}` })}
                >
                  <DocumentText className="text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{a.title || "Без названия"}</span>
                      {!a.reader_visible && (
                        <KbStatusBadge
                          status={a.status === "published" ? "draft" : a.status}
                          size="sm"
                        />
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {ancestorsOf(index, a.id)
                        .map((p) => p.title)
                        .join(" › ") || "Верхний уровень"}
                    </span>
                  </span>
                </ListItemButton>
              ))
            )}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onPick(null)}>
          Отмена
        </Button>
      </DialogFooter>
    </>
  );
}
