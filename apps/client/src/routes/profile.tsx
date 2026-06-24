import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { SquircleAvatar, SquircleAvatarFallback, SquircleAvatarImage, squircleClipPath } from "@/components/ui/squircle-avatar";
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
  SheetFooter,
} from "@/components/ui/sheet";
import { Refresh, Pen, Logout, Camera, DocumentText, Smartphone, Card2, ChatRound, AltArrowRight, Translation, Settings, MedalStar } from "@solar-icons/react";
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
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      .update({ photo_url: publicUrl } as never)
      .eq("user_id", user.id)
      .select()
      .maybeSingle();
    setUploadingAvatar(false);
    if (dbErr) {
      toast.error("Не удалось сохранить: " + dbErr.message);
      return;
    }
    if (updated) setClient(updated as ClientRow);
    toast.success("Аватар обновлён");
  };

  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-black italic uppercase">Профиль</h1>
          <p className="text-sm text-white/70">Ваши данные и настройки</p>
        </div>
      }
    >
      <div className="pt-6 pb-8">
        <div className="bg-muted">
          {/* Блок: данные пользователя */}
          <section className="relative bg-background rounded-b-[14px] px-4 pt-3 pb-5">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              disabled={loading || !client}
              className="absolute top-3 right-3 h-9 w-9 rounded-full bg-muted text-foreground flex items-center justify-center disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Редактировать профиль"
            >
              <Pen className="h-4 w-4" weight="BoldDuotone" />
            </button>
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar || loading}
              className="relative shrink-0 focus:outline-none disabled:opacity-70"
              style={{ width: 120, height: 120 }}
              aria-label="Заменить аватар"
            >
              <SquircleAvatar size={120}>
                {client?.photo_url && <SquircleAvatarImage src={client.photo_url} alt={fullName} />}
                <SquircleAvatarFallback className="bg-muted text-foreground text-3xl font-semibold">
                  {loading ? <Refresh className="h-6 w-6 animate-spin" weight="BoldDuotone" /> : initials(fullName)}
                </SquircleAvatarFallback>
              </SquircleAvatar>
              {uploadingAvatar && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center" style={{ clipPath: squircleClipPath(120), WebkitClipPath: squircleClipPath(120) }}>
                  <Refresh className="h-6 w-6 text-white animate-spin" weight="BoldDuotone" />
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-white text-foreground flex items-center justify-center border-2 border-background">
                <Camera className="h-4 w-4" />
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <div className="text-center">
              <div className="font-semibold text-lg">{fullName}</div>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
            <ProfileField label="Телефон" value={phone} />
            <ProfileField label="Email" value={email} />
            <ProfileField
              label="Дата рождения"
              value={birthday ? new Date(birthday).toLocaleDateString("ru-RU") : ""}
            />
            <ProfileField
              label="Пол"
              value={gender === "male" ? "Мужской" : gender === "female" ? "Женский" : ""}
            />
          </dl>

          <button
            type="button"
            className="w-full mt-5 rounded-[14px] bg-muted px-4 py-3 flex items-center justify-between text-left focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <div className="flex flex-col">
              <span className="font-semibold text-sm">Бонусы</span>
              <span className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <MedalStar className="h-5 w-5 text-yellow-500" weight="BoldDuotone" />
                <span className="font-semibold text-foreground">1 250</span>
              </span>
            </div>
            <AltArrowRight className="h-5 w-5 text-muted-foreground" weight="LineDuotone" />
          </button>
        </section>

        <div className="h-3 bg-muted" />

        {/* Блок: ссылки */}
        <section className="bg-background rounded-t-[14px] rounded-b-[14px] py-1">
          <ul className="divide-y divide-border">
            <ProfileLink icon={<DocumentText className="h-5 w-5" weight="BoldDuotone" />} label="Правовые документы" />
            <ProfileLink
              icon={<Card2 className="h-5 w-5" weight="BoldDuotone" />}
              label="Способы оплаты"
              sublabel="Mastercard •••• 4242"
              right={<MastercardBadge />}
            />
            <ProfileLink icon={<ChatRound className="h-5 w-5" weight="BoldDuotone" />} label="Поддержка" />
            <ProfileLink icon={<Settings className="h-5 w-5" weight="BoldDuotone" />} label="Язык" sublabel="Русский" />
            <ProfileLink icon={<Smartphone className="h-5 w-5" weight="BoldDuotone" />} label="О приложении" />
          </ul>
        </section>

        <div className="h-3 bg-muted" />

        {/* Блок: выход */}
        <section className="bg-background rounded-t-[14px] px-4 py-5">
          <Button variant="outline" className="w-full shadow-none" onClick={() => signOut()}>
            <Logout className="h-4 w-4 mr-2" weight="BoldDuotone" />
            Выйти
          </Button>
        </section>
        </div>

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

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  const isEmpty = !value || value.length === 0;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium break-words ${isEmpty ? "text-muted-foreground/60 italic" : ""}`}>
        {isEmpty ? "не указано" : value}
      </dd>
    </div>
  );
}

function ProfileLink({
  icon,
  label,
  sublabel,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-4 text-left"
      >
        <span className="text-foreground">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium">{label}</span>
          {sublabel && (
            <span className="block text-xs text-muted-foreground mt-0.5">{sublabel}</span>
          )}
        </span>
        {right}
        <AltArrowRight className="h-4 w-4 text-muted-foreground" weight="BoldDuotone" />
      </button>
    </li>
  );
}

function MastercardBadge() {
  return (
    <span
      aria-label="Mastercard"
      className="inline-flex items-center justify-center h-6 w-9 rounded-[4px] bg-[#1a1a1a]"
    >
      <svg viewBox="0 0 24 16" className="h-3.5 w-auto" aria-hidden="true">
        <circle cx="9" cy="8" r="6" fill="#EB001B" />
        <circle cx="15" cy="8" r="6" fill="#F79E1B" />
        <path
          d="M12 3.6a6 6 0 0 1 0 8.8 6 6 0 0 1 0-8.8z"
          fill="#FF5F00"
        />
      </svg>
    </span>
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
    const avatarUpdate = { photo_url: publicUrl } as never;
    const { data: updated, error: dbErr } = await supabase
      .from("clients")
      .update(avatarUpdate)
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
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="relative focus:outline-none disabled:opacity-70"
              style={{ width: 96, height: 96 }}
              aria-label="Загрузить аватар"
            >
              <SquircleAvatar size={96}>
                {avatarUrl && <SquircleAvatarImage src={avatarUrl} alt={displayName} />}
                <SquircleAvatarFallback className="bg-muted text-foreground text-2xl font-semibold">
                  {initials(displayName)}
                </SquircleAvatarFallback>
              </SquircleAvatar>
              {uploadingAvatar && (
                <div
                  className="absolute inset-0 bg-black/30 flex items-center justify-center"
                  style={{ clipPath: squircleClipPath(96), WebkitClipPath: squircleClipPath(96) }}
                >
                  <Refresh className="h-6 w-6 text-white animate-spin" weight="BoldDuotone" />
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white text-foreground flex items-center justify-center border-2 border-background">
                <Camera className="h-3.5 w-3.5" />
              </span>
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
            <Input className="shadow-none"
              id="last_name"
              value={form.last_name}
              onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
              maxLength={60}
              autoComplete="family-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="first_name">Имя</Label>
            <Input className="shadow-none"
              id="first_name"
              value={form.first_name}
              onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
              maxLength={60}
              autoComplete="given-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Телефон</Label>
            <Input className="shadow-none"
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
            <Input className="shadow-none"
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
            <Input className="shadow-none"
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
              <SelectTrigger className="h-12 shadow-none">
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
            className="flex-1 shadow-none font-bold"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button className="flex-1 font-bold" onClick={handleSave} disabled={saving}>
            {saving && <Refresh className="h-4 w-4 mr-2 animate-spin" weight="BoldDuotone" />}
            Сохранить
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
