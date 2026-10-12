import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, InfoNote } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ImageUploadField } from "@/components/image-upload-field";
import { FormattedTextarea } from "@/components/formatted-textarea";
import { ContentLangLabel, ContentLangNote, ContentLangSwitch } from "@/components/content-lang";
import { useContentTranslationsValue } from "@/hooks/use-content-translations";
import { parseTranslations, type ContentTranslations } from "@/lib/content-i18n";
import {
  ClubPickerSkeleton,
  ClubSettingsFormSkeleton,
  ClubSettingsPageSkeleton,
} from "@/components/page-skeletons";
import { useActiveStudioId } from "@/hooks/use-active-studio";
import { useStudios } from "@/hooks/use-studios";

const TIPS = {
  club: "У каждого клуба свои ссылки и правила: клиент видит настройки своего клуба.",
  about:
    "Краткое описание клуба на вкладке «Информация». Можно выделять жирным, делать списки и ссылки.",
  photo: "Фото в шапке вкладки «Информация». Лучше горизонтальное, от 1200 px по ширине.",
};

export const Route = createFileRoute("/_authenticated/club-settings")({
  head: () => ({ meta: [{ title: "Контакты и правила — Base40 Admin" }] }),
  pendingComponent: ClubSettingsPageSkeleton,
  component: ClubSettingsPage,
});

type Settings = {
  studio_id: string;
  write_url: string | null;
  call_url: string | null;
  feedback_url: string | null;
  cancel_booking_minutes: number;
  about: string | null;
  photo_path: string | null;
  google_maps_url: string | null;
  yandex_maps_url: string | null;
  instagram_url: string | null;
  whatsapp_url: string | null;
  messenger_url: string | null;
  /** Переводы для приложения: {en|ka: {about}}. */
  translations?: ContentTranslations;
};

type FormValues = {
  writeUrl: string;
  callUrl: string;
  feedbackUrl: string;
  cancelMinutes: string;
  about: string;
  photoPath: string | null;
  googleMapsUrl: string;
  yandexMapsUrl: string;
  instagramUrl: string;
  whatsappUrl: string;
  messengerUrl: string;
  translations: ContentTranslations;
};

function toFormValues(s: Settings | null | undefined): FormValues {
  return {
    writeUrl: s?.write_url ?? "",
    callUrl: s?.call_url ?? "",
    feedbackUrl: s?.feedback_url ?? "",
    cancelMinutes: String(s?.cancel_booking_minutes ?? 180),
    about: s?.about ?? "",
    photoPath: s?.photo_path ?? null,
    googleMapsUrl: s?.google_maps_url ?? "",
    yandexMapsUrl: s?.yandex_maps_url ?? "",
    instagramUrl: s?.instagram_url ?? "",
    whatsappUrl: s?.whatsapp_url ?? "",
    messengerUrl: s?.messenger_url ?? "",
    translations: parseTranslations(s?.translations),
  };
}

// «Контакты и правила» (раньше «Настройки клуба»; URL прежний). У каждого
// клуба свои — studio_app_settings (строка на клуб,
// db/migrations/2026-10-11_zzzzzzzzzz_app_content_by_studio.sql); выбрать
// можно только свои клубы. Строки может и не быть (новый клуб) — тогда
// значения по умолчанию, как в приложении, сохранение её создаст.
const TABLE = "studio_app_settings";

// Кнопка «Сохранить» живёт вне формы (плавающие действия) — связана по id.
const FORM_ID = "club-settings-form";

