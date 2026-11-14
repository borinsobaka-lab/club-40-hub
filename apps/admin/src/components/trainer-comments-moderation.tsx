import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { endOfDay, format, startOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { Ban, Check, Loader2, MessageSquare, Trash2, Undo2 } from "lucide-react";

import type { Studio } from "@/hooks/use-studios";
import { useTrainerComments, type TrainerComment } from "@/hooks/use-trainer-comments";
import { useTableSort } from "@/hooks/use-table-sort";
import { supabase } from "@/integrations/supabase/client";
import { StudioFilter, StudioLabel } from "@/components/studio-label";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableSkeletonRows } from "@/components/skeletons";
import { TableToolbar, ToolbarReset } from "@/components/table-toolbar";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { RowContextMenu, type RowAction } from "@/components/row-context-menu";
import { useConfirm } from "@/components/confirm-dialog";

/**
 * «Обратная связь» → «Комментарии о тренерах» (решение владельца 2026-11-14):
 * комментарии клиентов из карточки тренера в приложении ждут здесь
 * модерации. «Опубликовать» — комментарий появляется в карточке тренера,
 * «Отклонить» — не появляется; решение можно поменять. Текст и автора
 * модератор не правит — это слова клиента; кто и когда принял решение,
 * записывает база. Анонимный — без имени и здесь: база его не хранит.
 * Схема — db/migrations/2026-11-14_client_trainer_comments.sql.
 */

const STATUS: Record<
  TrainerComment["status"],
  { label: string; tone: "warning" | "positive" | "neutral" }
> = {
  pending: { label: "На модерации", tone: "warning" },
  approved: { label: "Опубликован", tone: "positive" },
  rejected: { label: "Отклонён", tone: "neutral" },
};

const STATUS_RANK: Record<TrainerComment["status"], number> = {
  pending: 0,
  approved: 1,
  rejected: 2,
};

function authorLabel(c: TrainerComment) {
  return c.is_anonymous ? "Анонимно" : c.author_name || "Клиент";
}

const SORT_GETTERS = {
  createdAt: (c: TrainerComment) => c.created_at,
  trainer: (c: TrainerComment) => c.trainers?.full_name,
  message: (c: TrainerComment) => c.message,
  author: (c: TrainerComment) => authorLabel(c),
  status: (c: TrainerComment) => STATUS_RANK[c.status],
  moderatedBy: (c: TrainerComment) => c.moderated_by_name,
};

