import { cn } from "@/lib/utils";
import { ChoiceCard } from "@/components/ui/choice-card";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SALE_KIND_DESCRIPTION,
  SALE_KIND_DOT,
  SALE_KIND_LABEL,
  SALE_KIND_TINT,
  SALE_KINDS,
  type SaleKind,
} from "@/lib/payments";

/** Цветной кружок типа продажи пакетного клуба. */
export function SaleKindDot({ kind }: { kind: SaleKind }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2.5 shrink-0 rounded-full", SALE_KIND_DOT[kind])}
    />
  );
}

/**
 * Выбор типа продажи (пакетный клуб, «Абонементы») — плитки с цветными
 * кружками, как тип занятия в «Расписании»; дальше форма продажи.
 */
export function SaleKindPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (kind: SaleKind) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Какая продажа?</DialogTitle>
          <DialogDescription>Выберите тип продажи.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SALE_KINDS.map((k) => (
              <ChoiceCard
                key={k}
                onClick={() => onPick(k)}
                media={
                  <span
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-xl",
                      SALE_KIND_TINT[k],
                    )}
                  >
                    <span className={cn("size-3.5 rounded-full", SALE_KIND_DOT[k])} />
                  </span>
                }
                title={SALE_KIND_LABEL[k]}
                description={SALE_KIND_DESCRIPTION[k]}
              />
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
