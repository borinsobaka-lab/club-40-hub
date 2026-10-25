import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldClass } from "@/components/ui/field-styles";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  STATUS_TONE_CLASS,
  statusChipBase,
  statusChipSize,
} from "@/components/ui/status-chip-styles";
import { supabase } from "@/integrations/supabase/client";
import {
  createKbTag,
  KB_NODE_TAGS_KEY,
  KB_TAGS_KEY,
  kbErrorText,
  saveKbNodeTags,
  useKbNodeTags,
  useKbTags,
} from "@/lib/kb/data";
import {
  findTagByName,
  KB_TAG_MAX_LENGTH,
  KB_TAGS_PER_ARTICLE,
  matchTags,
  normalizeTagName,
  sortTags,
  tagArticleCounts,
  type KbTag,
} from "@/lib/kb/tags";
import { cn } from "@/lib/utils";

/**
 * Теги статей базы знаний (решение владельца 2026-10-25): у статьи — теги
 * базы, новые заводятся прямо в поле выбора; на главной базы — облако тегов
 * (`?tag=` — статьи с тегом), в поиске шапки — найденные теги и статьи с ними.
 */

const chipClass = cn(statusChipBase, statusChipSize.default, STATUS_TONE_CLASS.neutral);

/** Тег-пилюля: «#Касса»; со ссылкой — на главную базы со статьями этого тега. */
export function KbTagChip({
  baseId,
  tag,
  count,
  active,
  link = true,
  onRemove,
}: {
  baseId: string;
  tag: KbTag;
  /** Сколько статей с тегом — на главной. */
  count?: number;
  /** Выбран на главной — цветом базы. */
  active?: boolean;
  link?: boolean;
  onRemove?: () => void;
}) {
  const body = (
    <>
      <span className="opacity-60">#</span>
      {tag.name}
      {count !== undefined && <span className="tabular-nums opacity-60">{count}</span>}
    </>
  );
  const tone = active ? "bg-brand/15 text-brand-on-light" : "";
  if (onRemove)
    return (
      <span className={cn(chipClass, "pr-1 text-foreground")}>
        {body}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Убрать тег «${tag.name}»`}
          className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
        >
          <X className="size-3" />
        </button>
      </span>
    );
  if (!link) return <span className={cn(chipClass, tone)}>{body}</span>;
  return (
    <Link
      to="/kb/$baseId"
      params={{ baseId }}
      // Выбранный тег — повторное нажатие снимает выбор.
      search={active ? {} : { tag: tag.id }}
      aria-current={active ? "true" : undefined}
      className={cn(
        chipClass,
        "transition-colors hover:bg-muted-foreground/15 hover:text-foreground",
        tone,
      )}
    >
      {body}
    </Link>
  );
}

/** Теги статьи под её названием — ссылками на статьи с тем же тегом. */
export function KbArticleTags({ baseId, nodeId }: { baseId: string; nodeId: string }) {
  const { data: nodeTags, tags } = useKbNodeTags(baseId);
  const ids = nodeTags?.get(nodeId) ?? [];
  const byId = new Map((tags ?? []).map((t) => [t.id, t]));
  const list = ids.map((id) => byId.get(id)).filter((t): t is KbTag => !!t);
  if (list.length === 0) return null;
  return (
    <ul aria-label="Теги статьи" className="mt-3 flex flex-wrap gap-1.5">
      {list.map((t) => (
        <li key={t.id}>
          <KbTagChip baseId={baseId} tag={t} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Выбор тегов статьи: выбранные — пилюлями с крестиком, «Добавить тег» —
 * список тегов базы с поиском; нет такого — «Создать тег «…»» (тег сразу
 * заводится в базе). Не больше 10 у статьи.
 */
export function KbTagsField({
  baseId,
  value,
  onChange,
  disabled,
}: {
  baseId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const { data: tags = [] } = useKbTags(baseId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const selected = value.map((id) => byId.get(id)).filter((t): t is KbTag => !!t);
  const name = normalizeTagName(search);
  const existing = findTagByName(tags, search);
  const options = (name ? matchTags(tags, search) : tags).filter((t) => !value.includes(t.id));
  const full = value.length >= KB_TAGS_PER_ARTICLE;

  const add = (id: string) => {
    onChange([...value, id]);
    setSearch("");
    if (value.length + 1 >= KB_TAGS_PER_ARTICLE) setOpen(false);
  };
  const create = async () => {
    if (!name || creating) return;
    setCreating(true);
    try {
      const tag = await createKbTag(baseId, name);
      qc.setQueryData<KbTag[]>([KB_TAGS_KEY, baseId], (prev) => sortTags([...(prev ?? []), tag]));
      void qc.invalidateQueries({ queryKey: [KB_TAGS_KEY, baseId] });
      add(tag.id);
    } catch (e) {
      toast.error(kbErrorText(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className={cn(
        fieldClass,
        "flex h-auto min-h-10 flex-wrap items-center gap-1.5 px-2 py-1.5",
        disabled && "opacity-50",
      )}
    >
      {selected.map((t) => (
        <KbTagChip
          key={t.id}
          baseId={baseId}
          tag={t}
          onRemove={disabled ? undefined : () => onChange(value.filter((id) => id !== t.id))}
        />
      ))}
      {full ? (
        <span className="px-1 text-xs text-muted-foreground">
          Не больше {KB_TAGS_PER_ARTICLE} тегов
        </span>
      ) : (
        // modal: поле стоит и в окне «Новая статья» — без modal список в окне не листается.
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setSearch("");
          }}
          modal
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-4" />
              {selected.length ? "Ещё тег" : "Добавить тег"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                value={search}
                onValueChange={(v) => setSearch(v.slice(0, KB_TAG_MAX_LENGTH + 2))}
                placeholder="Найти или создать тег"
              />
              <CommandList>
                <CommandEmpty>
                  {tags.length ? "Такого тега нет" : "Тегов пока нет — введите название"}
                </CommandEmpty>
                <CommandGroup>
                  {options.map((t) => (
                    <CommandItem key={t.id} value={t.id} onSelect={() => add(t.id)}>
                      <span className="text-muted-foreground">#</span>
                      <span className="truncate">{t.name}</span>
                    </CommandItem>
                  ))}
                  {name && !existing && (
                    <CommandItem
                      value="__create"
                      onSelect={() => void create()}
                      disabled={creating}
                    >
                      {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                      <span className="truncate">Создать тег «{name}»</span>
                    </CommandItem>
                  )}
                </CommandGroup>
                {existing && value.includes(existing.id) && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    «{existing.name}» уже у статьи
                  </p>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * Теги статьи в режиме правки (под названием): меняются сразу, без
 * публикации — как название. Сохранения идут по очереди; не получилось —
 * тост и поле возвращается к тому, что в базе.
 */
export function KbArticleTagsEditor({ baseId, nodeId }: { baseId: string; nodeId: string }) {
  const qc = useQueryClient();
  const { data: nodeTags } = useKbNodeTags(baseId);
  const saved = nodeTags?.get(nodeId) ?? [];
  const [local, setLocal] = useState<string[] | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const value = local ?? saved;
  const change = (next: string[]) => {
    const prev = value;
    setLocal(next);
    queue.current = queue.current.then(async () => {
      try {
        await saveKbNodeTags(baseId, nodeId, prev, next);
      } catch (e) {
        toast.error(kbErrorText(e));
        setLocal(null);
      }
      await qc.invalidateQueries({ queryKey: [KB_NODE_TAGS_KEY, baseId] });
    });
  };
  return (
    <div className="mt-3 max-w-xl">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Теги</p>
      <KbTagsField baseId={baseId} value={value} onChange={change} disabled={!nodeTags} />
    </div>
  );
}

/**
 * «Теги базы» (редактору, с главной базы): переименовать и удалить.
 * Удалённый тег снимается со всех статей.
 */
export function KbTagsManageForm({ baseId, onDone }: { baseId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { data: nodeTags, tags = [] } = useKbNodeTags(baseId);
  const counts = useMemo(
    () => (nodeTags ? tagArticleCounts(nodeTags, () => true) : new Map<string, number>()),
    [nodeTags],
  );
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: [KB_TAGS_KEY, baseId] }),
      qc.invalidateQueries({ queryKey: [KB_NODE_TAGS_KEY, baseId] }),
    ]);

  const rename = async (tag: KbTag, raw: string) => {
    const name = normalizeTagName(raw);
    if (!name || name === tag.name) return false;
    const { error } = await supabase.from("kb_tags").update({ name }).eq("id", tag.id);
    if (error) {
      toast.error(kbErrorText(error.message));
      return false;
    }
    await refresh();
    toast.success("Тег переименован");
    return true;
  };
  const remove = async (tag: KbTag) => {
    const n = counts.get(tag.id) ?? 0;
    const ok = await confirm({
      title: `Удалить тег «${tag.name}»?`,
      description: n
        ? `Тег снимется со статей: ${n}. Сами статьи останутся.`
        : "Тег ни у одной статьи не стоит.",
    });
    if (!ok) return;
    const { error } = await supabase.from("kb_tags").delete().eq("id", tag.id);
    if (error) {
      toast.error(kbErrorText(error.message));
      return;
    }
    await refresh();
    toast.success("Тег удалён");
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Теги базы</DialogTitle>
        <DialogDescription>
          Новые теги заводятся у статьи — в окне новой статьи или в режиме правки. Здесь — исправить
          название или удалить лишний.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {tags.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Тегов пока нет.</p>
        ) : (
          <ul className="space-y-2">
            {tags.map((t) => (
              <TagRow
                key={t.id}
                tag={t}
                count={counts.get(t.id) ?? 0}
                onRename={(name) => rename(t, name)}
                onRemove={() => void remove(t)}
              />
            ))}
          </ul>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Закрыть
        </Button>
      </DialogFooter>
      {confirmDialog}
    </>
  );
}

function TagRow({
  tag,
  count,
  onRename,
  onRemove,
}: {
  tag: KbTag;
  count: number;
  onRename: (name: string) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [name, setName] = useState(tag.name);
  return (
    <li className="flex items-center gap-2">
      <Input
        aria-label={`Название тега «${tag.name}»`}
        value={name}
        maxLength={KB_TAG_MAX_LENGTH}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void onRename(name).then((ok) => !ok && setName(tag.name))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {count ? `статей: ${count}` : "не стоит"}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label={`Удалить тег «${tag.name}»`}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
