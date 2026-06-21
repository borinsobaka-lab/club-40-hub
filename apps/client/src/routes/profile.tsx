import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { LogOut, Loader2, Pencil, Camera } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Профиль — CLUB 40" },
      { name: "description", content: "Профиль участника CLUB 40." },
    ],
  }),
  component: ProfilePage,
});

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

type ClientRow = {
  id?: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  gender?: string | null;
  photo_url?: string | null;
};

type ClientUpdate = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  birthday?: string | null;
  gender?: string | null;
  photo_url?: string | null;
};

const profileSchema = z.object({
  first_name: z.string().trim().min(1, "Укажите имя").max(60, "Слишком длинное имя"),
  last_name: z.string().trim().min(1, "Укажите фамилию").max(60, "Слишком длинная фамилия"),
  phone: z.string().trim().max(32, "Слишком длинный номер").optional().or(z.literal("")),
  email: z.string().trim().email("Некорректный email").max(255).optional().or(z.literal("")),
  birthday: z.string().optional().or(z.literal("")),
  gender: z.string().optional().or(z.literal("")),
});

function composeFullName(c: Pick<ClientRow, "full_name" | "first_name" | "last_name"> | null | undefined) {
  if (!c) return "";
  const composed = [c.last_name, c.first_name].filter(Boolean).join(" ").trim();
  return composed || (c.full_name ?? "");
}

function splitFullName(full: string | null | undefined): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { last: parts[0], first: parts.slice(1).join(" ") };
}

