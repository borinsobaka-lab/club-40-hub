import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Plus, Loader2, Pencil, Trash2, MessageCircle, Phone } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useActiveStudioId } from "@/components/studio-switcher";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/trainers")({
  head: () => ({ meta: [{ title: "Тренеры — CLUB 40 Admin" }] }),
  component: TrainersPage,
});

type Trainer = {
  id: string;
  studio_id: string;
  full_name: string;
  photo_url: string | null;
  gender: string | null;
  specialization: string | null;
  bio: string | null;
  telegram: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
};

const GENDERS = [
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" },
];

function genderLabel(v: string | null) {
  return GENDERS.find((g) => g.value === v)?.label ?? "—";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function isHttpUrl(v: string | null | undefined) {
  return !!v && /^https?:\/\//i.test(v);
}

async function resolvePhotoSrc(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (isHttpUrl(value)) return value;
  const { data, error } = await supabase.storage
    .from("trainer-photos")
    .createSignedUrl(value, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

function TrainerPhoto({ value, name }: { value: string | null; name: string }) {
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
  return (
    <Avatar>
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function SocialLinks({ trainer }: { trainer: Trainer }) {
  const items: { key: keyof Trainer; label: string; icon: React.ReactNode; color: string; prefix?: string }[] = [
    { key: "telegram", label: "Telegram", icon: <MessageCircle className="h-3.5 w-3.5" />, color: "#0088cc", prefix: "https://t.me/" },
    { key: "whatsapp", label: "WhatsApp", icon: <Phone className="h-3.5 w-3.5" />, color: "#25D366", prefix: "https://wa.me/" },
    { key: "instagram", label: "Instagram", icon: <span className="text-[10px] font-bold leading-none">IG</span>, color: "#E1306C", prefix: "https://instagram.com/" },
    { key: "facebook", label: "Facebook", icon: <span className="text-[10px] font-bold leading-none">FB</span>, color: "#1877F2", prefix: "https://facebook.com/" },
    { key: "tiktok", label: "TikTok", icon: <span className="text-[10px] font-bold leading-none">TT</span>, color: "#000000", prefix: "https://tiktok.com/@" },
  ];
  const hasAny = items.some((i) => !!trainer[i.key]);
  if (!hasAny) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      {items.map((item) => {
        const value = trainer[item.key];
        if (!value) return null;
        const href = item.prefix && !isHttpUrl(value) ? `${item.prefix}${value.replace(/^@/, "")}` : value;
        return (
          <a
            key={item.key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={item.label}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: item.color }}
          >
            {item.icon}
          </a>
        );
      })}
    </div>
  );
}

function TrainersPage() {
  const studioId = useActiveStudioId();
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Trainer | null>(null);

  const fetchTrainers = async () => {
    if (!studioId) {
      setTrainers([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("trainers")
      .select("*")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить тренеров: " + error.message);
      return;
    }
    setTrainers((data as Trainer[]) ?? []);
  };

  useEffect(() => {
    fetchTrainers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);


  const handleDelete = async (t: Trainer) => {
    if (!confirm(`Удалить тренера «${t.full_name}»?`)) return;
    const { error } = await supabase.from("trainers").delete().eq("id", t.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Тренер удалён");
    fetchTrainers();
  };

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (t: Trainer) => {
    setEditing(t);
    setOpen(true);
  };

  return (
    <AdminShell
      title="Тренеры"
      description="Список тренеров студии"
      actions={
        <Button size="sm" onClick={openCreate} disabled={!studioId}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить тренера
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
                  <TableHead className="w-[80px]">Фото</TableHead>
                  <TableHead>ФИО</TableHead>
                  <TableHead>Пол</TableHead>
                  <TableHead>Специализация</TableHead>
                  <TableHead>О тренере</TableHead>
                  <TableHead>Соцсети</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : trainers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      Пока нет тренеров. Нажмите «Добавить тренера».
                    </TableCell>
                  </TableRow>
                ) : (
                  trainers.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <TrainerPhoto value={t.photo_url} name={t.full_name} />
                      </TableCell>

                      <TableCell className="font-medium">{t.full_name}</TableCell>
                      <TableCell>{genderLabel(t.gender)}</TableCell>
                      <TableCell>{t.specialization ?? "—"}</TableCell>
                      <TableCell className="max-w-[320px] truncate text-muted-foreground">
                        {t.bio ?? "—"}
                      </TableCell>
                      <TableCell>
                        <SocialLinks trainer={t} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(t)}>
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

      <TrainerDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        trainer={editing}
        onSaved={fetchTrainers}
      />
    </AdminShell>
  );
}

function TrainerDialog({
  open,
  onOpenChange,
  studioId,
  trainer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  trainer: Trainer | null;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<string>("");
  const [specialization, setSpecialization] = useState("");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFullName(trainer?.full_name ?? "");
      setGender(trainer?.gender ?? "");
      setSpecialization(trainer?.specialization ?? "");
      setBio(trainer?.bio ?? "");
      setPhotoUrl(trainer?.photo_url ?? null);
    }
  }, [open, trainer]);

  const handleUpload = async (file: File) => {
    if (!studioId) return;
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${studioId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("trainer-photos")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) {
      setUploading(false);
      toast.error("Ошибка загрузки фото: " + error.message);
      return;
    }
    // Store the storage path; rendering uses signed URLs so this works
    // even if the bucket is private.
    setPhotoUrl(path);
    setUploading(false);
  };


  const handleSave = async () => {
    if (!studioId) return;
    if (!fullName.trim()) {
      toast.error("Укажите ФИО");
      return;
    }
    setSaving(true);
    const payload = {
      studio_id: studioId,
      full_name: fullName.trim(),
      gender: gender || null,
      specialization: specialization.trim() || null,
      bio: bio.trim() || null,
      photo_url: photoUrl,
    };
    const { error } = trainer
      ? await supabase.from("trainers").update(payload).eq("id", trainer.id)
      : await supabase.from("trainers").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success(trainer ? "Тренер обновлён" : "Тренер добавлен");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{trainer ? "Редактировать тренера" : "Новый тренер"}</DialogTitle>
          <DialogDescription>Заполните данные тренера студии.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <TrainerPhoto value={photoUrl} name={fullName || "?"} />

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
            <Label htmlFor="full_name">ФИО</Label>
            <Input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванов Иван Иванович"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gender">Пол</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger id="gender">
                <SelectValue placeholder="Не указан" />
              </SelectTrigger>
              <SelectContent>
                {GENDERS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="specialization">Специализация</Label>
            <Input
              id="specialization"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              placeholder="Силовой тренинг, кроссфит"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bio">О тренере</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Опыт, достижения, подход к работе"
            />
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
