import { createFileRoute } from "@tanstack/react-router";
import { useRefreshSignal } from "@/lib/refresh-bus";

import { useEffect, useRef, useState } from "react";
import { Plus, Loader2, Pencil, Trash2, ImageIcon, Search } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataPagination, usePagination } from "@/components/data-pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DAY_TYPES,
  type DayType,
  dayTypeColor,
  dayTypeLabel,
} from "@/lib/workout-types";

export const Route = createFileRoute("/_authenticated/workouts")({
  head: () => ({ meta: [{ title: "Тренировки — CLUB 40 Admin" }] }),
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

function isHttpUrl(v: string | null | undefined) {
  return !!v && /^https?:\/\//i.test(v);
}

async function resolvePhotoSrc(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (isHttpUrl(value)) return value;
  const { data, error } = await supabase.storage
    .from("workout-photos")
    .createSignedUrl(value, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

function WorkoutPhoto({ value, name }: { value: string | null; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolvePhotoSrc(value).then((s) => {
      if (!cancelled) setSrc(s);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!src) {
    return (
      <div className="flex h-12 w-16 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className="h-12 w-16 rounded-md object-cover"
    />
  );
}

function WorkoutsPage() {
  const studioId = useActiveStudioId();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Workout | null>(null);
  const [search, setSearch] = useState("");

  const filteredWorkouts = workouts.filter((w) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      w.name.toLowerCase().includes(q) ||
      (w.description ?? "").toLowerCase().includes(q) ||
      dayTypeLabel(w.type).toLowerCase().includes(q)
    );
  });

  const pg = usePagination(filteredWorkouts);

  const fetchWorkouts = async () => {
    if (!studioId) {
      setWorkouts([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("workouts")
      .select("*")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить тренировки: " + error.message);
      return;
    }
    setWorkouts((data as Workout[]) ?? []);
  };

  const refreshSignal = useRefreshSignal();
  useEffect(() => {
    fetchWorkouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshSignal]);


  const handleDelete = async (w: Workout) => {
    if (!confirm(`Удалить тренировку «${w.name}»?`)) return;
    const { error } = await supabase.from("workouts").delete().eq("id", w.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Тренировка удалена");
    fetchWorkouts();
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
      description="Список тренировок студии"
      actions={
        <Button size="default" onClick={openCreate} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить тренировку
        </Button>
      }
    >
      <div className="mx-auto max-w-6xl space-y-3">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по названию или описанию"
                  className="h-8 pl-8"
                />
              </div>
            </div>
            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Иконка</TableHead>
                    <TableHead>Название</TableHead>
                    <TableHead className="w-[160px]">Тип</TableHead>
                    <TableHead>Описание</TableHead>
                    <TableHead className="w-[120px]">Вместимость</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : filteredWorkouts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        {workouts.length === 0
                          ? "Пока нет тренировок. Нажмите «Добавить тренировку»."
                          : "Ничего не найдено по выбранным фильтрам."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.paged.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell>
                          <WorkoutPhoto value={w.photo_url} name={w.name} />
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
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(w)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(w)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <DataPagination {...pg} />
            </div>
          </>
        )}
      </div>

      <WorkoutDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        workout={editing}
        onSaved={fetchWorkouts}
      />
    </AdminShell>
  );
}

function WorkoutDialog({
  open,
  onOpenChange,
  studioId,
  workout,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  workout: Workout | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<string>("");
  const [type, setType] = useState<DayType | typeof NONE_TYPE>(NONE_TYPE);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(workout?.name ?? "");
      setDescription(workout?.description ?? "");
      setPhotoUrl(workout?.photo_url ?? null);
      setCapacity(workout?.capacity != null ? String(workout.capacity) : "");
      setType((workout?.type as DayType | null) ?? NONE_TYPE);
    }
  }, [open, workout]);

  const handleUpload = async (file: File) => {
    if (!studioId) return;
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${studioId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("workout-photos")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) {
      setUploading(false);
      toast.error("Ошибка загрузки фото: " + error.message);
      return;
    }
    setPhotoUrl(path);
    setUploading(false);
  };

  const handleSave = async () => {
    if (!studioId) return;
    if (!name.trim()) {
      toast.error("Укажите название");
      return;
    }
    setSaving(true);
    const capacityNum = capacity.trim() === "" ? null : Number(capacity);
    if (capacityNum != null && (!Number.isFinite(capacityNum) || capacityNum < 0)) {
      setSaving(false);
      toast.error("Вместимость должна быть неотрицательным числом");
      return;
    }
    const payload = {
      studio_id: studioId,
      name: name.trim(),
      description: description.trim() || null,
      photo_url: photoUrl,
      capacity: capacityNum,
      type: type === NONE_TYPE ? null : type,
    };
    const { error } = workout
      ? await supabase.from("workouts").update(payload).eq("id", workout.id)
      : await supabase.from("workouts").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success(workout ? "Тренировка обновлена" : "Тренировка добавлена");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{workout ? "Редактировать тренировку" : "Новая тренировка"}</DialogTitle>
          <DialogDescription>Заполните данные тренировки студии.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <WorkoutPhoto value={photoUrl} name={name || "?"} />
            <div className="space-y-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Загрузка…
                  </>
                ) : photoUrl ? (
                  "Заменить иконку"
                ) : (
                  "Загрузить иконку"
                )}
              </Button>
              {photoUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPhotoUrl(null)}
                >
                  Удалить
                </Button>
              )}
            </div>
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
                {DAY_TYPES.map((t) => {
                  const c = dayTypeColor(t.value)!;
                  return (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="inline-flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.dot}`} />
                        {t.label}
                      </span>
                    </SelectItem>
                  );
                })}
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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
