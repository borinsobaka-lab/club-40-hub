import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { noteBoxClass, noteChipClass } from "@/components/comment-cell";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { supabase } from "@/integrations/supabase/client";
import {
  canEditComment,
  commentAgeDays,
  commentAuthor,
  commentsCountText,
  commentWhen,
  commentWhenFull,
  COMMENTS_KEY,
  FRESH_COMMENT_DAYS,
  saleLabel,
  saleState,
  saleStatusText,
  useClientComments,
  useCommentSales,
  type ClientComment,
  type CommentSale,
  type CommentStats,
} from "@/lib/client-comments";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Комментарии по клиенту и его абонементам (решение владельца 2026-11-01):
 * «бумажка» в таблице и списке — сколько комментариев у клиента вместе с
 * абонементами, когда последний и кто оставил; по нажатию — окно со всей
 * лентой (о клиенте, о текущих и прошлых абонементах) и полем нового
 * комментария. Сводки — `useCommentStats` одним запросом на список.
 */

/** Что обновить после записи: ленту, сводки во всех списках. */
function useInvalidateComments() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [COMMENTS_KEY] });
}

/**
 * Кнопка-«бумажка» в ячейке таблицы или строке списка. Пустая — «+
 * Комментарий» (в таблице видна при наведении на строку, как у CommentCell).
 * `saleId` — открыли из строки абонемента: новый комментарий по умолчанию к
 * нему.
 */
export function CommentsButton({
  clientId,
  clientName,
  saleId,
  stats,
  loading,
  compact,
  className,
}: {
  clientId: string;
  clientName?: string;
  saleId?: string | null;
  stats: CommentStats | undefined;
  loading?: boolean;
  /** Одной строкой — в узком списке (подробный отчёт дашборда). */
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (loading && !stats) return <Skeleton className={compact ? "h-5 w-24" : "h-9 w-32"} />;
  return (
    <>
      <CommentsChip
        stats={stats}
        compact={compact}
        onClick={() => setOpen(true)}
        className={className}
      />
      <ClientCommentsDialog
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        clientName={clientName}
        saleId={saleId}
      />
    </>
  );
}

function CommentsChip({
  stats,
  compact,
  onClick,
  className,
}: {
  stats: CommentStats | undefined;
  compact?: boolean;
  onClick: () => void;
  className?: string;
}) {
  if (!stats) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Добавить комментарий"
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-md text-left text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-fine:[tr_&]:opacity-0 pointer-fine:[tr:hover_&]:opacity-100",
          className,
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Комментарий
      </button>
    );
  }
  const age = commentAgeDays(stats.last_at, stats.last_kind);
  const fresh = age !== null && age < FRESH_COMMENT_DAYS;
  const author = stats.last_author?.trim();
  const title = `${commentsCountText(stats.comments_count)}. Последний: ${stats.last_body}`;
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(
          noteChipClass,
          "inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 px-1.5 py-0.5 text-xs hover:bg-note focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          fresh && "bg-note ring-1 ring-note-border",
          className,
        )}
      >
        <MessageSquare className="h-3 w-3 shrink-0" />
        <span className="font-medium tabular-nums">{stats.comments_count}</span>
        <span className="truncate text-muted-foreground">
          {commentWhen(stats.last_at, stats.last_kind)}
          {author ? ` · ${author}` : ""}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        noteChipClass,
        "block w-full min-w-[150px] max-w-[240px] cursor-pointer text-left hover:bg-note focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        fresh && "bg-note ring-1 ring-note-border",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        <span className="tabular-nums">{stats.comments_count}</span>
        <span className="truncate font-normal text-muted-foreground">
          {commentWhen(stats.last_at, stats.last_kind)}
        </span>
      </span>
      {author && <span className="block truncate text-xs text-muted-foreground">{author}</span>}
    </button>
  );
}

/**
 * Последний комментарий одной строкой — под клиентом в окне занятия: кто,
 * когда и начало текста; по нажатию — вся лента. Нет комментариев — ничего.
 */