function ClubSettingsPage() {
  const { data: studios = [], isPending: studiosLoading } = useStudios();
  const activeId = useActiveStudioId();
  const [pickedId, setPickedId] = useState<string | null>(null);
  // По умолчанию — клуб из шапки (если он свой), иначе первый.
  const studioId =
    studios.find((s) => s.id === pickedId)?.id ??
    studios.find((s) => s.id === activeId)?.id ??
    studios[0]?.id ??
    null;
  const [saving, setSaving] = useState(false);

  return (
    <AdminShell
      title="Контакты и правила"
      actions={
        <Button type="submit" form={FORM_ID} disabled={saving || !studioId}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Сохранить
        </Button>
      }
    >
      <div className="max-w-2xl space-y-6">
        {studiosLoading ? (
          <ClubPickerSkeleton />
        ) : studioId ? (
          <FormField label="Клуб" tip={TIPS.club}>
            <Select value={studioId} onValueChange={setPickedId}>
              <SelectTrigger className="w-64 max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {studios.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : (
          <InfoNote variant="empty">У вас нет клубов — настраивать нечего.</InfoNote>
        )}
        {studiosLoading ? (
          <ClubSettingsFormSkeleton />
        ) : (
          studioId && (
            // key: у каждого клуба свои правки, при смене клуба форма заново.
            <ClubSettingsForm key={studioId} studioId={studioId} onSavingChange={setSaving} />
          )
        )}
      </div>
    </AdminShell>
  );
}

