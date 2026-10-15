import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AltArrowRight, Copy, Heart, Smartphone } from "@solar-icons/react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { BottomDrawer } from "@/components/bottom-drawer";
import { useAuth } from "@/hooks/use-auth";
import { useClientStudio } from "@/hooks/use-studios";
import { LOCALES, msg, useI18n, useLocalize, useT } from "@/i18n";
import { APP_FORMAT } from "@/lib/app-format";
import { APP_VERSION } from "@/lib/app-version";
import { clientCardQuery } from "@/lib/client-card";
import { copyText } from "@/lib/clipboard";
import { readPushPermission, type PushPermission } from "@/lib/push";
import { detectPlatform, isInstalledDisplay } from "@/lib/pwa-install";
import { IS_PACKAGES } from "@/lib/terms";

/**
 * «О приложении» в профиле (решение владельца 2026-10-15): по нажатию строки
 * снизу выдвигается шторка (как у новостей и тренировок) — пара слов о
 * приложении, технические данные для разбора проблем клиента и «Скопировать
 * техническую информацию» (клиент отправляет текст администратору в
 * мессенджер). Копируется то же, что на экране, на
 * языке приложения. Новое поле — строкой в TechRow ниже (подпись — msg()).
 */

const APP_NAME = IS_PACKAGES ? "Lady Stretch" : "Base40";

type TechRow = { label: string; value: string };

const PUSH_PERMISSION_LABEL: Record<PushPermission, string> = {
  granted: msg("Разрешены"),
  denied: msg("Запрещены"),
  default: msg("Ещё не спрашивали"),
  unsupported: msg("Не поддерживаются"),
};

/** Время сборки одной строкой, в UTC — одинаково у клиента и в логах сервера. */
function formatBuildTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

type PushDevice = "subscribed" | "not-subscribed" | "no-worker" | "unsupported";

/** Есть ли у телефона подписка на пуши и работает ли service worker. */
async function readPushDevice(): Promise<PushDevice> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return "no-worker";
    if (!("pushManager" in registration)) return "unsupported";
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? "subscribed" : "not-subscribed";
  } catch {
    return "unsupported";
  }
}

const PUSH_DEVICE_LABEL: Record<PushDevice, string> = {
  subscribed: msg("Подписано"),
  "not-subscribed": msg("Не подписано"),
  "no-worker": msg("Нет service worker"),
  unsupported: msg("Не поддерживается"),
};

export function AboutAppRow() {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-4 text-left"
      >
        <span className="text-muted-foreground">
          <Smartphone className="h-5 w-5" weight="BoldDuotone" />
        </span>
        <span className="flex-1 min-w-0 block text-sm font-medium">{t("О приложении")}</span>
        <span className="text-sm text-muted-foreground">
          {t("Версия {version}", { version: APP_VERSION })}
        </span>
        <AltArrowRight className="h-4 w-4 text-muted-foreground" weight="BoldDuotone" />
      </button>
      {/* Содержимое монтируется в открытой шторке: данные устройства — только в браузере. */}
      <BottomDrawer open={open} onOpenChange={setOpen} title={t("О приложении")}>
        <AboutAppDetails />
      </BottomDrawer>
    </li>
  );
}

function AboutAppDetails() {
  const t = useT();
  const loc = useLocalize();
  const { locale } = useI18n();
  const { user } = useAuth();
  const { data: card } = useQuery(clientCardQuery(user?.id ?? null));
  const studio = useClientStudio();
  const [pushDevice, setPushDevice] = useState<PushDevice | null>(null);
  const [copied, setCopied] = useState(false);
  // Снимок на момент открытия: время и сеть — те, что были при проблеме.
  const [now] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    void readPushDevice().then((state) => alive && setPushDevice(state));
    return () => {
      alive = false;
    };
  }, []);

  const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const languageName = LOCALES.find((l) => l.code === locale)?.name ?? locale;
  const dash = "—";

  const rows: TechRow[] = [
    { label: t("Версия"), value: APP_VERSION },
    { label: t("Сборка"), value: formatBuildTime(__BUILD_TIME__) },
    { label: t("Адрес"), value: `${window.location.host} (${APP_FORMAT})` },
    { label: t("ID учётной записи"), value: user?.id ?? dash },
    { label: t("Почта"), value: user?.email ?? dash },
    { label: t("ID карточки клиента"), value: card?.id ?? dash },
    {
      label: IS_PACKAGES ? t("Студия") : t("Клуб"),
      value: studio ? `${loc(studio).name} (${studio.id})` : dash,
    },
    { label: t("Язык приложения"), value: `${languageName} (${locale})` },
    { label: t("Язык устройства"), value: navigator.language || dash },
    {
      label: t("Устройство"),
      value: platform === "ios" ? "iOS" : platform === "android" ? "Android" : t("Другое"),
    },
    {
      label: t("Запуск"),
      value: isInstalledDisplay() ? t("Установленное приложение") : t("Вкладка браузера"),
    },
    { label: t("Уведомления"), value: t(PUSH_PERMISSION_LABEL[readPushPermission()]) },
    {
      label: t("Подписка на уведомления"),
      value: pushDevice ? t(PUSH_DEVICE_LABEL[pushDevice]) : "…",
    },
    {
      label: t("Экран"),
      value: `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x, ${t("окно")} ${window.innerWidth}×${window.innerHeight}`,
    },
    {
      label: t("Часовой пояс"),
      value: Intl.DateTimeFormat().resolvedOptions().timeZone || dash,
    },
    { label: t("Сеть"), value: navigator.onLine ? t("В сети") : t("Нет сети") },
    { label: t("Время"), value: now.toISOString() },
    { label: t("Браузер"), value: navigator.userAgent },
  ];

  const handleCopy = async () => {
    const text = [
      `${APP_NAME} — ${t("техническая информация")}`,
      ...rows.map((row) => `${row.label}: ${row.value}`),
    ].join("\n");
    if (await copyText(text)) {
      setCopied(true);
      toast.success(t("Техническая информация скопирована"));
    } else {
      toast.error(t("Не удалось скопировать — выделите текст и скопируйте его вручную"));
    }
  };

  return (
    <div className="space-y-4">
      <p className="flex gap-2 text-sm leading-relaxed">
        <Heart className="h-5 w-5 shrink-0 text-primary" weight="Bold" />
        <span>
          {IS_PACKAGES
            ? t(
                "Мы сделали это приложение с любовью для клиентов студии Lady Stretch — чтобы записываться на тренировки и следить за абонементом было легко и приятно.",
              )
            : t(
                "Мы сделали это приложение с любовью для клиентов клуба Base40 — чтобы записываться на тренировки и следить за абонементом было легко и приятно.",
              )}
        </span>
      </p>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("Техническая информация")}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "Если что-то работает не так, скопируйте эти данные и отправьте администратору — так мы быстрее разберёмся.",
          )}
        </p>
        <dl className="rounded-2xl bg-muted px-3 py-2 text-xs select-text divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-3 py-1.5">
              <dt className="w-[40%] shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 flex-1 break-all font-mono">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <Button variant="outline" className="w-full shadow-none" onClick={() => void handleCopy()}>
        {copied ? <Check strokeWidth={3} /> : <Copy />}
        {copied ? t("Скопировано") : t("Скопировать техническую информацию")}
      </Button>
    </div>
  );
}