function ProfilePage() {
  const { user, signOut } = useAuth();
  const [client, setClient] = useState<ClientRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("clients")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setClient((data as ClientRow | null) ?? null);
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel(`clients-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clients", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fullName =
    composeFullName(client) ||
    (user?.user_metadata?.full_name as string) ||
    "Участник";
  const email = client?.email || user?.email || "";
  const phone = client?.phone || "";
  const birthday = client?.birthday || "";
  const gender = client?.gender || "";

  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-black italic uppercase">Профиль</h1>
          <p className="text-sm text-white/70">Ваши данные и настройки</p>
        </div>
      }
    >
      <div className="p-4 space-y-5">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {client?.photo_url && <AvatarImage src={client.photo_url} alt={fullName} />}
              <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : initials(fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-lg truncate">{fullName}</div>
              <div className="text-xs text-muted-foreground truncate">{email}</div>
              {phone && <div className="text-xs text-muted-foreground truncate">{phone}</div>}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Дата рождения</div>
              <div className="font-medium">
                {birthday ? new Date(birthday).toLocaleDateString("ru-RU") : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Пол</div>
              <div className="font-medium">
                {gender === "male" ? "Мужской" : gender === "female" ? "Женский" : "—"}
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full mt-5"
            onClick={() => setEditOpen(true)}
            disabled={loading || !client}
          >
            <Pencil className="h-4 w-4 mr-2" />
            Редактировать профиль
          </Button>
        </Card>

        <Button variant="outline" className="w-full" onClick={() => signOut()}>
          <LogOut className="h-4 w-4 mr-2" />
          Выйти
        </Button>

        {client && (
          <EditProfileSheet
            open={editOpen}
            onOpenChange={setEditOpen}
            client={client}
            onSaved={(updated) => setClient((prev) => ({ ...prev, ...updated }))}
          />
        )}
      </div>
    </PageShell>
  );
}

function EditProfileSheet({
  open,
  onOpenChange,
  client,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientRow;
  onSaved: (updated: ClientRow) => void;
}) {
  const { user } = useAuth();
  const initial = (() => {
    const split = splitFullName(client.full_name);
    return {
      first_name: client.first_name ?? split.first,
      last_name: client.last_name ?? split.last,
      phone: client.phone ?? "",
      email: client.email ?? "",
      birthday: client.birthday ?? "",
      gender: client.gender ?? "",
    };
  })();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(client.photo_url ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Выберите изображение");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Файл больше 5 МБ");
      return;
    }
    setUploadingAvatar(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
    if (upErr) {
      setUploadingAvatar(false);
      toast.error("Не удалось загрузить: " + upErr.message);
      return;
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const publicUrl = pub.publicUrl;
    const { data: updated, error: dbErr } = await supabase
      .from("clients")
      .update({ photo_url: publicUrl })
      .eq("user_id", user.id)
      .select()
      .maybeSingle();
    setUploadingAvatar(false);
    if (dbErr) {
      toast.error("Не удалось сохранить: " + dbErr.message);
      return;
    }
    setAvatarUrl(publicUrl);
    if (updated) onSaved(updated as ClientRow);
    toast.success("Аватар обновлён");
  };

  useEffect(() => {
    if (open) {
      const split = splitFullName(client.full_name);
      setForm({
        first_name: client.first_name ?? split.first,
        last_name: client.last_name ?? split.last,
        phone: client.phone ?? "",
        email: client.email ?? "",
        birthday: client.birthday ?? "",
        gender: client.gender ?? "",
      });
    }
  }, [open, client]);

  const handleSave = async () => {
    if (!user) return;
    const parsed = profileSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте поля");
      return;
    }
    const v = parsed.data;
    const fullName = [v.last_name, v.first_name].filter(Boolean).join(" ").trim();
    const payload: ClientUpdate = {
      first_name: v.first_name,
      last_name: v.last_name,
      full_name: fullName,
      phone: v.phone ? v.phone : null,
      email: v.email ? v.email : null,
      birthday: v.birthday ? v.birthday : null,
      gender: v.gender ? v.gender : null,
    };

    setSaving(true);
    const { data, error } = await supabase
      .from("clients")
      .update(payload)
      .eq("user_id", user.id)
      .select();
    setSaving(false);

    if (error) {
      toast.error("Не удалось сохранить: " + error.message);
      return;
    }
    const rows = (data as ClientRow[] | null) ?? [];
    if (rows.length === 0) {
      const insertPayload = { ...payload, user_id: user.id };
      const { data: inserted, error: insertError } = await supabase
        .from("clients")
        .insert(insertPayload)
        .select()
        .maybeSingle();
      if (insertError) {
        toast.error("Не удалось сохранить: " + insertError.message);
        return;
      }
      toast.success("Профиль обновлён");
      if (inserted) onSaved(inserted as ClientRow);
      onOpenChange(false);
      return;
    }
    toast.success("Профиль обновлён");
    onSaved(rows[0]);
    onOpenChange(false);
  };

  const displayName = composeFullName(client) || "Участник";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Редактировать профиль</SheetTitle>
          <SheetDescription>
            Изменения сохранятся и в приложении, и на портале.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="relative group rounded-full focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Загрузить аватар"
            >
              <Avatar className="h-24 w-24">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
                <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-semibold">
                  {initials(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 rounded-full bg-black/30 flex items-center justify-center transition-opacity group-hover:bg-black/50">
                {uploadingAvatar ? (
                  <Loader2 className="h-6 w-6 text-white animate-spin" />
                ) : (
                  <Camera className="h-6 w-6 text-white drop-shadow" />
                )}
              </div>
              <div className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background shadow">
                <Camera className="h-3.5 w-3.5" />
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              {avatarUrl ? "Заменить фото" : "Загрузить фото"}
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="last_name">Фамилия</Label>
            <Input
              id="last_name"
              value={form.last_name}
              onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
              maxLength={60}
              autoComplete="family-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="first_name">Имя</Label>
            <Input
              id="first_name"
              value={form.first_name}
              onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
              maxLength={60}
              autoComplete="given-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Телефон</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              maxLength={32}
              autoComplete="tel"
              placeholder="+7 ___ ___ __ __"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              maxLength={255}
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="birthday">Дата рождения</Label>
            <Input
              id="birthday"
              type="date"
              value={form.birthday}
              onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Пол</Label>
            <Select
              value={form.gender || "unset"}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, gender: v === "unset" ? "" : v }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Не указано" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Не указано</SelectItem>
                <SelectItem value="male">Мужской</SelectItem>
                <SelectItem value="female">Женский</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
