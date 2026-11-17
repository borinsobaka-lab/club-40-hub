import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";

import { StaffAvatar } from "@/components/employee-photo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { crmPeopleQuery } from "@/lib/crm/data";
import { formatDue, NONE, taskState } from "@/lib/crm/logic";
import type { CrmStage } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

/** Ответственный: люди с правами CRM, «Не назначен» — первым. */
export function PersonSelect({
  value,
  onChange,
  noneLabel = "Не назначен",
  allLabel,
  className,
  "aria-label": ariaLabel = "Ответственный",
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  noneLabel?: string;
  /** Фильтр: первым пунктом «Все» (значение ""). */
  allLabel?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const current =
    allLabel !== undefined ? (value === null ? NONE : value || "all") : (value ?? NONE);
  return (
    <Select
      value={current}
      onValueChange={(v) => onChange(v === NONE ? null : v === "all" ? "" : v)}
    >
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allLabel !== undefined && <SelectItem value="all">{allLabel}</SelectItem>}
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {people.map((p) => (
          <SelectItem key={p.id} value={p.id} textValue={p.full_name ?? "Без имени"}>
            <span className="flex items-center gap-2">
              <StaffAvatar
                value={p.avatar_url}
                name={p.full_name ?? ""}
                className="size-5 text-[10px]"
              />
              {p.full_name ?? "Без имени"}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Клуб сделки; «Без клуба» — первым. */
export function StudioPick({
  value,
  onChange,
  studios,
  allLabel,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  studios: { id: string; name: string }[];
  allLabel?: string;
  className?: string;
}) {
  const current =
    allLabel !== undefined ? (value === null ? NONE : value || "all") : (value ?? NONE);
  return (
    <Select
      value={current}
      onValueChange={(v) => onChange(v === NONE ? null : v === "all" ? "" : v)}
    >
      <SelectTrigger aria-label="Клуб" className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allLabel !== undefined && <SelectItem value="all">{allLabel}</SelectItem>}
        <SelectItem value={NONE}>Без клуба</SelectItem>
        {studios.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StageDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** Этап воронки. */
export function StageSelect({
  stages,
  value,
  onChange,
  className,
}: {
  stages: CrmStage[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Этап" className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {stages.map((s) => (
          <SelectItem key={s.id} value={s.id} textValue={s.name}>
            <span className="flex items-center gap-2">
              <StageDot color={s.color} />
              {s.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Срок задачи: просрочена — красным, на сегодня — янтарным. */
export function TaskDue({
  dueAt,
  now,
  className,
}: {
  dueAt: string;
  now: Date;
  className?: string;
}) {
  const state = taskState(dueAt, now);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs whitespace-nowrap",
        state === "overdue"
          ? "font-medium text-destructive"
          : state === "today"
            ? "font-medium text-amber-600"
            : "text-muted-foreground",
        className,
      )}
    >
      <Clock className="size-3.5" />
      {state === "overdue" ? "просрочено · " : ""}
      {formatDue(dueAt, now)}
    </span>
  );
}
