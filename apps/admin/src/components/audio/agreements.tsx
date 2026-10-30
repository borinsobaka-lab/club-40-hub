import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { AaCard } from "@/components/audio/parts";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { aaRpc, invalidateAudio } from "@/lib/audio/data";
import { AGREEMENT_STATUS_LABEL, DIALOG_TYPE_LABEL } from "@/lib/audio/labels";
import { AGREEMENT_TONE, clockTime, formatOffset } from "@/lib/audio/logic";
import type { AaAgreement, AaAgreementStatus, AaDialog } from "@/lib/audio/types";
import { formatDate, formatDateTime } from "@/lib/format";

export function AgreementStatusBadge({ status }: { status: AaAgreementStatus }) {
  return <StatusChip tone={AGREEMENT_TONE[status]}>{AGREEMENT_STATUS_LABEL[status]}</StatusChip>;
}

/**
 * «Сделали?»: итог договорённости — выполнено, не выполнено, снято (с
 * пояснением). Ставит только тот, кто видит все смены: иначе «выполнено»
 * ставил бы себе тот, кого проверяют. `resolvedRecordingId` — смена, на
 * которой проверили.
 */
export function AgreementResolve({
  agreement,
  resolvedRecordingId,
}: {
  agreement: AaAgreement;
  resolvedRecordingId?: string;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState(agreement.resolution_note);
  const [busy, setBusy] = useState<AaAgreementStatus | null>(null);

  const mark = async (status: AaAgreementStatus) => {
    setBusy(status);
    try {
      await aaRpc("aa_agreement_update", {
        p_id: agreement.id,
        p_status: status,
        p_note: note.trim(),
        p_resolved_recording_id: status === "open" ? null : (resolvedRecordingId ?? null),
      });
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отметить договорённость");
    } finally {
      setBusy(null);
    }
  };

  if (agreement.status !== "open")
    return (
      <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => void mark("open")}>
        {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
        Вернуть в проверку
      </Button>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={note}
        maxLength={2000}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Пояснение (необязательно)"
        aria-label="Пояснение к итогу"
        className="max-w-72 min-w-40 flex-1"
      />
      <Button size="xs" variant="success" disabled={!!busy} onClick={() => void mark("done")}>
        {busy === "done" ? <Loader2 className="animate-spin" /> : <Check />}
        Выполнено
      </Button>
      <Button size="xs" variant="destructive" disabled={!!busy} onClick={() => void mark("missed")}>
        {busy === "missed" ? <Loader2 className="animate-spin" /> : <X />}
        Не выполнено
      </Button>
      <Button
        size="xs"
        variant="outline"
        disabled={!!busy}
        title="Договорённость потеряла смысл"
        onClick={() => void mark("cancelled")}
      >
        Снять
      </Button>
    </div>
  );
}

/** Подпись итога: кто, когда, на какой смене, пояснение. */
export function AgreementResolution({ a }: { a: AaAgreement }) {
  if (a.status === "open") return null;
  return (
    <span className="text-xs text-muted-foreground">
      {a.resolved_by_name && `${a.resolved_by_name}, `}
      {a.resolved_at && formatDateTime(a.resolved_at)}
      {a.resolved_recording_id && (
        <>
          {" · "}
          <Link
            to="/audio/$recordingId"
            params={{ recordingId: a.resolved_recording_id }}
            className="text-link hover:text-link-hover hover:underline"
          >
            смена проверки
          </Link>
        </>
      )}
      {a.resolution_note && <span className="text-foreground"> · {a.resolution_note}</span>}
    </span>
  );
}

/**
 * «С прошлой смены»: договорённости этого менеджера с прошлых смен. Разбор
 * начинается с проверки того, о чём договорились в прошлый раз, — блок выше
 * итогов дня.
 */
export function CarriedAgreements({
  items,
  recordingId,
  canResolve,
}: {
  items: AaAgreement[];
  recordingId: string;
  canResolve: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <AaCard
      title="С прошлых смен — сделали?"
      hint="о чём договорились в прошлый раз — проверьте перед разбором"
      className="border-amber-200"
    >
      <ul className="divide-y">
        {items.map((a) => (
          <li key={a.id} className="space-y-1.5 py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <AgreementStatusBadge status={a.status} />
              <span className="text-sm">{a.text}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              <Link
                to="/audio/$recordingId"
                params={{ recordingId: a.recording_id }}
                search={a.dialog_id ? { dialog: a.dialog_id } : {}}
                className="text-link hover:text-link-hover hover:underline"
              >
                смена {formatDate(a.day_date)}
                {a.dialog_start_s != null && ` · разговор ${formatOffset(a.dialog_start_s)}`}
              </Link>
              {a.created_by_name && ` · записал ${a.created_by_name}`}
            </div>
            {canResolve ? (
              <AgreementResolve agreement={a} resolvedRecordingId={recordingId} />
            ) : (
              <AgreementResolution a={a} />
            )}
            {canResolve && a.status !== "open" && <AgreementResolution a={a} />}
          </li>
        ))}
      </ul>
    </AaCard>
  );
}

/** Договорённости этой смены и «Записать договорённость». */
export function DayAgreements({
  items,
  recordingId,
  dialogs,
  startedAt,
  timeZone,
  canResolve,
  myId,
}: {
  items: AaAgreement[];
  recordingId: string;
  dialogs: AaDialog[];
  startedAt: string;
  timeZone: string;
  canResolve: boolean;
  myId: string | null;
}) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [text, setText] = useState("");
  const [dialogId, setDialogId] = useState("none");
  const [saving, setSaving] = useState(false);
  const linkable = dialogs.filter((d) => d.type !== "irrelevant");

  const add = async () => {
    if (!text.trim()) {
      toast.error("Напишите, о чём договорились");
      return;
    }
    setSaving(true);
    try {
      await aaRpc("aa_agreement_create", {
        p_recording_id: recordingId,
        p_text: text.trim(),
        p_dialog_id: dialogId === "none" ? null : dialogId,
      });
      setText("");
      setDialogId("none");
      await invalidateAudio(qc);
      toast.success("Договорённость записана — всплывёт в следующей смене менеджера");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось записать договорённость");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: AaAgreement) => {
    if (!(await confirm({ title: "Удалить договорённость?", description: a.text }))) return;
    try {
      await aaRpc("aa_agreement_delete", { p_id: a.id });
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  return (
    <AaCard
      title="Договорённости"
      tip="Одна конкретная вещь, которую менеджер сделает в следующую смену: она сама всплывёт в отчёте его следующей смены с вопросом «Сделали?»."
      hint="всплывут в следующей смене этого менеджера"
    >
      <div className="space-y-3">
        {items.length === 0 ? (
          <InfoNote variant="empty">Пока ничего не записано.</InfoNote>
        ) : (
          <ul className="divide-y">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-2 py-2 first:pt-0">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <AgreementStatusBadge status={a.status} />
                    <span className="text-sm">{a.text}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.created_by_name && `записал ${a.created_by_name}`}
                    {a.dialog_start_s != null &&
                      ` · разговор в ${clockTime(startedAt, a.dialog_start_s, timeZone)}`}
                  </div>
                  <AgreementResolution a={a} />
                </div>
                {a.status === "open" && (canResolve || a.created_by === myId) && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Удалить договорённость"
                    title="Удалить"
                    onClick={() => void remove(a)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            placeholder="Например: в каждом разговоре спрашивать про цель занятий"
            aria-label="О чём договорились"
            className="min-w-56 flex-1"
          />
          {linkable.length > 0 && (
            <Select value={dialogId} onValueChange={setDialogId}>
              <SelectTrigger aria-label="По разговору" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без разговора</SelectItem>
                {linkable.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {clockTime(startedAt, d.start_s, timeZone)} · {DIALOG_TYPE_LABEL[d.type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Записать договорённость
          </Button>
        </form>
      </div>
      {confirmDialog}
    </AaCard>
  );
}