export function TrainerCommentsModeration({ studios }: { studios: Studio[] | null }) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const multi = (studios?.length ?? 0) > 1;
  const studioOf = (id: string | null) => studios?.find((s) => s.id === id) ?? null;

  const { data: items = [], isLoading } = useTrainerComments(studios);
  const loading = studios === null || isLoading;
  const reload = () => queryClient.invalidateQueries({ queryKey: ["client-trainer-comments"] });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [studioFilter, setStudioFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [trainerFilter, setTrainerFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const trainers = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of items) map.set(c.trainer_id, c.trainers?.full_name ?? "—");
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((c) => {
        if (studioFilter !== "all" && c.studio_id !== studioFilter) return false;
        if (statusFilter !== "all" && c.status !== statusFilter) return false;
        if (trainerFilter !== "all" && c.trainer_id !== trainerFilter) return false;
        const created = new Date(c.created_at);
        if (dateRange?.from && created < startOfDay(dateRange.from)) return false;
        if (dateRange?.to && created > endOfDay(dateRange.to)) return false;
        return true;
      }),
    [items, studioFilter, statusFilter, trainerFilter, dateRange],
  );

  const sort = useTableSort({
    ...SORT_GETTERS,
    studio: (c: TrainerComment) => studioOf(c.studio_id)?.name,
  });
  // Без сортировки по колонке — на модерации сверху, новые первыми.
  const ordered = sort.apply(
    [...filtered].sort(
      (a, b) =>
        Number(a.status !== "pending") - Number(b.status !== "pending") ||
        b.created_at.localeCompare(a.created_at),
    ),
  );
  const pg = usePagination(ordered, undefined, sort.key);

  const selected = items.find((c) => c.id === selectedId) ?? null;
  const pendingCount = items.filter((c) => c.status === "pending").length;
  const approvedCount = items.filter((c) => c.status === "approved").length;
  const rejectedCount = items.filter((c) => c.status === "rejected").length;

  const setStatus = async (c: TrainerComment, status: TrainerComment["status"]) => {
    const { error } = await supabase
      .from("client_trainer_comments")
      .update({ status })
      .eq("id", c.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(
      status === "approved"
        ? "Опубликовано в карточке тренера"
        : status === "rejected"
          ? c.status === "approved"
            ? "Снято с публикации"
            : "Отклонено"
          : "Возвращено на модерацию",
    );
    reload();
    return true;
  };

  const handleDelete = async (c: TrainerComment) => {
    if (
      !(await confirm({
        title: "Удалить комментарий?",
        description:
          "Он исчезнет и из карточки тренера, и отсюда. Чтобы просто скрыть его — «Отклонить».",
      }))
    )
      return;
    const { error } = await supabase.from("client_trainer_comments").delete().eq("id", c.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (selectedId === c.id) setSelectedId(null);
    reload();
    toast.success("Удалено");
  };

  const rowActions = (c: TrainerComment): RowAction[] => [
    { label: "Открыть комментарий", icon: MessageSquare, onSelect: () => setSelectedId(c.id) },
    ...(c.status !== "approved"
      ? [{ label: "Опубликовать", icon: Check, onSelect: () => void setStatus(c, "approved") }]
      : []),
    ...(c.status !== "rejected"
      ? [
          {
            label: c.status === "approved" ? "Снять с публикации" : "Отклонить",
            icon: Ban,
            onSelect: () => void setStatus(c, "rejected"),
          },
        ]
      : []),
    { label: "Удалить", icon: Trash2, destructive: true, onSelect: () => handleDelete(c) },
  ];

  const hasFilters =
    studioFilter !== "all" || statusFilter !== "all" || trainerFilter !== "all" || !!dateRange;
  const columns = multi ? 7 : 6;

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-lg border bg-background" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="На модерации"
            value={pendingCount}
            tone={pendingCount > 0 ? "negative" : "default"}
          />
          <StatTile label="Опубликовано" value={approvedCount} />
          <StatTile label="Отклонено" value={rejectedCount} />
        </div>
      )}

      <TableToolbar>
        {multi && studios && (
          <StudioFilter studios={studios} value={studioFilter} onChange={setStudioFilter} />
        )}
        <Select value={trainerFilter} onValueChange={setTrainerFilter}>
          <SelectTrigger aria-label="Тренер" className="w-52">
            <SelectValue placeholder="Все тренеры" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все тренеры</SelectItem>
            {trainers.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Статус" className="w-44">
            <SelectValue placeholder="Все статусы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeFilter
          placeholder="Дата"
          title="Дата комментария"
          value={dateRange}
          onChange={setDateRange}
          className="w-48"
        />
        <ToolbarReset
          active={hasFilters}
          onReset={() => {
            setStudioFilter("all");
            setStatusFilter("all");
            setTrainerFilter("all");
            setDateRange(undefined);
          }}
        />
      </TableToolbar>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead {...sort.head("createdAt")}>Дата</TableHead>
              <TableHead {...sort.head("trainer")}>Тренер</TableHead>
              <TableHead {...sort.head("message")}>Комментарий</TableHead>
              <TableHead {...sort.head("author")}>Автор</TableHead>
              {multi && <TableHead {...sort.head("studio")}>Клуб</TableHead>}
              <TableHead {...sort.head("status")}>Статус</TableHead>
              <TableHead {...sort.head("moderatedBy")}>Проверил</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={columns} />
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                  Комментариев нет. Клиенты оставляют их в карточке тренера в приложении.
                </TableCell>
              </TableRow>
            ) : (
              pg.paged.map((c) => (
                <RowContextMenu key={c.id} actions={rowActions(c)}>
                  <TableRow onClick={() => setSelectedId(c.id)} className="cursor-pointer">
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {format(new Date(c.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      {c.trainers?.full_name ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate">{c.message}</TableCell>
                    <TableCell
                      className={
                        c.is_anonymous
                          ? "whitespace-nowrap italic text-muted-foreground"
                          : "whitespace-nowrap"
                      }
                    >
                      {authorLabel(c)}
                    </TableCell>
                    {multi && (
                      <TableCell>
                        <StudioLabel studio={studioOf(c.studio_id)} />
                      </TableCell>
                    )}
                    <TableCell>
                      <StatusChip tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusChip>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {c.moderated_by_name || c.moderated_at ? (
                        <>
                          {c.moderated_by_name || "—"}
                          {c.moderated_at && (
                            <div>
                              {format(new Date(c.moderated_at), "dd.MM.yy", { locale: ru })}
                            </div>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                </RowContextMenu>
              ))
            )}
          </TableBody>
        </Table>
        <DataPagination {...pg} loading={loading} />
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <CommentDetails
              key={selected.id}
              item={selected}
              studio={multi ? studioOf(selected.studio_id) : null}
              onClose={() => setSelectedId(null)}
              onStatus={async (status) => {
                if (await setStatus(selected, status)) setSelectedId(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}

function CommentDetails({
  item,
  studio,
  onClose,
  onStatus,
}: {
  item: TrainerComment;
  studio: Studio | null;
  onClose: () => void;
  onStatus: (status: TrainerComment["status"]) => Promise<void>;
}) {
  const [busy, setBusy] = useState<TrainerComment["status"] | null>(null);
  const run = async (status: TrainerComment["status"]) => {
    setBusy(status);
    try {
      await onStatus(status);
    } finally {
      setBusy(null);
    }
  };
  const spinner = (s: TrainerComment["status"]) =>
    busy === s ? <Loader2 className="animate-spin" /> : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Комментарий о тренере</DialogTitle>
        <DialogDescription>
          {format(new Date(item.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}
          {studio && ` · ${studio.name}`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Тренер</div>
            <div className="font-medium">{item.trainers?.full_name ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Автор</div>
            <div className="font-medium">{authorLabel(item)}</div>
            {!item.is_anonymous && item.author_public && (
              <div className="text-xs text-muted-foreground">В карточке: {item.author_public}</div>
            )}
          </div>
        </div>
        <div className="text-sm">
          <div className="text-muted-foreground">Комментарий</div>
          <p className="mt-1 whitespace-pre-wrap break-words">{item.message}</p>
        </div>
        <InfoNote className="space-y-1">
          <p className="font-medium">
            <StatusChip tone={STATUS[item.status].tone}>{STATUS[item.status].label}</StatusChip>
          </p>
          <p className="text-sm text-foreground">
            {item.status === "pending"
              ? "Клиенты увидят комментарий в карточке тренера, когда вы его опубликуете."
              : item.status === "approved"
                ? "Комментарий виден клиентам в карточке тренера."
                : "Комментарий не показывается в приложении."}
          </p>
          {item.moderated_at && (
            <p className="text-sm text-muted-foreground">
              {item.moderated_by_name || "—"} ·{" "}
              {format(new Date(item.moderated_at), "d MMM yyyy", { locale: ru })}
            </p>
          )}
        </InfoNote>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={!!busy}>
          Закрыть
        </Button>
        {item.status === "approved" ? (
          <Button variant="outline" onClick={() => run("rejected")} disabled={!!busy}>
            {spinner("rejected") ?? <Undo2 />}
            Снять с публикации
          </Button>
        ) : (
          <>
            {item.status === "pending" && (
              <Button variant="outline" onClick={() => run("rejected")} disabled={!!busy}>
                {spinner("rejected") ?? <Ban />}
                Отклонить
              </Button>
            )}
            <Button onClick={() => run("approved")} disabled={!!busy}>
              {spinner("approved") ?? <Check />}
              Опубликовать
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