export function CommentsLine({
  clientId,
  clientName,
  stats,
}: {
  clientId: string;
  clientName?: string;
  stats: CommentStats | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!stats) return null;
  const author = stats.last_author?.trim();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={stats.last_body}
        className={cn(
          noteChipClass,
          "mt-1 flex w-full min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-left text-xs hover:bg-note focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <MessageSquare className="h-3 w-3 shrink-0" />
        <span className="shrink-0 tabular-nums">{stats.comments_count}</span>
        <span className="shrink-0 text-muted-foreground">
          {commentWhen(stats.last_at, stats.last_kind)}
          {author ? ` · ${author}` : ""}:
        </span>
        <span className="min-w-0 truncate">{stats.last_body}</span>
      </button>
      <ClientCommentsDialog
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        clientName={clientName}
      />
    </>
  );
}

/**
 * Блок в карточке клиента (над вкладками): последний комментарий целиком,
 * кто и когда, по нажатию — вся лента.
 */
export function ClientCommentsCard({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: comments, isLoading } = useClientComments(clientId);
  const last = comments?.[0];
  return (
    <div className="mb-4 space-y-2">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Комментарии{comments?.length ? ` · ${comments.length}` : ""}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {comments?.length ? (
            "Все комментарии"
          ) : (
            <>
              <Plus /> Комментарий
            </>
          )}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : last ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            noteBoxClass,
            "block w-full cursor-pointer text-left shadow-[var(--note-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span className="line-clamp-4 whitespace-pre-wrap break-words text-sm">{last.body}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {commentAuthor(last)} · {commentWhen(last.created_at, last.kind)}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block w-full rounded-md border border-dashed px-3 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground"
        >
          Комментариев нет — добавить
        </button>
      )}
      <ClientCommentsDialog
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        clientName={clientName}
      />
    </div>
  );
}

const CLIENT_TARGET = "client";
const ALL = "all";

