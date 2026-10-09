import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, MessageCircle, Phone } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { RequireStudio } from "@/components/require-studio";
import { ImageUploadField } from "@/components/image-upload-field";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { useStorageUrl } from "@/lib/storage";
import { GENDER_OPTIONS, genderLabel, initials, isHttpUrl } from "@/lib/format";
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
import { DataPagination, usePagination } from "@/components/data-pagination";
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
import { TableSkeletonRows } from "@/components/table-skeleton";
import { useConfirm } from "@/components/confirm-dialog";
import { RowContextMenu } from "@/components/row-context-menu";

export const Route = createFileRoute("/_authenticated/trainers")({
  head: () => ({ meta: [{ title: "Сотрудники — Base40 Admin" }] }),
  component: TrainersPage,
});

type TrainerRole = "trainer" | "admin";

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
  role: TrainerRole;
};

/** Тексты, которые зависят от роли сотрудника. */
const ROLE_TEXT: Record<
  TrainerRole,
  {
    label: string;
    badge: string;
    createTitle: string;
    editTitle: string;
    description: string;
    bioLabel: string;
    bioPlaceholder: string;
  }
> = {
  trainer: {
    label: "Тренер",
    badge: "bg-sky-100 text-sky-700",
    createTitle: "Новый тренер",
    editTitle: "Редактировать тренера",
    description: "Заполните данные тренера студии.",
    bioLabel: "О тренере",
    bioPlaceholder: "Опыт, достижения, подход к работе",
  },
  admin: {
    label: "Админ",
    badge: "bg-violet-100 text-violet-700",
    createTitle: "Новый админ студии",
    editTitle: "Редактировать админа",
    description: "Укажите ФИО и фото админа студии.",
    bioLabel: "Об администраторе",
    bioPlaceholder: "Должность, обязанности, контакты",
  },
};

/** Соцсети тренера: поле формы и кнопка-ссылка в таблице. */
const SOCIALS = [
  {
    key: "telegram",
    label: "Telegram",
    icon: <MessageCircle className="h-3.5 w-3.5" />,
    color: "#0088cc",
    prefix: "https://t.me/",
    placeholder: "username или ссылка",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: <Phone className="h-3.5 w-3.5" />,
    color: "#25D366",
    prefix: "https://wa.me/",
    placeholder: "+7... или ссылка",
  },
  {
    key: "instagram",
    label: "Instagram",
    icon: <span className="text-[10px] font-bold leading-none">IG</span>,
    color: "#E1306C",
    prefix: "https://instagram.com/",
    placeholder: "username или ссылка",
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: <span className="text-[10px] font-bold leading-none">FB</span>,
    color: "#1877F2",
    prefix: "https://facebook.com/",
    placeholder: "username или ссылка",
  },
  {
    key: "tiktok",
    label: "TikTok",
    icon: <span className="text-[10px] font-bold leading-none">TT</span>,
    color: "#000000",
    prefix: "https://tiktok.com/@",
    placeholder: "@username или ссылка",
  },
] as const;

type SocialKey = (typeof SOCIALS)[number]["key"];

function TrainerPhoto({ value, name }: { value: string | null; name: string }) {
  const src = useStorageUrl("trainers", value);
  return (
    <Avatar>
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** trainer = null — у админа соцсетей нет, показываем прочерк. */
function SocialLinks({ trainer }: { trainer: Trainer | null }) {
  const links = SOCIALS.flatMap((s) => {
    const value = trainer?.[s.key];
    if (!value) return [];
    // В поле — ссылка целиком или ник (с @ или без).
    const nick = value.replace(/^@/, "");
    const href = isHttpUrl(value) ? value : `${s.prefix}${nick}`;
    return [{ ...s, href }];
  });
  if (!links.length) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      {links.map((s) => (
        <a
          key={s.key}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          title={s.label}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: s.color }}
        >
          {s.icon}
        </a>
      ))}
    </div>
  );
}

