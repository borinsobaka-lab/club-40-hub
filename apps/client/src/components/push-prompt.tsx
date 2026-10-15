import { useEffect, useState } from "react";
import { useLoaderData } from "@tanstack/react-router";
import { Drawer as DrawerPrimitive } from "vaul";
import { AltArrowRight, Bell, BellOff, Refresh } from "@solar-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useI18n, useT } from "@/i18n";
import { detectPlatform } from "@/lib/pwa-install";
import { enablePush, prefetchPushKey, readPushPermission, usePushPermission } from "@/lib/push";
import { IS_PACKAGES } from "@/lib/terms";

/**
 * Включение пуш-уведомлений (решение владельца 2026-10-15): плашка на
 * главной (и в «Уведомлениях»), пока клиент не ответил на запрос; строка в
 * профиле — «Включены» или красным «Выключены» с кнопкой «Включить». Отказ
 * браузеры запоминают: повторное окно не покажут, поэтому после «Включить»
 * при запрете — шторка, как включить в настройках телефона. Логика — lib/push.ts.
 */
function useEnablePush() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Ключ сервера — заранее: по нажатию подписка не ждёт сети.
  useEffect(() => {
    void prefetchPushKey();
  }, []);

  const enable = async () => {
    if (busy || !user) return;
    // Запрещено раньше — браузер окно не покажет, нужна подсказка; только
    // что нажали «Не разрешать» — подсказку не навязываем.
    const before = readPushPermission();
    setBusy(true);
    try {
      const { permission, subscribed } = await enablePush(user.id, locale);
      if (permission === "granted") {
        if (subscribed) toast.success(t("Уведомления включены"));
        else toast.error(t("Не удалось включить уведомления. Попробуйте ещё раз"));
      } else if (permission === "denied" && before === "default") {
        toast(t("Уведомления выключены. Включить их можно в профиле"));
      } else if (permission === "denied" || permission === "unsupported") {
        setHelpOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return { busy, enable, helpOpen, setHelpOpen };
}

/**
 * Плашка «Включите уведомления» — пока клиент не разрешил и не запретил.
 * Светло-красная, текст и иконка красные — тот же красный, что «Выключены» в
 * профиле (решение владельца 2026-10-15: фирменный цвет был слишком ярким).
 */
export function PushBanner({ className = "" }: { className?: string }) {
  const t = useT();
  const permission = usePushPermission();
  const { busy, enable, helpOpen, setHelpOpen } = useEnablePush();

  if (permission !== "default" && !helpOpen) return null;
  return (
    <>
      {permission === "default" && (
        <div className={className}>
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-2xl bg-destructive/10 p-3 text-left text-destructive transition active:scale-[0.99] disabled:opacity-80"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <Bell className="h-5 w-5" weight="BoldDuotone" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold leading-snug">{t("Включите уведомления")}</span>
              <span className="block text-sm leading-snug opacity-80">
                {IS_PACKAGES
                  ? t("Чтобы получать новости студии")
                  : t("Чтобы получать новости клуба")}
              </span>
            </span>
            {busy ? (
              <Refresh className="h-5 w-5 shrink-0 animate-spin" weight="BoldDuotone" />
            ) : (
              <AltArrowRight className="h-5 w-5 shrink-0 opacity-80" weight="BoldDuotone" />
            )}
          </button>
        </div>
      )}
      <PushHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

/** Строка «Push-уведомления» в профиле. */
export function PushSettingsRow() {
  const t = useT();
  const permission = usePushPermission();
  const { busy, enable, helpOpen, setHelpOpen } = useEnablePush();
  const on = permission === "granted";

  return (
    <li>
      <div className="flex w-full items-center gap-3 px-4 py-4">
        <span className="text-muted-foreground">
          {on ? (
            <Bell className="h-5 w-5" weight="BoldDuotone" />
          ) : (
            <BellOff className="h-5 w-5" weight="BoldDuotone" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t("Push-уведомления")}</span>
          {permission !== null && (
            <span
              className={`mt-0.5 block text-xs ${on ? "text-muted-foreground" : "font-medium text-destructive"}`}
            >
              {on
                ? t("Включены")
                : permission === "unsupported"
                  ? t("Недоступны на этом телефоне")
                  : t("Выключены")}
            </span>
          )}
        </span>
        {permission !== null && !on && (
          <Button size="sm" onClick={() => void enable()} disabled={busy}>
            {busy && <Refresh className="animate-spin" weight="BoldDuotone" />}
            {t("Включить")}
          </Button>
        )}
      </div>
      <PushHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </li>
  );
}

/** Как включить уведомления, если браузер больше не показывает окно. */
function PushHelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const permission = usePushPermission();
  const app = useLoaderData({ from: "__root__" });
  const appName = app?.name ?? "Base40";
  const platform =
    typeof navigator === "undefined"
      ? "other"
      : detectPlatform(navigator.userAgent, navigator.maxTouchPoints);

  const steps =
    platform === "ios"
      ? [
          t("Откройте «Настройки» телефона"),
          t("Выберите «Уведомления»"),
          t("Найдите в списке {app}", { app: appName }),
          t("Включите «Допуск уведомлений»"),
        ]
      : platform === "android"
        ? [
            t("Нажмите и удерживайте значок {app} на экране телефона", { app: appName }),
            t("Выберите «О приложении» (значок ⓘ)"),
            t("Откройте «Уведомления» и включите их"),
          ]
        : [t("Разрешите уведомления для этого приложения в настройках браузера")];

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DrawerPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
          aria-describedby={undefined}
        >
          <div className="mx-auto mb-1 mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-3">
            <DrawerPrimitive.Title className="text-xl font-semibold">
              {permission === "unsupported"
                ? t("Уведомления недоступны")
                : t("Как включить уведомления")}
            </DrawerPrimitive.Title>
            {permission === "unsupported" ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {platform === "ios"
                  ? t(
                      "На iPhone уведомления работают с iOS 16.4 в приложении, установленном на экран «Домой». Обновите систему телефона.",
                    )
                  : t("Этот браузер не поддерживает уведомления.")}
              </p>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t(
                    "Уведомления запрещены на этом телефоне. Повторно запросить разрешение приложение не может — включите их в настройках:",
                  )}
                </p>
                <ol className="mt-4 space-y-3">
                  {steps.map((step, i) => (
                    <li key={step} className="flex items-start gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 text-sm text-muted-foreground">
                  {t("Вернитесь в приложение — уведомления включатся сами.")}
                </p>
              </>
            )}
            <Button className="mt-6 w-full" onClick={() => onOpenChange(false)}>
              {t("Понятно")}
            </Button>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
