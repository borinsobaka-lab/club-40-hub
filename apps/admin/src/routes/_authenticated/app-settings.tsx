import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";
import {
  APP_ICON_MIN_SIZE,
  APP_NAME_DEFAULT,
  APP_NAME_FITS,
  APP_NAME_MAX,
  appIconUrl,
  uploadAppIcon,
} from "@/lib/app-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, InfoNote } from "@/components/ui/form-field";
import { AppSettingsFormSkeleton, AppSettingsPageSkeleton } from "@/components/page-skeletons";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app-settings")({
  head: () => ({ meta: [{ title: "Настройки приложения — Base40 Admin" }] }),
  pendingComponent: AppSettingsPageSkeleton,
  component: AppSettingsPage,
});

const TIPS = {
  icon: "Иконка вкладки браузера и значок на рабочем столе, когда клиент сохраняет приложение на телефон или компьютер.",
  name: "Название под значком приложения на рабочем столе телефона или компьютера.",
};

type Settings = {
  app_name: string | null;
  app_icon_path: string | null;
};

type FormValues = {
  name: string;
  /** Папка с иконками в бакете app-icons; null — иконка Base40 по умолчанию. */
  iconPath: string | null;
};

function toFormValues(s: Settings | null | undefined): FormValues {
  return { name: s?.app_name ?? "", iconPath: s?.app_icon_path ?? null };
}

// club_settings — глобальный синглтон (id = true), тот же кэш, что у
// «Контактов и правил» (/club-settings).
const QUERY_KEY = ["club_settings"];

const FORM_ID = "app-settings-form";

function AppSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isPending: loading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () =>
      unwrap<Settings | null>(
        supabase.from("club_settings").select("*").eq("id", true).maybeSingle(),
      ),
    meta: { errorMessage: "Не удалось загрузить настройки" },
  });

  // Как в «Контактах и правилах»: правки отдельно от загруженного, пока поле
  // не трогали — форма показывает данные с сервера.
  const [draft, setDraft] = useState<FormValues | null>(null);
  const form = draft ?? toFormValues(settings);
  const setField = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setDraft({ ...form, [field]: value });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const name = form.name.trim();
    if (name.length > APP_NAME_MAX) {
      toast.error(`Подпись — не длиннее ${APP_NAME_MAX} символов`);
      return;
    }
    setSaving(true);
    try {
      const saved = { app_name: name || null, app_icon_path: form.iconPath };
      const { error } = await supabase
        .from("club_settings")
        .upsert({ id: true, ...saved, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) {
        toast.error("Не удалось сохранить", { description: error.message });
        return;
      }
      queryClient.setQueryData<Settings | null>(QUERY_KEY, (prev) => ({ ...prev, ...saved }));
      setDraft(null);
      toast.success("Настройки сохранены");
    } finally {
      setSaving(false);
    }
  };

  const shownName = form.name.trim() || APP_NAME_DEFAULT;

  return (
    <AdminShell
      title="Настройки приложения"
      actions={
        <Button type="submit" form={FORM_ID} disabled={saving || loading}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Сохранить
        </Button>
      }
    >
      {loading ? (
        <AppSettingsFormSkeleton />
      ) : (
        <form
          id={FORM_ID}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="max-w-2xl space-y-8"
        >
          <section className="space-y-4 rounded-lg border bg-background p-6">
            <div>
              <h2 className="text-lg font-semibold">Установка приложения</h2>
              <p className="text-sm text-muted-foreground">
                Как приложение выглядит во вкладке браузера и на рабочем столе, когда клиент
                сохраняет его на телефон или компьютер. Одни настройки для app.base40.fit и
                pack.base40.fit.
              </p>
            </div>

            <FormField
              label="Иконка приложения"
              tip={TIPS.icon}
              hint={`Квадрат PNG, JPG или SVG от ${APP_ICON_MIN_SIZE}×${APP_ICON_MIN_SIZE} px, без скруглённых углов — телефон скруглит сам. Важное — ближе к центру: Android может обрезать края кругом. Без своей — иконка Base40.`}
              htmlFor={null}
            >
              <AppIconField value={form.iconPath} onChange={(path) => setField("iconPath", path)} />
            </FormField>

            <FormField
              label="Подпись под значком"
              tip={TIPS.name}
              hint={
                shownName.length > APP_NAME_FITS
                  ? `Длиннее ${APP_NAME_FITS} символов — на телефоне подпись обрежется многоточием.`
                  : `Пусто — «${APP_NAME_DEFAULT}».`
              }
            >
              <Input
                placeholder={APP_NAME_DEFAULT}
                maxLength={APP_NAME_MAX}
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                className="max-w-80"
              />
            </FormField>

            <HomeScreenPreview iconPath={form.iconPath} name={shownName} />

            <InfoNote>
              Уже установленные приложения подхватывают новую иконку и подпись не сразу: Android
              проверяет их сам, обычно в течение суток; на iPhone значок обновится только после
              повторного «На экран „Домой“».
            </InfoNote>
          </section>
        </form>
      )}
    </AdminShell>
  );
}

/** Значок приложения: своя иконка или Base40 по умолчанию. */
function AppIcon({ iconPath, className }: { iconPath: string | null; className?: string }) {
  return (
    <img
      src={iconPath ? appIconUrl(iconPath, "icon192") : "/icon-192.png"}
      alt=""
      className={cn("object-cover", className)}
    />
  );
}

/** Превью + «Загрузить/Заменить» + «Вернуть Base40». */
function AppIconField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      onChange(await uploadAppIcon(file));
    } catch (err) {
      toast.error("Ошибка загрузки: " + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[22%] border bg-muted text-muted-foreground">
        {uploading ? (
          <ImageIcon className="h-4 w-4" />
        ) : (
          <AppIcon iconPath={value} className="h-full w-full" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload(file);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="animate-spin" /> Загрузка…
            </>
          ) : value ? (
            "Заменить"
          ) : (
            "Загрузить"
          )}
        </Button>
        {value && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onChange(null)}
          >
            Вернуть иконку Base40
          </Button>
        )}
      </div>
    </div>
  );
}

/** Как значок будет выглядеть на рабочем столе телефона и во вкладке браузера. */
function HomeScreenPreview({ iconPath, name }: { iconPath: string | null; name: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">Предпросмотр</p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex h-36 w-44 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950">
          <div className="flex w-[72px] flex-col items-center gap-1.5">
            <AppIcon iconPath={iconPath} className="h-14 w-14 rounded-[22%] shadow-md" />
            <span className="w-full truncate text-center text-[11px] leading-tight text-white">
              {name}
            </span>
          </div>
        </div>
        <div className="flex h-9 w-56 items-center gap-2 rounded-t-lg border border-b-0 bg-muted/60 px-3">
          <AppIcon iconPath={iconPath} className="h-4 w-4 rounded-sm" />
          <span className="truncate text-xs text-foreground">Base40</span>
        </div>
      </div>
    </div>
  );
}