function TrainersPage() {
  const { confirm, confirmDialog } = useConfirm();
  const studioId = useActiveStudioId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Trainer | null>(null);
  const [creatingRole, setCreatingRole] = useState<TrainerRole>("trainer");

  const { data: trainers = [], isLoading: loading } = useQuery({
    queryKey: ["trainers", studioId],
    queryFn: () =>
      unwrap<Trainer[]>(
        supabase
          .from("trainers")
          .select("*")
          .eq("studio_id", studioId!)
          .order("created_at", { ascending: false }),
      ),
    enabled: !!studioId,
    meta: { errorMessage: "Не удалось загрузить тренеров" },
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["trainers"] });

  const handleDelete = async (t: Trainer) => {
    if (
      !(await confirm({
        title: "Удалить сотрудника?",
        description: `«${t.full_name}» будет удалён без возможности восстановления.`,
      }))
    )
      return;
    const { error } = await supabase.from("trainers").delete().eq("id", t.id);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
      return;
    }
    toast.success("Тренер удалён");
    reload();
  };

  const openCreate = (role: TrainerRole) => {
    setCreatingRole(role);
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (t: Trainer) => {
    setEditing(t);
    setOpen(true);
  };

  const pg = usePagination(trainers);

  return (
    <AdminShell
      title="Сотрудники"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openCreate("admin")} disabled={!studioId}>
            <Plus className="mr-1 h-4 w-4" />
            Добавить админа
          </Button>
          <Button onClick={() => openCreate("trainer")} disabled={!studioId}>
            <Plus className="mr-1 h-4 w-4" />
            Добавить тренера
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <RequireStudio studioId={studioId}>
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Фото</TableHead>
                  <TableHead>ФИО</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Пол</TableHead>
                  <TableHead>Специализация</TableHead>
                  <TableHead>О сотруднике</TableHead>
                  <TableHead>Соцсети</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeletonRows columns={7} />
                ) : trainers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Пока нет сотрудников. Нажмите «Добавить тренера» или «Добавить админа».
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.paged.map((t) => {
                    // Пол, специализация и соцсети — только у тренера; у админа
                    // в этих колонках прочерк.
                    const asTrainer = t.role === "admin" ? null : t;
                    return (
                      <RowContextMenu
                        key={t.id}
                        actions={[
                          { label: "Редактировать", icon: Pencil, onSelect: () => openEdit(t) },
                          {
                            label: "Удалить",
                            icon: Trash2,
                            destructive: true,
                            onSelect: () => handleDelete(t),
                          },
                        ]}
                      >
                        <TableRow>
                          <TableCell>
                            <TrainerPhoto value={t.photo_url} name={t.full_name} />
                          </TableCell>

                          <TableCell className="font-medium">{t.full_name}</TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_TEXT[t.role].badge}`}
                            >
                              {ROLE_TEXT[t.role].label}
                            </span>
                          </TableCell>
                          <TableCell>{genderLabel(asTrainer?.gender)}</TableCell>
                          <TableCell>{asTrainer?.specialization ?? "—"}</TableCell>
                          <TableCell className="max-w-[320px] truncate text-muted-foreground">
                            {t.bio ?? "—"}
                          </TableCell>
                          <TableCell>
                            <SocialLinks trainer={asTrainer} />
                          </TableCell>
                        </TableRow>
                      </RowContextMenu>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <DataPagination {...pg} />
          </div>
        </RequireStudio>
      </div>

      <TrainerDialog
        open={open}
        onOpenChange={setOpen}
        studioId={studioId}
        trainer={editing}
        defaultRole={creatingRole}
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
  trainer: Trainer | null;
  defaultRole: TrainerRole;
  onSaved: () => void;
};

function TrainerDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <TrainerForm key={props.trainer?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function TrainerForm({ onOpenChange, studioId, trainer, defaultRole, onSaved }: DialogProps) {
  const [role, setRole] = useState<TrainerRole>(trainer?.role ?? defaultRole);
  const [fullName, setFullName] = useState(trainer?.full_name ?? "");
  const [gender, setGender] = useState(trainer?.gender ?? "");
  const [specialization, setSpecialization] = useState(trainer?.specialization ?? "");
  const [bio, setBio] = useState(trainer?.bio ?? "");
  const [photoUrl, setPhotoUrl] = useState(trainer?.photo_url ?? null);
  const [socials, setSocials] = useState(
    () =>
      Object.fromEntries(SOCIALS.map((s) => [s.key, trainer?.[s.key] ?? ""])) as Record<
        SocialKey,
        string
      >,
  );
  const [saving, setSaving] = useState(false);

  const isAdmin = role === "admin";
  const text = ROLE_TEXT[role];

  const handleSave = async () => {
    if (!studioId) return;
    if (!fullName.trim()) {
      toast.error("Укажите ФИО");
      return;
    }
    setSaving(true);
    try {
      // У админа студии пол, специализация и соцсети не хранятся.
      const payload = {
        studio_id: studioId,
        role,
        full_name: fullName.trim(),
        gender: isAdmin ? null : gender || null,
        specialization: isAdmin ? null : specialization.trim() || null,
        bio: bio.trim() || null,
        photo_url: photoUrl,
        ...Object.fromEntries(
          SOCIALS.map((s) => [s.key, isAdmin ? null : socials[s.key].trim() || null]),
        ),
      };
      const { error } = trainer
        ? await supabase.from("trainers").update(payload).eq("id", trainer.id)
        : await supabase.from("trainers").insert(payload);
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      toast.success(trainer ? "Сохранено" : "Добавлено");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{trainer ? text.editTitle : text.createTitle}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="role">Роль</Label>
            <Select value={role} onValueChange={(v) => setRole(v as TrainerRole)}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trainer">Тренер</SelectItem>
                <SelectItem value="admin">Админ студии</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ImageUploadField
            bucket="trainers"
            folder={`${studioId}`}
            value={photoUrl}
            onChange={setPhotoUrl}
            preview={<TrainerPhoto value={photoUrl} name={fullName || "?"} />}
            uploadLabel="Загрузить фото"
            replaceLabel="Заменить фото"
            disabled={!studioId}
          />

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
            <Label htmlFor="bio">{text.bioLabel}</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder={text.bioPlaceholder}
            />
          </div>

          {!isAdmin && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="gender">Пол</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger id="gender">
                    <SelectValue placeholder="Не указан" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((g) => (
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

              <div className="grid grid-cols-2 gap-3">
                {SOCIALS.map((s) => (
                  <div key={s.key} className="space-y-1.5">
                    <Label htmlFor={s.key}>{s.label}</Label>
                    <Input
                      id={s.key}
                      value={socials[s.key]}
                      onChange={(e) => setSocials((prev) => ({ ...prev, [s.key]: e.target.value }))}
                      placeholder={s.placeholder}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Сохранить
        </Button>
      </DialogFooter>
    </>
  );
}
