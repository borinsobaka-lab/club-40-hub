import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorClosed, DoorOpen, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { useConfirm } from "@/components/confirm-dialog";
import { AudioLocationsPageSkeleton } from "@/components/page-skeletons";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { aaLocationsQuery, aaWrite, AUDIO_KEY, invalidateAudio } from "@/lib/audio/data";
import { AUDIO_TITLES, LOCATIONS_COLUMNS } from "@/lib/audio/labels";
import { DEFAULT_TIMEZONE } from "@/lib/audio/logic";
import type { AaLocation } from "@/lib/audio/types";
import { unwrap } from "@/lib/query";
import { sortRows } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/audio/locations")({
  head: () => ({ meta: [{ title: "Точки продажи — Аудиоаналитика — Base40 Admin" }] }),
  pendingComponent: AudioLocationsPageSkeleton,
  component: LocationsPage,
});

const TIPS = {
  name: "Сотрудник увидит название в приложении записи — пишите так, как студию называют между собой.",
  address: "Помогает не перепутать две точки в одном районе.",
  timezone: "По нему считается время разговоров на часах студии в отчёте. Обычно Asia/Tbilisi.",
  studio: "Если точка — наш клуб: только подпись, на доступ не влияет.",
  shifts: "Смены, записанные на точке. Точку со сменами можно только закрыть.",
  status: "Закрытая точка исчезает из выбора в приложении, её прошлые смены остаются в отчётах.",
};

/** Клубы портала — для подписи точки (studios читается публично). */
function useStudioNames() {
  return useQuery({
    queryKey: [AUDIO_KEY, "studios"],
    queryFn: () =>
      unwrap<{ id: string; name: string }[]>(
        supabase.from("studios").select("id, name").order("name"),
      ),
    staleTime: 10 * 60_000,
    meta: { errorMessage: "Не удалось загрузить клубы" },
  });
}

/**
 * Точки продажи: студия с одним ресепшеном, где стоит компьютер с
 * приложением записи. В приложении точка выбирается один раз при установке.
 * Менеджеры к точкам не привязаны.
 */
function LocationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(aaLocationsQuery);
  const { data: studios = [] } = useStudioNames();
  const [edit, setEdit] = useState<AaLocation | "new" | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const sort = useTableSort();
  const rows = sortRows(data ?? [], sort.sort, {
    name: (l) => l.name,
    shifts: (l) => l.shifts,
  });
  const studioName = (id: string | null) => studios.find((s) => s.id === id)?.name ?? "—";
  const keys = ["name", null, null, null, "shifts", null];
  const openCount = (data ?? []).filter((l) => l.active).length;

  const setActive = async (l: AaLocation, active: boolean) => {
    try {
      await aaWrite(supabase.from("aa_locations").update({ active }).eq("id", l.id));
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  const remove = async (l: AaLocation) => {
    if (
      !(await confirm({
        title: `Удалить точку «${l.name}»?`,
        description: "Удалить можно только точку без смен.",
      }))
    )
      return;
    try {
      await aaWrite(supabase.from("aa_locations").delete().eq("id", l.id));
      await invalidateAudio(qc);
      toast.success("Точка удалена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  return (
    <AdminShell
      title={AUDIO_TITLES.locations}
      actions={
        <Button onClick={() => setEdit("new")}>
          <Plus />
          Добавить точку
        </Button>
      }
    >
      <div className="space-y-3">
        {data && data.length > 0 && openCount === 0 && (
          <InfoNote variant="warning">
            Все точки закрыты — приложению на ресепшене не из чего выбирать, новая смена не
            начнётся.
          </InfoNote>
        )}
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                {LOCATIONS_COLUMNS.map((c, i) => (
                  <TableHead
                    key={c}
                    className={i === 4 ? "text-right [&>span]:justify-end" : undefined}
                    tip={
                      [
                        TIPS.name,
                        TIPS.address,
                        TIPS.timezone,
                        TIPS.studio,
                        TIPS.shifts,
                        TIPS.status,
                      ][i]
                    }
                    {...(keys[i] ? sort.head(keys[i]!) : {})}
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeletonRows columns={LOCATIONS_COLUMNS.length} rows={3} />
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={LOCATIONS_COLUMNS.length}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Точек продажи нет — заведите первую: до этого приложение на ресепшене не сможет
                    начать смену.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((l) => (
                  <RowContextMenu
                    key={l.id}
                    actions={[
                      { label: "Изменить", icon: Pencil, onSelect: () => setEdit(l) },
                      l.active
                        ? {
                            label: "Закрыть точку",
                            icon: DoorClosed,
                            onSelect: () => void setActive(l, false),
                          }
                        : {
                            label: "Открыть точку",
                            icon: DoorOpen,
                            onSelect: () => void setActive(l, true),
                          },
                      ...(l.shifts === 0
                        ? [
                            {
                              label: "Удалить",
                              icon: Trash2,
                              destructive: true,
                              onSelect: () => void remove(l),
                            },
                          ]
                        : []),
                    ]}
                  >
                    <TableRow>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell>{l.address || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{l.timezone}</TableCell>
                      <TableCell>{studioName(l.studio_id)}</TableCell>
                      <TableCell className="text-right">{l.shifts}</TableCell>
                      <TableCell>
                        <StatusChip tone={l.active ? "positive" : "neutral"}>
                          {l.active ? "Работает" : "Закрыта"}
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
            <LocationForm
              key={edit === "new" ? "new" : edit.id}
              location={edit === "new" ? null : edit}
              studios={studios}
              onClose={() => setEdit(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AdminShell>
  );
}

function LocationForm({
  location,
  studios,
  onClose,
}: {
  location: AaLocation | null;
  studios: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [timezone, setTimezone] = useState(location?.timezone ?? DEFAULT_TIMEZONE);
  const [studioId, setStudioId] = useState(location?.studio_id ?? "none");
  const [active, setActive] = useState(location?.active ?? true);
  const [nameError, setNameError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      setNameError("Укажите название точки");
      return;
    }
    const tz = timezone.trim() || DEFAULT_TIMEZONE;
    try {
      new Intl.DateTimeFormat("ru-RU", { timeZone: tz });
    } catch {
      toast.error("Неизвестный часовой пояс — например, Asia/Tbilisi");
      return;
    }
    setSaving(true);
    try {
      const row = {
        name: name.trim(),
        address: address.trim(),
        timezone: tz,
        studio_id: studioId === "none" ? null : studioId,
        active,
      };
      if (location) await aaWrite(supabase.from("aa_locations").update(row).eq("id", location.id));
      else await aaWrite(supabase.from("aa_locations").insert(row));
      toast.success(location ? "Точка сохранена" : "Точка добавлена");
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
        <DialogTitle>{location ? location.name : "Новая точка продажи"}</DialogTitle>
        <DialogDescription>Студия и её ресепшен с компьютером для записи смен.</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={save}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" tip={TIPS.name} required error={nameError}>
              <Input
                value={name}
                maxLength={200}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(undefined);
                }}
                placeholder="Например: Ваке"
              />
            </FormField>
            <FormField label="Адрес" tip={TIPS.address} optional>
              <Input
                value={address}
                maxLength={500}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Тбилиси, ул. Чавчавадзе, 40"
              />
            </FormField>
            <FormField label="Часовой пояс" tip={TIPS.timezone} required>
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder={DEFAULT_TIMEZONE}
              />
            </FormField>
            <FormField label="Клуб портала" tip={TIPS.studio} optional>
              <Select value={studioId} onValueChange={setStudioId}>
                <SelectTrigger aria-label="Клуб портала">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— не связана —</SelectItem>
                  {studios.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <SwitchRow
              title="Точка работает"
              hint="Закрытая исчезает из выбора в приложении; смены и отчёты остаются."
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