function ClubSettingsForm({
  studioId,
  onSavingChange,
}: {
  studioId: string;
  onSavingChange: (saving: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = [TABLE, studioId];
  const { data: settings, isPending: loading } = useQuery({
    queryKey,
    queryFn: () =>
      unwrap<Settings | null>(
        supabase.from(TABLE).select("*").eq("studio_id", studioId).maybeSingle(),
      ),
    meta: { errorMessage: "Не удалось загрузить настройки" },
  });

  // Правки держим отдельно от загруженных настроек: пока поле не трогали,
  // форма показывает данные с сервера (и свежие после «Обновить»), а начатые
  // правки перезагрузка не затирает.
  const [draft, setDraft] = useState<FormValues | null>(null);
  const form = draft ?? toFormValues(settings);
  const setField = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setDraft({ ...form, [field]: value });
  // Переводы «О клубе» — часть черновика; язык правки — свой у формы.
  const tr = useContentTranslationsValue(form.translations, (t) => setField("translations", t));

  const handleSave = async () => {
    const minutes = Number.parseInt(form.cancelMinutes, 10);
    if (Number.isNaN(minutes) || minutes < 0) {
      toast.error("Укажите корректное число минут");
      return;
    }
    onSavingChange(true);
    try {
      const saved = {
        studio_id: studioId,
        write_url: form.writeUrl.trim() || null,
        call_url: form.callUrl.trim() || null,
        feedback_url: form.feedbackUrl.trim() || null,
        cancel_booking_minutes: minutes,
        about: form.about.trim() || null,
        photo_path: form.photoPath,
        google_maps_url: form.googleMapsUrl.trim() || null,
        yandex_maps_url: form.yandexMapsUrl.trim() || null,
        instagram_url: form.instagramUrl.trim() || null,
        whatsapp_url: form.whatsappUrl.trim() || null,
        messenger_url: form.messengerUrl.trim() || null,
        translations: tr.cleaned(),
      };
      const { error } = await supabase
        .from(TABLE)
        .upsert({ ...saved, updated_at: new Date().toISOString() }, { onConflict: "studio_id" });
      if (error) {
        toast.error("Не удалось сохранить", { description: error.message });
        return;
      }
      // Сохранённое становится «серверным» состоянием формы — без лишнего запроса.
      queryClient.setQueryData<Settings | null>(queryKey, saved);
      setDraft(null);
      toast.success("Настройки сохранены");
    } finally {
      onSavingChange(false);
    }
  };

  if (loading) return <ClubSettingsFormSkeleton />;

  return (
    // Форма — чтобы Enter в любом поле сохранял настройки.
    <form
      id={FORM_ID}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="space-y-8"
    >
      <section className="space-y-4 rounded-lg border bg-background p-6">
        <div>
          <h2 className="text-lg font-semibold">Кнопки на главном экране</h2>
          <p className="text-sm text-muted-foreground">
            Ссылки для кнопок «Написать», «Позвонить» и «Обратная связь» в мобильном приложении.
          </p>
        </div>
        <FormField
          label="Ссылка для кнопки «Написать»"
          tip="Пусто — кнопки в приложении не будет."
          hint="Например, ссылка на WhatsApp-чат клуба."
        >
          <Input
            placeholder="https://wa.me/79991234567"
            value={form.writeUrl}
            onChange={(e) => setField("writeUrl", e.target.value)}
          />
        </FormField>
        <FormField
          label="Ссылка для кнопки «Позвонить»"
          tip="Пусто — кнопки в приложении не будет."
          hint="Телефонный номер в формате tel:."
        >
          <Input
            placeholder="tel:+79991234567"
            value={form.callUrl}
            onChange={(e) => setField("callUrl", e.target.value)}
          />
        </FormField>
        <FormField
          label="Ссылка для кнопки «Обратная связь»"
          tip="Например, Google-форма. Пусто — кнопки «Фидбэк» в приложении не будет."
        >
          <Input
            placeholder="https://forms.example.com/feedback"
            value={form.feedbackUrl}
            onChange={(e) => setField("feedbackUrl", e.target.value)}
          />
        </FormField>
      </section>

      <section className="space-y-4 rounded-lg border bg-background p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-lg font-semibold">О клубе</h2>
            <p className="text-sm text-muted-foreground">
              Раздел «Студия» в приложении пакетных клубов, вкладка «Информация»: фото, описание и
              ссылки. Пустые поля в приложении не показываются.
            </p>
          </div>
          <ContentLangSwitch tr={tr} className="mt-0" />
        </div>
        <ContentLangNote lang={tr.lang} />
        <FormField label="Фото" tip={TIPS.photo} htmlFor={null} optional>
          <ImageUploadField
            bucket="studioPhotos"
            folder={studioId}
            value={form.photoPath}
            onChange={(path) => setField("photoPath", path)}
          />
        </FormField>
        <FormField
          label={<ContentLangLabel lang={tr.lang}>Описание</ContentLangLabel>}
          tip={TIPS.about}
          optional
        >
          <FormattedTextarea
            {...tr.text(
              "about",
              form.about,
              (v) => setField("about", v),
              "Пара слов о клубе: формат, атмосфера, как добраться",
            )}
          />
        </FormField>
        <FormField label="Google Карты" optional hint="Ссылка «Поделиться» на точку клуба.">
          <Input
            placeholder="https://maps.app.goo.gl/…"
            value={form.googleMapsUrl}
            onChange={(e) => setField("googleMapsUrl", e.target.value)}
          />
        </FormField>
        <FormField label="Яндекс Карты" optional>
          <Input
            placeholder="https://yandex.ru/maps/-/…"
            value={form.yandexMapsUrl}
            onChange={(e) => setField("yandexMapsUrl", e.target.value)}
          />
        </FormField>
        <FormField label="Instagram" optional>
          <Input
            placeholder="https://instagram.com/…"
            value={form.instagramUrl}
            onChange={(e) => setField("instagramUrl", e.target.value)}
          />
        </FormField>
        <FormField label="WhatsApp" optional hint="Ссылка на чат: wa.me и номер без «+».">
          <Input
            placeholder="https://wa.me/995555123456"
            value={form.whatsappUrl}
            onChange={(e) => setField("whatsappUrl", e.target.value)}
          />
        </FormField>
        <FormField
          label="Facebook Messenger"
          optional
          hint="Ссылка m.me на страницу клуба в Facebook."
        >
          <Input
            placeholder="https://m.me/…"
            value={form.messengerUrl}
            onChange={(e) => setField("messengerUrl", e.target.value)}
          />
        </FormField>
      </section>

      <section className="space-y-4 rounded-lg border bg-background p-6">
        <div>
          <h2 className="text-lg font-semibold">Отмена бронирования тренировок</h2>
          <p className="text-sm text-muted-foreground">
            За сколько минут до начала тренировки пользователь ещё может её отменить. После этого
            времени в приложении кнопка отмены недоступна.
          </p>
        </div>
        <FormField
          label="Минут до начала тренировки"
          required
          tip="Действует для всех занятий клуба. Позже отменить запись может только сотрудник в расписании."
          hint="Например, 180 — отменить можно не позже чем за 3 часа до начала."
        >
          <Input
            type="number"
            min={0}
            step={1}
            value={form.cancelMinutes}
            onChange={(e) => setField("cancelMinutes", e.target.value)}
            className="max-w-48"
          />
        </FormField>
      </section>
    </form>
  );
}
