import { useEffect, useRef, useState } from "react";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Plus } from "lucide-react";

import { StaffAvatar } from "@/components/employee-photo";
import { Button } from "@/components/ui/button";
import { ageLabel, sumBudget } from "@/lib/crm/logic";
import type { CrmDeal, CrmPerson, CrmStage } from "@/lib/crm/types";
import { formatMoney, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TaskDue } from "./parts";

const DRAG_TYPE = "crm-deal";

/**
 * Канбан воронки: колонка на этап (число сделок и сумма бюджета), карточки
 * перетаскиваются между этапами. На телефоне — прокрутка вбок, этап сделки
 * меняется в её карточке.
 */
export function Kanban({
  stages,
  dealsByStage,
  nextTask,
  people,
  studioNames,
  now,
  onOpen,
  onMove,
  onAdd,
}: {
  stages: CrmStage[];
  dealsByStage: Map<string, CrmDeal[]>;
  /** Срок ближайшей невыполненной задачи сделки. */
  nextTask: Map<string, string>;
  people: Map<string, CrmPerson>;
  studioNames: Map<string, string>;
  now: Date;
  onOpen: (dealId: string) => void;
  onMove: (deal: CrmDeal, stage: CrmStage) => void;
  onAdd: (stageId: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {stages.map((stage) => (
        <Column
          key={stage.id}
          stage={stage}
          deals={dealsByStage.get(stage.id) ?? []}
          onMove={onMove}
          onAdd={onAdd}
        >
          {(dealsByStage.get(stage.id) ?? []).map((deal) => (
            <DealTile
              key={deal.id}
              deal={deal}
              due={nextTask.get(deal.id)}
              person={deal.responsible_id ? people.get(deal.responsible_id) : undefined}
              studioName={deal.studio_id ? studioNames.get(deal.studio_id) : undefined}
              closed={stage.kind !== "open"}
              now={now}
              onOpen={onOpen}
            />
          ))}
        </Column>
      ))}
    </div>
  );
}

function Column({
  stage,
  deals,
  onMove,
  onAdd,
  children,
}: {
  stage: CrmStage;
  deals: CrmDeal[];
  onMove: (deal: CrmDeal, stage: CrmStage) => void;
  onAdd: (stageId: string) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState(false);
  const latest = useRef({ onMove, stage });
  latest.current = { onMove, stage };

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) =>
        source.data.type === DRAG_TYPE && source.data.stageId !== latest.current.stage.id,
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false);
        latest.current.onMove(source.data.deal as CrmDeal, latest.current.stage);
      },
    });
  }, []);

  const total = sumBudget(deals);
  return (
    <section
      ref={ref}
      aria-label={stage.name}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg border bg-background transition-colors",
        over && "border-brand bg-brand/5",
      )}
    >
      <header
        className="rounded-t-lg border-b px-3 py-2"
        style={{ borderTop: `3px solid ${stage.color}` }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold" title={stage.name}>
            {stage.name}
          </h2>
          {stage.kind === "open" && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mr-1.5"
              aria-label={`Новая сделка в этапе «${stage.name}»`}
              onClick={() => onAdd(stage.id)}
            >
              <Plus />
            </Button>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {deals.length} {plural(deals.length)}
          {total > 0 ? ` · ${formatMoney(total)}` : ""}
          {stage.kind !== "open" ? " · за 30 дней" : ""}
        </div>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">{children}</div>
    </section>
  );
}

function plural(n: number) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return "сделка";
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "сделки";
  return "сделок";
}

function DealTile({
  deal,
  due,
  person,
  studioName,
  closed,
  now,
  onOpen,
}: {
  deal: CrmDeal;
  due: string | undefined;
  person: CrmPerson | undefined;
  studioName: string | undefined;
  closed: boolean;
  now: Date;
  onOpen: (dealId: string) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(deal);
  latest.current = deal;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return draggable({
      element,
      getInitialData: () => ({
        type: DRAG_TYPE,
        deal: latest.current,
        stageId: latest.current.stage_id,
      }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, []);

  const contact = deal.contact;
  const showContact = contact && contact.name !== deal.title;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(deal.id)}
      className={cn(
        "w-full cursor-pointer rounded-md border bg-background p-2.5 text-left shadow-xs transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm leading-snug font-medium break-words">{deal.title}</span>
        {deal.budget !== null && deal.budget > 0 && (
          <span className="shrink-0 text-sm font-medium tabular-nums">
            {formatMoney(deal.budget)}
          </span>
        )}
      </div>
      {(showContact || contact?.phone) && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {[showContact ? contact.name : null, contact?.phone ? formatPhone(contact.phone) : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {(deal.tags.length > 0 || contact?.client_id) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {contact?.client_id && (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">
              клиент
            </span>
          )}
          {deal.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {closed ? (
          <span className="text-xs text-muted-foreground">
            {ageLabel(deal.stage_entered_at, now)} назад
          </span>
        ) : due ? (
          <TaskDue dueAt={due} now={now} />
        ) : (
          <span className="text-xs font-medium text-amber-600">нет задач</span>
        )}
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {studioName && <span className="truncate">{studioName}</span>}
          {person && (
            <StaffAvatar
              value={person.avatar_url}
              name={person.full_name ?? ""}
              className="size-5 text-[9px]"
            />
          )}
        </span>
      </div>
    </button>
  );
}