/** Окно ленты: монтируется только открытым — запросы не идут на каждую строку таблицы. */
export function ClientCommentsDialog({
  open,
  onOpenChange,
  ...props
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName?: string;
  saleId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {open && <CommentsThread key={props.clientId} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function CommentsThread({
  clientId,
  clientName,
  saleId,
}: {
  clientId: string;
  clientName?: string;
  saleId?: string | null;
}) {
  const { data: comments, isLoading } = useClientComments(clientId);
  const { data: sales = [] } = useCommentSales(clientId);
  const { data: me } = useStaffProfile();
  const { confirm, confirmDialog } = useConfirm();
  const invalidate = useInvalidateComments();
  const [filter, setFilter] = useState<string>(ALL);

  const today = todayISO();
  const saleById = useMemo(() => new Map(sales.map((s) => [s.id, s])), [sales]);
  const shown = (comments ?? []).filter((c) =>
    filter === ALL ? true : filter === CLIENT_TARGET ? !c.sale_id : c.sale_id === filter,
  );
  const countFor = (key: string) =>
    (comments ?? []).filter((c) => (key === CLIENT_TARGET ? !c.sale_id : c.sale_id === key)).length;

  const remove = async (c: ClientComment) => {
    if (!(await confirm({ title: "Удалить комментарий?", description: c.body.slice(0, 200) })))
      return;
    const { error } = await supabase.from("client_comments").delete().eq("id", c.id);
    if (error) {
      toast.error("Не удалось удалить комментарий: " + error.message);
      return;
    }
    toast.success("Комментарий удалён");
    void invalidate();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Комментарии{clientName ? `: ${clientName}` : ""}</DialogTitle>
        <DialogDescription>
          О клиенте и всех его абонементах — текущих и прошлых, свежие сверху.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <NewComment
          clientId={clientId}
          sales={sales}
          defaultTarget={saleId && saleById.has(saleId) ? saleId : CLIENT_TARGET}
          today={today}
          onSaved={invalidate}
        />

        {(comments?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {commentsCountText(comments!.length)}
            </span>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-64 max-w-full" aria-label="Чьи комментарии">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все комментарии</SelectItem>
                <SelectItem value={CLIENT_TARGET}>О клиенте ({countFor(CLIENT_TARGET)})</SelectItem>
                {sales.map((s) => (
                  <SelectItem key={s.id} value={s.id} textValue={saleLabel(s)}>
                    {saleLabel(s)} ({countFor(s.id)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {comments?.length ? "Здесь комментариев нет" : "Комментариев пока нет"}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                sale={c.sale_id ? (saleById.get(c.sale_id) ?? null) : null}
                today={today}
                editable={canEditComment(c, me?.id)}
                onSaved={invalidate}
                onDelete={() => remove(c)}
              />
            ))}
          </ul>
        )}
      </DialogBody>
      {confirmDialog}
    </>
  );
}

function TargetLabel({ sale, today }: { sale: CommentSale; today: string }) {
  const current = saleState(sale, today) === "current";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>Абонемент «{saleLabel(sale)}»</span>
      <StatusChip tone={current ? "positive" : "neutral"}>{saleStatusText(sale, today)}</StatusChip>
    </span>
  );
}

function NewComment({
  clientId,
  sales,
  defaultTarget,
  today,
  onSaved,
}: {
  clientId: string;
  sales: CommentSale[];
  defaultTarget: string;
  today: string;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  // null — не выбирали: пока абонементы грузятся, выбор из строки ещё не в списке.
  const [picked, setPicked] = useState<string | null>(null);
  const target = picked ?? defaultTarget;
  const [saving, setSaving] = useState(false);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const body = text.trim();
    if (!body) {
      toast.error("Напишите комментарий");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("client_comments").insert({
        client_id: clientId,
        sale_id: target === CLIENT_TARGET ? null : target,
        body,
      });
      if (error) {
        toast.error("Не удалось сохранить комментарий: " + error.message);
        return;
      }
      setText("");
      toast.success("Комментарий добавлен");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-2">
      <Textarea
        note
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        maxLength={4000}
        placeholder="Новый комментарий: о чём договорились, когда связаться…"
        aria-label="Новый комментарий"
        autoFocus
        className="field-sizing-content max-h-60 min-h-20"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={target} onValueChange={setPicked}>
          <SelectTrigger className="w-72 max-w-full" aria-label="К чему комментарий">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CLIENT_TARGET}>О клиенте</SelectItem>
            {sales.map((s) => (
              <SelectItem key={s.id} value={s.id} textValue={saleLabel(s)}>
                {saleLabel(s)} · {saleStatusText(s, today)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={saving || !text.trim()}>
          {saving && <Loader2 className="animate-spin" />}
          Добавить
        </Button>
      </div>
    </form>
  );
}

function CommentItem({
  comment: c,
  sale,
  today,
  editable,
  onSaved,
  onDelete,
}: {
  comment: ClientComment;
  sale: CommentSale | null;
  today: string;
  editable: boolean;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className={cn(noteBoxClass, "space-y-1.5")}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{commentAuthor(c)}</span>
          {" · "}
          <span title={commentWhenFull(c.created_at, c.kind)}>
            {commentWhen(c.created_at, c.kind)}
          </span>
          {c.edited_at && <span title={commentWhenFull(c.edited_at)}> · изменён</span>}
        </div>
        {editable && !editing && (
          <div className="-my-1 flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Изменить комментарий"
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Удалить комментарий"
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {c.sale_id ? sale ? <TargetLabel sale={sale} today={today} /> : "Абонемент" : "О клиенте"}
        {c.kind === "sale" && " · при продаже"}
      </div>
      {editing ? (
        <EditComment
          comment={c}
          onDone={() => {
            setEditing(false);
            onSaved();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
      )}
    </li>
  );
}

function EditComment({
  comment,
  onDone,
  onCancel,
}: {
  comment: ClientComment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const body = text.trim();
    if (!body) {
      toast.error("Комментарий не может быть пустым — удалите его");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("client_comments")
        .update({ body })
        .eq("id", comment.id);
      if (error) {
        toast.error("Не удалось сохранить комментарий: " + error.message);
        return;
      }
      toast.success("Комментарий сохранён");
      onDone();
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-2">
      <Textarea
        note
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        maxLength={4000}
        aria-label="Текст комментария"
        autoFocus
        className="field-sizing-content max-h-60 min-h-16"
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Сохранить
        </Button>
      </div>
    </form>
  );
}
