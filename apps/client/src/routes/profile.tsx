import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
  squircleClipPath,
} from "@/components/ui/squircle-avatar";
import { SelectItem } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import {
  Refresh,
  Pen,
  Logout,
  Camera,
  DocumentText,
  Smartphone,
  Card2,
  ChatRound,
  AltArrowRight,
  Settings,
  MedalStar,
} from "@solar-icons/react";
import { FloatingLabelInput, FloatingLabelSelect } from "@/components/ui/floating-input";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { clientCardQuery, type ClientCard } from "@/lib/client-card";
import { PageShell } from "@/components/page-shell";
import { IS_PACKAGES } from "@/lib/terms";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Профиль — Base40" },
      { name: "description", content: "Профиль участника Base40." },
    ],
  }),
  component: ProfilePage,
});

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

type ClientRow = ClientCard;

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

function composeFullName(
  c: Pick<ClientRow, "full_name" | "first_name" | "last_name"> | null | undefined,
) {
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

function formFromClient(client: ClientRow) {
  const split = splitFullName(client.full_name);
  return {
    first_name: client.first_name ?? split.first,
    last_name: client.last_name ?? split.last,
    phone: client.phone ?? "",
    email: client.email ?? "",
    birthday: client.birthday ?? "",
    gender: client.gender ?? "",
  };
}

/**
 * Дата рождения (date, "YYYY-MM-DD") для показа. Не через new Date(): строка
 * без времени разбирается как полночь UTC, и западнее Гринвича выходил
 * предыдущий день.
 */
function formatBirthday(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/** Сторона квадратной аватарки после сжатия, px. */
const AVATAR_SIZE = 512;

/**
 * Фото с телефона — в квадрат 512px WebP (JPEG, если браузер не умеет WebP):
 * снимок камеры весит 3–10 МБ (раньше такие отклонялись «Файл больше 5 МБ»),
 * HEIC с iPhone браузер сам декодирует. Ориентацию EXIF браузер учитывает при
 * отрисовке. Не удалось открыть картинку — null.
 */
async function squareAvatar(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) return null;
    const size = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
    const webp = await encode("image/webp");
    // Старый Safari вместо WebP молча отдаёт PNG — тогда JPEG (легче).
    return webp?.type === "image/webp" ? webp : await encode("image/jpeg");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Загружает аватар в storage (папка {uid}/ бакета avatars — политики
 * db/migrations/2026-10-12_zz_packages_app_fixes.sql) и пишет ссылку в
 * карточку клиента. Общая для страницы профиля и шторки редактирования.
 * Возвращает обновлённую строку clients или undefined, если загрузка не
 * удалась (ошибку уже показали тостом).
 */
async function uploadAvatar(userId: string, file: File): Promise<ClientRow | undefined> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
    toast.error("Выберите изображение");
    return undefined;
  }
  const blob = await squareAvatar(file);
  if (!blob) {
    toast.error("Не удалось открыть фото. Выберите снимок в формате JPG или PNG.");
    return undefined;
  }
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  // Новое имя на каждую загрузку: без перезаписи (upsert требовал прав на
  // чтение и правку старого файла) и без старой картинки из кэша браузера.
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (upErr) {
    toast.error("Не удалось загрузить фото: " + upErr.message);
    return undefined;
  }
  const publicUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  const { data: updated, error: dbErr } = await supabase
    .from("clients")
    .update({ photo_url: publicUrl } as never)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (dbErr) {
    toast.error("Не удалось сохранить фото: " + dbErr.message);
    return undefined;
  }
  // Ни одной строки: карточки нет или правка своей карточки закрыта — без
  // этого показывали «Аватар обновлён», а фото пропадало после обновления.
  if (!updated) {
    toast.error("Не удалось сохранить фото в профиль. Обратитесь к администратору студии.");
    return undefined;
  }
  toast.success("Фото обновлено");
  return updated as ClientRow;
}

/**
 * Сохраняет поля карточки клиента. Если update не нашёл строку (карточки нет),
 * заводит её через ensure_client_profile, как везде в приложении, и повторяет
 * update. Прямой insert создавал карточку без studio_id и мог продублировать
 * существующую.
 */
