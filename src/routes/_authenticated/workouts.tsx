import { createFileRoute } from "@tanstack/react-router";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export const Route = createFileRoute("/_authenticated/workouts")({
  head: () => ({ meta: [{ title: "Тренировки — CLUB 40 Admin" }] }),
  component: WorkoutsPage,
});

type WorkoutType = "strength" | "cardio" | "hybrid" | "recovery";

type Workout = {
  id: string;
  studio_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  type: WorkoutType | null;
};

const TYPES: { value: WorkoutType; label: string }[] = [
  { value: "strength", label: "Силовая" },
  { value: "cardio", label: "Кардио" },
  { value: "hybrid", label: "Гибрид" },
  { value: "recovery", label: "Восстановление" },
];

function typeLabel(v: string | null) {
  return TYPES.find((t) => t.value === v)?.label ?? "—";
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

  useEffect(() => {
    fetchWorkouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

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
        <Button size="sm" onClick={openCreate} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить тренировку
        </Button>
      }
    >
      <div className="mx-auto max-w-6xl">
        {!studioId ? (
          <div className="rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
            Сначала выберите студию в шапке.
          </div>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Фото</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : workouts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Пока нет тренировок. Нажмите «Добавить тренировку».
                    </TableCell>
                  </TableRow>
                ) : (
                  workouts.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell>
                        <WorkoutPhoto value={w.photo_url} name={w.name} />
                      </TableCell>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell className="max-w-[420px] truncate text-muted-foreground">
                        {w.description ?? "—"}
                      </TableCell>
                      <TableCell>{typeLabel(w.type)}</TableCell>
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
          </div>
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
  const [type, setType] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(workout?.name ?? "");
      setDescription(workout?.description ?? "");
      setType(workout?.type ?? "");
      setPhotoUrl(workout?.photo_url ?? null);
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
    const payload = {
      studio_id: studioId,
      name: name.trim(),
      description: description.trim() || null,
      type: (type || null) as WorkoutType | null,
      photo_url: photoUrl,
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
                  "Заменить фото"
                ) : (
                  "Загрузить фото"
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
            <Label htmlFor="type">Тип</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="type">
                <SelectValue placeholder="Не указан" />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
