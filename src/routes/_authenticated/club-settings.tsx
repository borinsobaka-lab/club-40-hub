import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/club-settings")({
  head: () => ({ meta: [{ title: "Настройки клуба — Base40 Admin" }] }),
  component: ClubSettingsPage,
});

type Settings = {
  id: boolean;
  write_url: string | null;
  call_url: string | null;
  feedback_url: string | null;
  cancel_booking_minutes: number;
};

type FormValues = {
  writeUrl: string;
  callUrl: string;
  feedbackUrl: string;
  cancelMinutes: string;
};

function toFormValues(s: Settings | null | undefined): FormValues {
  return {
    writeUrl: s?.write_url ?? "",
    callUrl: s?.call_url ?? "",
    feedbackUrl: s?.feedback_url ?? "",
    cancelMinutes: String(s?.cancel_booking_minutes ?? 180),
  };
}

// club_settings — глобальный синглтон (id = true), не привязан к студии.
const QUERY_KEY = ["club_settings"];

function ClubSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isPending: loading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () =>
      unwrap<Settings | null>(
        supabase.from("club_settings").select("*").eq("id", true).maybeSingle(),
      ),
    meta: { errorMessage: "Не удалось загрузить настройки" },
  });

  // Правки держим отдельно от загруженных настроек: пока поле не трогали,
  // форма показывает данные с сервера (и свежие после «Обновить»), а начатые
  // правки перезагрузка не затирает.
  const [draft, setDraft] = useState<FormValues | null>(null);
  const form = draft ?? toFormValues(settings);
  const setField = (field: keyof FormValues, value: string) =>
    setDraft({ ...form, [field]: value });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const minutes = Number.parseInt(form.cancelMinutes, 10);
    if (Number.isNaN(minutes) || minutes < 0) {
      toast.error("Укажите корректное число минут");
      return;
    }
    setSaving(true);
    try {
      const saved = {
        id: true,
        write_url: form.writeUrl.trim() || null,
        call_url: form.callUrl.trim() || null,
        feedback_url: form.feedbackUrl.trim() || null,
        cancel_booking_minutes: minutes,
      };
      const { error } = await supabase
        .from("club_settings")
        .upsert({ ...saved, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) {
        toast.error("Не удалось сохранить", { description: error.message });
        return;
      }
      // Сохранённое становится «серверным» состоянием формы — без лишнего запроса.
      queryClient.setQueryData<Settings | null>(QUERY_KEY, (prev) => ({ ...prev, ...saved }));
      setDraft(null);
      toast.success("Настройки сохранены");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell
      title="Настройки клуба"
      actions={
        <Button onClick={handleSave} disabled={saving || loading}>
          {saving ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Save />
          )}
          Сохранить
        </Button>
      }
    >
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-8">
          <section className="space-y-4 rounded-lg border bg-card p-6">
            <div>
              <h2 className="text-lg font-semibold">Кнопки на главном экране</h2>
              <p className="text-sm text-muted-foreground">
                Ссылки для кнопок «Написать», «Позвонить» и «Обратная связь» в мобильном приложении.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="write">Ссылка для кнопки «Написать»</Label>
              <Input
                id="write"
                placeholder="https://wa.me/79991234567"
                value={form.writeUrl}
                onChange={(e) => setField("writeUrl", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Например, ссылка на WhatsApp-чат клуба.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="call">Ссылка для кнопки «Позвонить»</Label>
              <Input
                id="call"
                placeholder="tel:+79991234567"
                value={form.callUrl}
                onChange={(e) => setField("callUrl", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Телефонный номер в формате tel:.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback">Ссылка для кнопки «Обратная связь»</Label>
              <Input
                id="feedback"
                placeholder="https://forms.example.com/feedback"
                value={form.feedbackUrl}
                onChange={(e) => setField("feedbackUrl", e.target.value)}
              />
            </div>
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-6">
            <div>
              <h2 className="text-lg font-semibold">Отмена бронирования тренировок</h2>
              <p className="text-sm text-muted-foreground">
                За сколько минут до начала тренировки пользователь ещё может её отменить. После
                этого времени в приложении кнопка отмены недоступна.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cancel">Минут до начала тренировки</Label>
              <Input
                id="cancel"
                type="number"
                min={0}
                step={1}
                value={form.cancelMinutes}
                onChange={(e) => setField("cancelMinutes", e.target.value)}
                className="max-w-[200px]"
              />
              <p className="text-xs text-muted-foreground">
                Например, 180 — отменить можно не позже чем за 3 часа до начала.
              </p>
            </div>
          </section>
        </div>
      )}
    </AdminShell>
  );
}