async function saveClient(
  userId: string,
  payload: ClientUpdate,
): Promise<{ row: ClientRow } | { error: string }> {
  const update = () => supabase.from("clients").update(payload).eq("user_id", userId).select();
  let { data, error } = await update();
  if (!error && !data?.length) {
    // ensure_client_profile нет в сгенерированных types.ts.
    const { error: ensureError } = await (
      supabase as unknown as {
        rpc: (fn: "ensure_client_profile") => PromiseLike<{ error: { message: string } | null }>;
      }
    ).rpc("ensure_client_profile");
    if (ensureError) return { error: ensureError.message };
    ({ data, error } = await update());
  }
  if (error) return { error: error.message };
  const row = data?.[0];
  return row ? { row: row as ClientRow } : { error: "карточка клиента не найдена" };
}

function ProfilePage() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  // Карточка — из общего с главной кэша (src/lib/client-card.ts): профиль
  // открывается сразу, свежие данные подтягиваются фоном.
  const cardQuery = clientCardQuery(user?.id ?? null);
  const { data: cardData, isPending } = useQuery(cardQuery);
  const client = cardData ?? null;
  const loading = !!user && isPending;
  const setClient = (fn: (prev: ClientRow | null) => ClientRow) =>
    queryClient.setQueryData(cardQuery.queryKey, (prev) => fn(prev ?? null));
  const [editOpen, setEditOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    // Уникальное имя канала: с прежним именем supabase.channel() отдавал
    // ещё закрывающийся канал прошлого эффекта, и подписка молча умирала.
    const channel = supabase
      .channel(`clients-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clients", filter: `user_id=eq.${user.id}` },
        () => queryClient.invalidateQueries({ queryKey: ["client-card", user.id] }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  const fullName =
    composeFullName(client) || (user?.user_metadata?.full_name as string) || "Участник";
  const email = client?.email || user?.email || "";
  const phone = client?.phone || "";
  const birthday = client?.birthday || "";
  const gender = client?.gender || "";

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setUploadingAvatar(true);
    const updated = await uploadAvatar(user.id, file);
    setUploadingAvatar(false);
    if (updated) setClient((prev) => ({ ...prev, ...updated }));
  };

  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-semibold">Профиль</h1>
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
              className="absolute top-3 right-3 h-9 w-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
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
                  {client?.photo_url && (
                    <SquircleAvatarImage src={client.photo_url} alt={fullName} />
                  )}
                  <SquircleAvatarFallback className="bg-muted text-foreground text-3xl font-semibold">
                    {loading ? (
                      <Refresh className="h-6 w-6 animate-spin" weight="BoldDuotone" />
                    ) : (
                      initials(fullName)
                    )}
                  </SquircleAvatarFallback>
                </SquircleAvatar>
                {uploadingAvatar && (
                  <div
                    className="absolute inset-0 bg-black/40 flex items-center justify-center"
                    style={{
                      clipPath: squircleClipPath(120),
                      WebkitClipPath: squircleClipPath(120),
                    }}
                  >
                    <Refresh className="h-6 w-6 text-white animate-spin" weight="BoldDuotone" />
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center border-2 border-background">
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
                value={birthday ? formatBirthday(birthday) : ""}
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
                  <MedalStar className="h-6 w-6 text-yellow-500" weight="BoldDuotone" />
                  <span className="font-semibold text-foreground text-base">1 250</span>
                </span>
              </div>
              <AltArrowRight className="h-5 w-5 text-muted-foreground" weight="LineDuotone" />
            </button>
          </section>

          <div className="h-3 bg-muted" />

          {/* Блок: ссылки */}
          <section className="bg-background rounded-t-[14px] rounded-b-[14px] py-1">
            <ul className="divide-y divide-border">
              <ProfileLink
                icon={<DocumentText className="h-5 w-5" weight="BoldDuotone" />}
                label="Правовые документы"
              />
              {/* Оплаты в приложении пакетных студий пока нет (решение владельца
                  2026-10-12) — блок способов оплаты не показываем. */}
              {!IS_PACKAGES && (
                <ProfileLink
                  icon={<Card2 className="h-5 w-5" weight="BoldDuotone" />}
                  label="Способы оплаты"
                  sublabel="Mastercard •••• 4242"
                  right={<MastercardBadge />}
                />
              )}
              <ProfileLink
                icon={<ChatRound className="h-5 w-5" weight="BoldDuotone" />}
                label="Поддержка"
              />
              <ProfileLink
                icon={<Settings className="h-5 w-5" weight="BoldDuotone" />}
                label="Язык"
                sublabel="Русский"
              />
              <ProfileLink
                icon={<Smartphone className="h-5 w-5" weight="BoldDuotone" />}
                label="О приложении"
              />
            </ul>
          </section>

          <div className="h-3 bg-muted" />

          {/* Блок: выход */}
          <section className="bg-background rounded-t-[14px] px-4 py-5">
            <Button variant="outline" className="w-full shadow-none" onClick={() => signOut()}>
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
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 text-sm font-medium break-words ${isEmpty ? "text-muted-foreground/60 italic" : ""}`}
      >
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
      <button type="button" className="w-full flex items-center gap-3 px-4 py-4 text-left">
        <span className="text-muted-foreground">{icon}</span>
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
        <path d="M12 3.6a6 6 0 0 1 0 8.8 6 6 0 0 1 0-8.8z" fill="#FF5F00" />
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
  const [form, setForm] = useState(() => formFromClient(client));
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(client.photo_url ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setUploadingAvatar(true);
    const updated = await uploadAvatar(user.id, file);
    setUploadingAvatar(false);
    if (!updated) return;
    setAvatarUrl(updated.photo_url ?? null);
    onSaved(updated);
  };

  // Заполняем форму из карточки только в момент открытия. Раньше эффект
  // срабатывал на каждое изменение `client` — загрузка аватара в этой же
  // шторке или realtime-обновление карточки затирали несохранённые правки.
  // Аватар тоже берём свежий: шторка смонтирована постоянно, и фото,
  // сменённое на странице профиля, здесь оставалось старым.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setForm(formFromClient(client));
      setAvatarUrl(client.photo_url ?? null);
    }
    wasOpenRef.current = open;
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
    const result = await saveClient(user.id, payload);
    setSaving(false);
    if ("error" in result) {
      toast.error("Не удалось сохранить: " + result.error);
      return;
    }
    toast.success("Профиль обновлён");
    onSaved(result.row);
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
              <span className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center border-2 border-background">
                <Camera className="h-4 w-4" />
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

          <FloatingLabelInput
            label="Фамилия"
            id="last_name"
            value={form.last_name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, last_name: e.target.value }))
            }
            maxLength={60}
            autoComplete="family-name"
          />

          <FloatingLabelInput
            label="Имя"
            id="first_name"
            value={form.first_name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, first_name: e.target.value }))
            }
            maxLength={60}
            autoComplete="given-name"
          />

          <FloatingLabelInput
            label="Телефон"
            id="phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, phone: e.target.value }))
            }
            maxLength={32}
            autoComplete="tel"
            placeholder="+7 ___ ___ __ __"
          />

          <FloatingLabelInput
            label="Email"
            id="email"
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, email: e.target.value }))
            }
            maxLength={255}
            autoComplete="email"
          />

          <FloatingLabelInput
            label="Дата рождения"
            id="birthday"
            type="date"
            value={form.birthday}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, birthday: e.target.value }))
            }
          />

          <FloatingLabelSelect
            label="Пол"
            value={form.gender || "unset"}
            onValueChange={(v: string) =>
              setForm((f) => ({ ...f, gender: v === "unset" ? "" : v }))
            }
          >
            <SelectItem value="unset">Не указано</SelectItem>
            <SelectItem value="male">Мужской</SelectItem>
            <SelectItem value="female">Женский</SelectItem>
          </FloatingLabelSelect>
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
