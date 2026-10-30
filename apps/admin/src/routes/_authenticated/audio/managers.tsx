import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { PersonPicker } from "@/components/audio/person-picker";
import { useAudioPeople } from "@/hooks/use-audio-people";
import { useConfirm } from "@/components/confirm-dialog";
import { AudioManagersPageSkeleton } from "@/components/page-skeletons";
import { PersonChip } from "@/components/people/person-card";
import { RowContextMenu } from "@/components/row-context-menu";
import { TableSkeletonRows } from "@/components/skeletons";
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
import { FormField, InfoNote, SwitchRow } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/use-table-sort";
import { supabase } from "@/integrations/supabase/client";
import { aaManagersQuery, aaWrite, invalidateAudio } from "@/lib/audio/data";
import { AUDIO_TITLES, MANAGERS_COLUMNS } from "@/lib/audio/labels";
import type { AaManager } from "@/lib/audio/types";
import { usePersonShort } from "@/lib/people";
import { sortRows } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/audio/managers")({
  head: () => ({ meta: [{ title: "Менеджеры — Аудиоаналитика — Base40 Admin" }] }),
  pendingComponent: AudioManagersPageSkeleton,
  component: ManagersPage,
});

const OWN_HINT =
  "Учётная запись нужна для права «Аудиоаналитика: свои смены» (выдаётся в «Пользователях и ролях»): человек с этим правом видит только смены, где менеджер — связанный с ним. Без связи менеджер — просто имя в приложении записи.";

const TIPS = {
  name: "Имя в списке приложения на ресепшене: менеджер выбирает себя перед началом смены, отчёт подписывается им.",
  user: OWN_HINT,
  status: "Отключённый менеджер исчезает из списка приложения, но остаётся автором прошлых смен.",
};

/**
 * Менеджеры — имена в приложении записи. Менеджер выбирает себя перед
 * началом смены; связь с учётной записью портала даёт ему право видеть свои
 * смены. Доступ (права) выдаётся ролями в «Пользователях и ролях».
 */
function ManagersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(aaManagersQuery);
  const [edit, setEdit] = useState<AaManager | "new" | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const sort = useTableSort();
  const rows = sortRows(data ?? [], sort.sort, {
    name: (m) => m.full_name,
    status: (m) => (m.active ? 0 : 1),
  });
  const keys = ["name", null, "status"];
  const active = (data ?? []).filter((m) => m.active).length;

  const save = async (m: AaManager, patch: Partial<AaManager>, message?: string) => {
    try {
      await aaWrite(supabase.from("aa_managers").update(patch).eq("id", m.id));
      await invalidateAudio(qc);
      if (message) toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  const remove = async (m: AaManager) => {
    const ok = await confirm({
      title: `Удалить менеджера «${m.full_name}»?`,
      description:
        "Его прошлые смены останутся, но без имени («менеджер не указан»), а договорённости потеряют связь. Чтобы убрать менеджера из приложения и сохранить историю, — отключите его.",
      confirmLabel: "Удалить",
    });
    if (!ok) return;
    try {
      await aaWrite(supabase.from("aa_managers").delete().eq("id", m.id));
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  return (
    <AdminShell
      title={AUDIO_TITLES.managers}
      actions={
        <Button onClick={() => setEdit("new")}>
          <Plus />
          Добавить менеджера
        </Button>
      }
    >
      <div className="space-y-3">
        <InfoNote variant="muted">{OWN_HINT}</InfoNote>
        {data && data.length > 0 && active === 0 && (
          <InfoNote variant="warning">
            Нет ни одного активного менеджера — приложение на ресепшене не сможет предложить выбор
            перед началом смены.
          </InfoNote>
        )}
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                {MANAGERS_COLUMNS.map((c, i) => (
                  <TableHead
                    key={c}
                    tip={[TIPS.name, TIPS.user, TIPS.status][i]}
                    {...(keys[i] ? sort.head(keys[i]!) : {})}
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeletonRows columns={MANAGERS_COLUMNS.length} rows={4} />
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={MANAGERS_COLUMNS.length}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Менеджеров нет. Добавьте тех, кто работает у стойки, — их имена появятся в
                    приложении записи.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((m) => (
                  <RowContextMenu
                    key={m.id}
                    actions={[
                      { label: "Изменить", icon: Pencil, onSelect: () => setEdit(m) },
                      {
                        label: m.active ? "Отключить" : "Включить",
                        icon: Power,
                        onSelect: () =>
                          void save(
                            m,
                            { active: !m.active },
                            m.active ? "Менеджер отключён" : "Менеджер снова в списке приложения",
                          ),
                      },
                      {
                        label: "Удалить",
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => void remove(m),
                      },
                    ]}
                  >
                    <TableRow>
                      <TableCell className="font-medium">{m.full_name}</TableCell>
                      <TableCell>
                        {m.user_id ? (
                          <PersonChip userId={m.user_id} size="xs" />
                        ) : (
                          <span className="text-muted-foreground">не связан</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusChip tone={m.active ? "positive" : "neutral"}>
                          {m.active ? "Активен" : "Отключён"}
                        </StatusChip>
                      </TableCell>
                    </TableRow>
                  </RowContextMenu>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg">
          {edit && (
            <ManagerForm
              key={edit === "new" ? "new" : edit.id}
              manager={edit === "new" ? null : edit}
              taken={(data ?? []).filter(
                (m) => m.user_id && m.id !== (edit === "new" ? "" : edit.id),
              )}
              onClose={() => setEdit(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AdminShell>
  );
}

function ManagerForm({
  manager,
  taken,
  onClose,
}: {
  manager: AaManager | null;
  /** Другие менеджеры с учётной записью — предупредить о повторе. */
  taken: AaManager[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(manager?.full_name ?? "");
  const [active, setActive] = useState(manager?.active ?? true);
  const [userId, setUserId] = useState(manager?.user_id ?? "");
  const [nameError, setNameError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const people = useAudioPeople(true);
  const { data: linked } = usePersonShort(userId || null);
  const twin = userId ? taken.find((m) => m.user_id === userId) : undefined;

  const save = async () => {
    if (name.trim().length < 2) {
      setNameError("Имя — от 2 символов");
      return;
    }
    setSaving(true);
    try {
      const row = { full_name: name.trim(), active, user_id: userId || null };
      if (manager) await aaWrite(supabase.from("aa_managers").update(row).eq("id", manager.id));
      else await aaWrite(supabase.from("aa_managers").insert(row));
      toast.success(manager ? "Менеджер сохранён" : "Менеджер добавлен");
      await invalidateAudio(qc);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{manager ? manager.full_name : "Новый менеджер"}</DialogTitle>
        <DialogDescription>Имя в приложении записи на ресепшене.</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={save}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Имя и фамилия" tip={TIPS.name} required error={nameError}>
              <Input
                value={name}
                maxLength={200}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(undefined);
                }}
                placeholder="Например: Нино Беридзе"
              />
            </FormField>
            <FormField
              label="Учётная запись портала"
              tip={TIPS.user}
              optional
              hint={
                userId && linked
                  ? undefined
                  : "Нужна, чтобы менеджер с правом «свои смены» видел свои разборы."
              }
            >
              {people.isLoading ? (
                <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загружаем людей…
                </div>
              ) : people.data ? (
                <PersonPicker
                  people={people.data}
                  value={userId}
                  onChange={setUserId}
                  selectedLabel={linked?.full_name ?? undefined}
                />
              ) : (
                <InfoNote variant="warning">
                  Список людей портала не загрузился — обновите страницу.
                  {userId && " Сейчас менеджер связан — связь сохранится."}
                </InfoNote>
              )}
            </FormField>
            {twin && (
              <InfoNote variant="warning">
                Эта учётная запись уже связана с менеджером «{twin.full_name}». Человек будет видеть
                смены обоих.
              </InfoNote>
            )}
            <SwitchRow
              title="Активен"
              hint="Отключённый исчезает из списка приложения, прошлые смены остаются за ним."
              checked={active}
              onCheckedChange={setActive}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
