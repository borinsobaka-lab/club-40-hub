import { useNavigate } from "@tanstack/react-router";
import { CheckCircle, PenNewSquare } from "@solar-icons/react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { DiagnosticState } from "./data";

/**
 * «Заполнить» под карточкой диагностики в «Моём расписании» тренера
 * (решение владельца 2026-11-27): по клиенту — кнопка формы; заполнено —
 * зелёное «Диагностика заполнена» и «Изменить». Несколько записанных — строка
 * на каждого с именем. Срок правки прошёл (14 дней) — только отметка.
 */
export function DiagnosticFillFooter({ state }: { state: DiagnosticState | undefined }) {
  const t = useT();
  const navigate = useNavigate();
  if (!state || state.clients.length === 0) return null;
  const many = state.clients.length > 1;
  const open = (client: string) =>
    navigate({ to: "/trainer-diagnostic", search: { entry: state.entry_id, client } });

  return (
    <div className="space-y-2">
      {state.clients.map((c) => {
        const filled = !!c.diagnostic_id;
        return (
          <div key={c.client_id} className="flex items-center gap-3">
            {filled ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-5 w-5 shrink-0" weight="Bold" />
                <span className="truncate">
                  {many
                    ? t("Заполнено: {name}", { name: c.name ?? "" })
                    : t("Диагностика заполнена")}
                </span>
              </div>
            ) : (
              many && <div className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</div>
            )}
            {state.editable && (
              <Button
                className={cn(
                  filled || many ? "shrink-0 px-5" : "w-full",
                  filled && "bg-muted text-foreground hover:bg-muted/80",
                )}
                onClick={() => open(c.client_id)}
              >
                {!filled && <PenNewSquare className="h-5 w-5" weight="BoldDuotone" />}
                {filled ? t("Изменить") : t("Заполнить")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
