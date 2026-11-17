import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { Panel } from "@/components/crm/channels-settings";
import { StaffAvatar } from "@/components/employee-photo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckboxOption, FormField, InfoNote } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  crmDistributionQuery,
  crmErrorText,
  crmPeopleQuery,
  invalidateCrm,
  removeDistributionStudio,
  saveDistributionStudio,
  setDistributionMode,
  useCrmStudios,
  type DistributionMode,
  type DistributionStudio,
} from "@/lib/crm/data";

const MODES: { value: DistributionMode; label: string }[] = [
  { value: "off", label: "Выключено" },
  { value: "order", label: "По очереди" },
  { value: "random", label: "Случайно" },
];

const MODE_TEXT: Record<DistributionMode, string> = {
  off: "Новая заявка попадает в клуб аккаунта, в который написал клиент, без ответственного (его может назначить правило этапа).",
  order:
    "Новые заявки получают клубы из списка по очереди, внутри клуба — его ответственные по очереди.",
  random: "Новая заявка достаётся случайному клубу из списка и случайному его ответственному.",
};

/**
 * «Распределение новых заявок»: клиент пишет впервые — сделка и диалог
 * достаются клубу и ответственному из списка, по очереди или случайно,
 * в какой бы аккаунт он ни написал.
 */
export function DistributionPanel() {
  const qc = useQueryClient();
  const { data } = useQuery(crmDistributionQuery);
  const { data: studios = [] } = useCrmStudios();
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<DistributionStudio | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const mode = data?.mode ?? "off";
  const rows = data?.studios ?? [];

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: DistributionStudio) => {
    const name = studios.find((s) => s.id === row.studio_id)?.name ?? "клуб";
    if (await confirm({ title: `Убрать «${name}» из распределения?` }))
      await act(() => removeDistributionStudio(row.studio_id));
  };

  return (
    <Panel
      title="Распределение новых заявок"
      action={
        <Button variant="outline" size="xs" onClick={() => setEditing("new")}>
          <Plus />
          Клуб
        </Button>
      }
    >
      <div className="space-y-3 border-b px-3 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            aria-label="Как распределять новые заявки"
            value={mode}
            onChange={(v) => void act(() => setDistributionMode(v))}
            options={MODES}
          />
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-sm text-muted-foreground">{MODE_TEXT[mode]}</p>
        {mode !== "off" && rows.length === 0 && (
          <InfoNote variant="warning">
            Добавьте клубы: пока список пуст, заявки идут в клуб аккаунта, как при выключенном
            распределении.
          </InfoNote>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">Клубы не добавлены.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.studio_id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {studios.find((s) => s.id === row.studio_id)?.name ?? "Клуб"}
                </div>
                {row.user_ids.length === 0 ? (
                  <div className="text-xs text-amber-700">
                    Ответственные не выбраны — сделки придут без ответственного
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {row.user_ids.map((id) => {
                      const p = people.find((x) => x.id === id);
                      return (
                        <span key={id} className="flex items-center gap-1.5 text-xs">
                          <StaffAvatar
                            value={p?.avatar_url ?? null}
                            name={p?.full_name ?? ""}
                            className="size-5 text-[9px]"
                          />
                          {p?.full_name ?? "Нет доступа к CRM"}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Изменить ответственных"
                title="Изменить ответственных"
                onClick={() => setEditing(row)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Убрать клуб из распределения"
                title="Убрать клуб из распределения"
                onClick={() => void remove(row)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <StudioForm
              key={editing === "new" ? "new" : editing.studio_id}
              row={editing === "new" ? null : editing}
              taken={rows.map((r) => r.studio_id)}
              nextOrder={Math.max(0, ...rows.map((r) => r.sort_order)) + 1}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </Panel>
  );
}

function StudioForm({
  row,
  taken,
  nextOrder,
  onDone,
}: {
  row: DistributionStudio | null;
  taken: string[];
  nextOrder: number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data: studios = [] } = useCrmStudios();
  const { data: people = [] } = useQuery(crmPeopleQuery);
  const free = studios.filter((s) => !taken.includes(s.id));
  const [studioId, setStudioId] = useState(row?.studio_id ?? free[0]?.id ?? "");
  const [userIds, setUserIds] = useState<string[]>(row?.user_ids ?? []);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!studioId) {
      toast.error("Выберите клуб");
      return;
    }
    setSaving(true);
    try {
      await saveDistributionStudio({
        studio_id: studioId,
        user_ids: userIds,
        sort_order: row?.sort_order ?? nextOrder,
      });
      await invalidateCrm(qc);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось сохранить"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{row ? "Ответственные клуба" : "Клуб в распределении"}</DialogTitle>
        <DialogDescription>
          Клуб получает свою долю новых заявок, а его ответственные делят их между собой.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Клуб" required>
              {row ? (
                <div className="text-sm font-medium">
                  {studios.find((s) => s.id === row.studio_id)?.name ?? "Клуб"}
                </div>
              ) : free.length === 0 ? (
                <p className="text-sm text-muted-foreground">Все клубы уже в списке.</p>
              ) : (
                <Select value={studioId} onValueChange={setStudioId}>
                  <SelectTrigger aria-label="Клуб">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {free.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField
              label="Ответственные"
              tip="Кому достаются заявки этого клуба. Никого не выбрано — сделки приходят без ответственного. В списке — сотрудники с доступом к CRM."
            >
              <div className="space-y-2">
                {people.map((p) => (
                  <CheckboxOption
                    key={p.id}
                    checked={userIds.includes(p.id)}
                    onCheckedChange={(v) =>
                      setUserIds((ids) => (v ? [...ids, p.id] : ids.filter((x) => x !== p.id)))
                    }
                  >
                    <StaffAvatar
                      value={p.avatar_url}
                      name={p.full_name ?? ""}
                      className="size-5 text-[9px]"
                    />
                    {p.full_name ?? "Без имени"}
                  </CheckboxOption>
                ))}
                {people.length === 0 && (
                  <p className="text-sm text-muted-foreground">Нет сотрудников с доступом к CRM.</p>
                )}
              </div>
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving || (!row && free.length === 0)}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
