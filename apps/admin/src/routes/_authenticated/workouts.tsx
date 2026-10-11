import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { ImageUploadField, StorageImage } from "@/components/image-upload-field";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useActiveStudio } from "@/hooks/use-studios";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
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
  DialogForm,
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
  WORKOUT_COLORS,
  type DayType,
  dayTypeColor,
  dayTypeLabel,
  isWorkoutColor,
} from "@/lib/workout-types";
import { cn } from "@/lib/utils";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

/** Подсказки «?»: один текст у поля формы и у колонки таблицы. */
const TIPS = {
  description: "Клиенты видят его в карточке занятия в расписании приложения.",
  type: "Задаёт цвет метки и MET по умолчанию, если поле MET пустое.",
  capacity: "Когда места заняты, новые записи встают в лист ожидания.",
  color:
    "Полоска этого цвета слева на карточке занятия в расписании — видно, какие тренировки когда стоят.",
  met: "Интенсивность: по ней клиенту оцениваются сожжённые калории (ккал ≈ MET × 3.5 × вес / 200 × мин).",
};

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
  /** Пакетный формат: цвет полоски в расписании (#rrggbb). */
  color: string | null;
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

function ColorSwatch({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className="inline-block h-4 w-8 rounded-sm border border-black/10"
      style={{ backgroundColor: value }}
      title={value}
    />
  );
}

function WorkoutsPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  // В пакетных студиях у тренировки нет типа и иконки, зато есть цвет, а
  // MET ставится вручную всегда (STUDIO_FORMATS.md, 2026-10-11).
  const packages = useActiveStudio()?.format === "packages";
  const columns = packages ? 5 : 6;
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
                  {packages ? (
                    <TableHead className="w-[80px]" tip={TIPS.color}>
                      Цвет
                    </TableHead>
                  ) : (
                    <TableHead className="w-[100px]">Иконка</TableHead>
                  )}
                  <TableHead>Название</TableHead>
                  {!packages && (
                    <TableHead className="w-[160px]" tip={TIPS.type}>
                      Тип
                    </TableHead>
                  )}
                  <TableHead tip={TIPS.description}>Описание</TableHead>
                  <TableHead className="w-[120px]" tip={TIPS.capacity}>
                    Вместимость
                  </TableHead>
                  <TableHead className="w-[90px]" tip={packages ? TIPS.met : undefined}>
                    MET
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={columns} />
                ) : filteredWorkouts.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns}
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
                          {packages ? (
                            <ColorSwatch value={w.color} />
                          ) : (
                            <StorageImage bucket="workouts" value={w.photo_url} alt={w.name} />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{w.name}</TableCell>
                        {!packages && (
                          <TableCell>
                            <WorkoutTypeBadge value={w.type} />
                          </TableCell>
                        )}
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
        packages={packages}
        usedColors={workouts.map((w) => w.color)}
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
  /** Пакетная студия: цвет вместо типа и иконки, MET обязателен. */
  packages: boolean;
  /** Цвета других тренировок — новой предлагается ещё не занятый. */
  usedColors: (string | null)[];
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

function WorkoutForm({
  onOpenChange,
  studioId,
  workout,
  packages,
  usedColors,
  onSaved,
}: DialogProps) {
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
  const [color, setColor] = useState(
    () =>
      workout?.color ??
      [...WORKOUT_COLORS.filter((c) => c.basic), ...WORKOUT_COLORS.filter((c) => !c.basic)].find(
        (c) => !usedColors.includes(c.hex),
      )?.hex ??
      WORKOUT_COLORS[0].hex,
  );
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
    if (packages && metNum == null) {
      toast.error("Укажите интенсивность (MET)");
      return;
    }
    if (metNum != null && (!Number.isFinite(metNum) || metNum <= 0)) {
      toast.error("MET должен быть положительным числом");
      return;
    }
    if (packages && !isWorkoutColor(color)) {
      toast.error("Цвет — в формате #RRGGBB");
      return;
    }

    setSaving(true);
    try {
      const common = {
        studio_id: studioId,
        name: name.trim(),
        description: description.trim() || null,
        capacity: capacityNum,
        met_value: metNum,
      };
      // Пакетной тренировке тип и иконку не пишем вовсе: у неё их нет.
      // Подписочной — не пишем цвет: её цвет по-прежнему от типа.
      const payload: Record<string, unknown> = packages
        ? { ...common, type: null, color: color.toLowerCase() }
        : { ...common, photo_url: photoUrl, type: type === NONE_TYPE ? null : type };
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
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            {!packages && (
              <FormField label="Иконка" htmlFor={null} optional>
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
              </FormField>
            )}

            <FormField label="Название" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Силовая базовая"
              />
            </FormField>

            <FormField label="Описание" tip={TIPS.description} optional>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Краткое описание тренировки"
              />
            </FormField>

            {packages ? (
              <FormField label="Цвет" htmlFor={null} tip={TIPS.color} required>
                <WorkoutColorPicker value={color} onChange={setColor} />
              </FormField>
            ) : (
              <FormField label="Тип тренировки" tip={TIPS.type} optional>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as DayType | typeof NONE_TYPE)}
                >
                  <SelectTrigger>
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
              </FormField>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Вместимость, чел."
                tip={TIPS.capacity}
                optional
                hint="По умолчанию для всех занятий этой тренировки в расписании."
              >
                <Input
                  type="number"
                  min={0}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="Например: 12"
                />
              </FormField>

              <FormField
                label="MET — интенсивность"
                optional={!packages}
                required={packages}
                tip={packages ? TIPS.met : undefined}
                hint={
                  packages
                    ? "Например: растяжка 2.5, пилатес 3.0, силовая 6.0, кардио 8.0."
                    : "Для оценки калорий: ккал ≈ MET × 3.5 × вес / 200 × мин. Если пусто — значение по умолчанию для типа: кардио 8.5, силовая 7.0, гибрид 8.0, восстановление 2.8."
                }
              >
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  value={metValue}
                  onChange={(e) => setMetValue(e.target.value)}
                  placeholder="Например: 8.0"
                />
              </FormField>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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

/** Цвет тренировки: готовая палитра + свой цвет. */
function WorkoutColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = value.toLowerCase();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {WORKOUT_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.label}
            aria-label={c.label}
            aria-pressed={current === c.hex}
            onClick={() => onChange(c.hex)}
            className={cn(
              "size-8 cursor-pointer rounded-full border border-black/10 transition-transform hover:scale-110",
              current === c.hex && "ring-2 ring-ring ring-offset-2 ring-offset-background",
            )}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Свой цвет"
          value={isWorkoutColor(value) ? value : WORKOUT_COLORS[0].hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border bg-background p-1 lg:h-9"
        />
        <Input
          aria-label="Цвет в формате #RRGGBB"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          className="w-32 font-mono uppercase"
          maxLength={7}
        />
      </div>
    </div>
  );
}
