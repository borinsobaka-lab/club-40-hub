import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { ImageUploadField, StorageImage } from "@/components/image-upload-field";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { TableToolbar, ToolbarSearch } from "@/components/table-toolbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DAY_TYPES,
  DAY_TYPE_COLORS,
  type DayType,
  dayTypeColor,
  dayTypeLabel,
} from "@/lib/workout-types";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/workouts")({
  head: () => ({ meta: [{ title: "Тренировки — Base40 Admin" }] }),
  component: WorkoutsPage,
});

type Workout = {
  id: string;
  studio_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  capacity: number | null;
  type: DayType | null;
  met_value: number | null;
};

const NONE_TYPE = "__none__" as const;

function WorkoutTypeBadge({ value }: { value: DayType | null }) {
  const color = dayTypeColor(value);
  if (!color) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color.dot}`} />
      {dayTypeLabel(value)}
    </span>
  );
}

function WorkoutsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Workout | null>(null);
  const [search, setSearch] = useState("");

  const { data: workouts = [], isLoading: loading } = useQuery({
    queryKey: ["workouts", studioId],
    queryFn: () =>
      unwrap<Workout[]>(
        supabase
          .from("workouts")
          .select("*")
          .eq("studio_id", studioId!)
          .order("created_at", { ascending: false }),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить тренировки" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["workouts"] });

  const q = search.trim().toLowerCase();
  const filteredWorkouts = q
    ? workouts.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          (w.description ?? "").toLowerCase().includes(q) ||
          dayTypeLabel(w.type).toLowerCase().includes(q),
      )
    : workouts;

  const pg = usePagination(filteredWorkouts);

  const handleDelete = async (w: Workout) => {
    if (
      !(await confirm({
        title: "Удалить тренировку?",
        description: `«${w.name}» будет удалена. Занятия в расписании, использующие её, тоже пропадут.`,
      }))
    )
      return;
    const { error } = await supabase.from("workouts").delete().eq("id", w.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Тренировка удалена");
    reload();
  };

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (w: Workout) => {
    setEditing(w);
    setOpen(true);
  };

  return (
    <AdminShell
      title="Тренировки"
      actions={
        <Button onClick={openCreate} disabled={!studioId}>
          <Plus />
          Добавить тренировку
        </Button>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <TableToolbar>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Поиск по названию или описанию"
            />
          </TableToolbar>
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Иконка</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead className="w-[160px]">Тип</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead className="w-[120px]">Вместимость</TableHead>
                  <TableHead className="w-[90px]">MET</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={6} />
                ) : filteredWorkouts.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {workouts.length === 0
                        ? "Пока нет тренировок. Нажмите «Добавить тренировку»."
                        : "Ничего не найдено по выбранным фильтрам."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((w) => (
                    <RowContextMenu
                      key={w.id}
                      actions={[
                        { label: "Редактировать", icon: Pencil, onSelect: () => openEdit(w) },
                        {
                          label: "Удалить",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => handleDelete(w),
                        },
                      ]}
                    >
                      <TableRow>
                        <TableCell>
                          <StorageImage bucket="workouts" value={w.photo_url} alt={w.name} />
                        </TableCell>
                        <TableCell className="font-medium">{w.name}</TableCell>
                        <TableCell>
                          <WorkoutTypeBadge value={w.type} />
                        </TableCell>
                        <TableCell className="max-w-[420px] truncate text-muted-foreground">
                          {w.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {w.capacity ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {w.met_value != null ? Number(w.met_value).toFixed(1) : "—"}
                        </TableCell>
                      </TableRow>
                    </RowContextMenu>
                  ))
                )}
              </TableBody>
            </Table>
            <DataPagination {...pg} />
          </div>
        </RequireStudio>
      </div>

      <WorkoutDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        workout={editing}
        onSaved={reload}
      />
      {confirmDialog}
    </AdminShell>
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  workout: Workout | null;
  onSaved: () => void;
};

function WorkoutDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <WorkoutForm key={props.workout?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function WorkoutForm({ onOpenChange, studioId, workout, onSaved }: DialogProps) {
  const [name, setName] = useState(workout?.name ?? "");
  const [description, setDescription] = useState(workout?.description ?? "");
  const [photoUrl, setPhotoUrl] = useState(workout?.photo_url ?? null);
  const [capacity, setCapacity] = useState(
    workout?.capacity != null ? String(workout.capacity) : "",
  );
  const [metValue, setMetValue] = useState(
    workout?.met_value != null ? String(workout.met_value) : "",
  );
  const [type, setType] = useState<DayType | typeof NONE_TYPE>(workout?.type ?? NONE_TYPE);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!studioId) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    const capacityNum = capacity.trim() === "" ? null : Number(capacity);
    if (capacityNum != null && (!Number.isFinite(capacityNum) || capacityNum < 0)) {
      toast.error("Вместимость должна быть неотрицательным числом");
      return;
    }
    const metNum = metValue.trim() === "" ? null : Number(metValue);
    if (metNum != null && (!Number.isFinite(metNum) || metNum <= 0)) {
      toast.error("MET должен быть положительным числом");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        studio_id: studioId,
        name: name.trim(),
        description: description.trim() || null,
        photo_url: photoUrl,
        capacity: capacityNum,
        type: type === NONE_TYPE ? null : type,
        met_value: metNum,
      };
      const { error } = workout
        ? await supabase.from("workouts").update(payload).eq("id", workout.id)
        : await supabase.from("workouts").insert(payload);
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(workout ? "Тренировка обновлена" : "Тренировка добавлена");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{workout ? "Редактировать тренировку" : "Новая тренировка"}</DialogTitle>
        <DialogDescription>Заполните данные тренировки студии.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Иконка</Label>
            <ImageUploadField
              bucket="workouts"
              folder={`${studioId}`}
              value={photoUrl}
              onChange={setPhotoUrl}
              preview={
                <StorageImage
                  bucket="workouts"
                  value={photoUrl}
                  alt="Иконка"
                  className="size-16"
                />
              }
              disabled={!studioId}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Название</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Силовая базовая"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Описание</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Краткое описание тренировки"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="type">Тип тренировки</Label>
            <Select value={type} onValueChange={(v) => setType(v as DayType | typeof NONE_TYPE)}>
              <SelectTrigger id="type">
                <SelectValue placeholder="Выберите тип" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_TYPE}>
                  <span className="text-muted-foreground">Не указан</span>
                </SelectItem>
                {DAY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${DAY_TYPE_COLORS[t.value].dot}`}
                      />
                      {t.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="capacity">Вместимость (чел.)</Label>
            <Input
              id="capacity"
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Например: 12"
            />
            <p className="text-xs text-muted-foreground">
              Используется по умолчанию для всех занятий этой тренировки в расписании.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="met">MET — интенсивность</Label>
            <Input
              id="met"
              type="number"
              step="0.1"
              min={0}
              value={metValue}
              onChange={(e) => setMetValue(e.target.value)}
              placeholder="Кардио 8.5 · Силовая 7.0 · Гибрид 8.0 · Восстановление 2.8"
            />
            <p className="text-xs text-muted-foreground">
              Используется для оценки калорий: ккал ≈ MET × 3.5 × вес / 200 × мин. Если пусто —
              берётся значение по умолчанию для типа тренировки.
            </p>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Сохранить
        </Button>
      </DialogFooter>
    </>
  );
}
