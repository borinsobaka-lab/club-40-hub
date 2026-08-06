import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { useRefreshSignal } from "@/lib/refresh-bus";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/club-settings")({
  head: () => ({ meta: [{ title: "Настройки клуба — CLUB 40 Admin" }] }),
  component: ClubSettingsPage,
});

type Settings = {
  id: boolean;
  write_url: string | null;
  call_url: string | null;
  feedback_url: string | null;
  cancel_booking_minutes: number;
};

function ClubSettingsPage() {
  const refreshSignal = useRefreshSignal();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [writeUrl, setWriteUrl] = useState("");
  const [callUrl, setCallUrl] = useState("");
  const [feedbackUrl, setFeedbackUrl] = useState("");
  const [cancelMinutes, setCancelMinutes] = useState<string>("180");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("club_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error("Не удалось загрузить настройки", { description: error.message });
        }
        const s = data as Settings | null;
        setWriteUrl(s?.write_url ?? "");
        setCallUrl(s?.call_url ?? "");
        setFeedbackUrl(s?.feedback_url ?? "");
        setCancelMinutes(String(s?.cancel_booking_minutes ?? 180));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  const handleSave = async () => {
    const minutes = Number.parseInt(cancelMinutes, 10);
    if (Number.isNaN(minutes) || minutes < 0) {
      toast.error("Укажите корректное число минут");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("club_settings").upsert(
      {
        id: true,
        write_url: writeUrl.trim() || null,
        call_url: callUrl.trim() || null,
        feedback_url: feedbackUrl.trim() || null,
        cancel_booking_minutes: minutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    setSaving(false);
    if (error) {
      toast.error("Не удалось сохранить", { description: error.message });
      return;
    }
    toast.success("Настройки сохранены");
  };

  return (
    <AdminShell
      title="Настройки клуба"
      description="Глобальные параметры мобильного приложения клуба"
      actions={
        <Button onClick={handleSave} disabled={saving || loading}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
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
                value={writeUrl}
                onChange={(e) => setWriteUrl(e.target.value)}
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
                value={callUrl}
                onChange={(e) => setCallUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Телефонный номер в формате tel:.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback">Ссылка для кнопки «Обратная связь»</Label>
              <Input
                id="feedback"
                placeholder="https://forms.example.com/feedback"
                value={feedbackUrl}
                onChange={(e) => setFeedbackUrl(e.target.value)}
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
                value={cancelMinutes}
                onChange={(e) => setCancelMinutes(e.target.value)}
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
