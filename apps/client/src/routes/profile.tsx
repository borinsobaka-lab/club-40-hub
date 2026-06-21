import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { LogOut, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

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
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  gender?: string | null;
};

const profileSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Укажите имя")
    .max(120, "Слишком длинное имя"),
  phone: z
    .string()
    .trim()
    .max(32, "Слишком длинный номер")
    .optional()
    .or(z.literal("")),
  email: z
    .string()
    .trim()
    .email("Некорректный email")
    .max(255)
    .optional()
    .or(z.literal("")),
  birthday: z.string().optional().or(z.literal("")),
  gender: z.string().optional().or(z.literal("")),
});

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
        setClient((data as ClientRow) ?? null);
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
    client?.full_name ||
    (user?.user_metadata?.full_name as string) ||
    "Участник";
  const email = client?.email || user?.email || "";
  const phone = client?.phone || "";
  const birthday = client?.birthday || "";
  const gender = client?.gender || "";

  return (
    <div className="p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Профиль</h1>
        <p className="text-sm text-muted-foreground">Ваши данные и настройки</p>
      </div>
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
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
              {birthday
                ? new Date(birthday).toLocaleDateString("ru-RU")
                : "—"}
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
  const [form, setForm] = useState({
    full_name: client.full_name ?? "",
    phone: client.phone ?? "",
    email: client.email ?? "",
    birthday: client.birthday ?? "",
    gender: client.gender ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        full_name: client.full_name ?? "",
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
    const payload = {
      full_name: v.full_name,
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
      .select()
      .maybeSingle();
    setSaving(false);

    if (error) {
      toast.error("Не удалось сохранить: " + error.message);
      return;
    }
    toast.success("Профиль обновлён");
    if (data) onSaved(data as ClientRow);
    onOpenChange(false);
  };

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
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Имя</Label>
            <Input
              id="full_name"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              maxLength={120}
              autoComplete="name"
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
