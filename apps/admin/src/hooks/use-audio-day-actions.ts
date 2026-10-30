import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import type { RowAction } from "@/components/row-context-menu";
import { aaRpc, invalidateAudio } from "@/lib/audio/data";
import { DAY_ACTION_TEXT } from "@/lib/audio/labels";
import { dayActions } from "@/lib/audio/logic";
import type { AaStatus } from "@/lib/audio/types";

export type DayAction = "process" | "recalc" | "full" | "finish" | "delete";

/**
 * Действия со сменой (право «настройки»): разбор запускается вручную —
 * платить за пустые дни и проверки оборудования незачем; пересчёт и новое
 * распознавание стоят денег, удаление необратимо — всё с подтверждением.
 */
export function useDayActions() {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, action: DayAction, opts: { label?: string } = {}) => {
    const what = opts.label ? ` «${opts.label}»` : "";
    if (action === "recalc") {
      const ok = await confirm({
        title: "Пересчитать смену?",
        description:
          "Расшифровка берётся с прошлого разбора — за распознавание речи второй раз платить не нужно, но обращения к модели (деление на диалоги, оценки по метрикам, итог смены) оплачиваются заново. Прежние оценки и итог заменятся новыми; голоса «согласен / не согласен» этой смены пропадут вместе со старыми оценками, договорённости останутся без ссылки на разговор.",
        confirmLabel: "Пересчитать",
        destructive: false,
      });
      if (!ok) return false;
    }
    if (action === "full") {
      const ok = await confirm({
        title: "Распознать речь заново?",
        description:
          "Запись будет заново отправлена на распознавание речи — это платно и дольше обычного пересчёта. Нужно, только если расшифровка получилась плохой. Модель тоже оплачивается заново, голоса «согласен / не согласен» этой смены пропадут.",
        confirmLabel: "Распознать заново",
        destructive: false,
      });
      if (!ok) return false;
    }
    if (action === "finish") {
      const ok = await confirm({
        title: "Завершить смену принудительно?",
        description:
          "Приложение не закрыло смену само (ноутбук закрыли, программа вылетела). Смена закроется с тем, что успело загрузиться, и будет ждать разбора.",
        confirmLabel: "Завершить",
        destructive: false,
      });
      if (!ok) return false;
    }
    if (action === "delete") {
      const first = await confirm({
        title: `Удалить смену${what}?`,
        description:
          "Смена стирается целиком: аудио, расшифровка, разбор, отзывы и договорённости. Вернуть её нельзя.",
        confirmLabel: "Далее",
      });
      if (!first) return false;
      const second = await confirm({
        title: "Точно удалить навсегда?",
        description: "Аудиозапись смены будет стёрта из хранилища — восстановить её невозможно.",
        confirmLabel: "Удалить навсегда",
      });
      if (!second) return false;
    }
    setBusyId(id);
    try {
      if (action === "process" || action === "recalc" || action === "full")
        await aaRpc("aa_recording_process", { p_id: id, p_full: action === "full" });
      if (action === "finish") await aaRpc("aa_recording_force_finish", { p_id: id });
      if (action === "delete") await aaRpc("aa_recording_delete", { p_id: id });
      toast.success(
        action === "delete"
          ? "Смена удалена, аудио сотрётся из хранилища в ближайшие минуты"
          : action === "finish"
            ? "Смена закрыта и ждёт разбора — нажмите «Обработать»"
            : action === "full"
              ? "Поставлено в очередь: речь распознается заново — это займёт дольше обычного"
              : "Смена поставлена в очередь на разбор — займёт несколько минут",
      );
      await invalidateAudio(qc);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выполнить действие");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  /** Пункты меню строки смены по статусу. */
  const rowActions = (
    day: { id: string; status: AaStatus; stale: boolean },
    label?: string,
  ): RowAction[] => {
    const a = dayActions(day.status, day.stale);
    const busy = busyId === day.id;
    const list: RowAction[] = [];
    if (a.process)
      list.push({
        label: a.process === "restart" ? DAY_ACTION_TEXT.restart : DAY_ACTION_TEXT.process,
        icon: Play,
        disabled: busy,
        onSelect: () => void run(day.id, "process"),
      });
    if (a.recalc)
      list.push({
        label: DAY_ACTION_TEXT.recalc,
        icon: RefreshCw,
        disabled: busy,
        onSelect: () => void run(day.id, "recalc"),
      });
    if (a.full)
      list.push({
        label: DAY_ACTION_TEXT.full,
        icon: Mic,
        disabled: busy,
        onSelect: () => void run(day.id, "full"),
      });
    if (a.forceFinish)
      list.push({
        label: DAY_ACTION_TEXT.finish,
        icon: Square,
        disabled: busy,
        onSelect: () => void run(day.id, "finish"),
      });
    if (a.remove)
      list.push({
        label: DAY_ACTION_TEXT.delete,
        icon: Trash2,
        destructive: true,
        disabled: busy,
        onSelect: () => void run(day.id, "delete", { label }),
      });
    return list;
  };

  return { run, busyId, rowActions, confirmDialog };
}
