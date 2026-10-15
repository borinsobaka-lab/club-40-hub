import { useEffect, useMemo, useState } from "react";
import { Copy, DownloadMinimalistic } from "@solar-icons/react";
import { Check } from "lucide-react";

import packagesLogo from "@/assets/packages-logo.svg";
import androidChromeMenu from "@/assets/install/android-chrome-menu.webp";
import iosHomeScreen from "@/assets/install/ios-home-screen.webp";
import iosShareButton from "@/assets/install/ios-share-button.webp";
import iosShareMore from "@/assets/install/ios-share-more.webp";
import { LanguageSwitcher } from "@/components/language-switcher";
import { UnderlineTabs } from "@/components/underline-tabs";
import { Button } from "@/components/ui/button";
import { DarkFrame } from "@/formats/packages/dark-frame";
import { useInstallPrompt } from "@/hooks/use-pwa-install";
import { msg, useT } from "@/i18n";
import {
  detectIosGuide,
  detectPlatform,
  splitQuoted,
  type InstallPlatform,
  type IosGuide,
} from "@/lib/pwa-install";
import { IS_PACKAGES } from "@/lib/terms";

/**
 * Инструкция по установке приложения на телефон — вместо приложения, пока
 * оно открыто во вкладке браузера (решение владельца 2026-10-15: без
 * установки приложение не открывается; заслон — InstallGate в __root.tsx).
 *
 * iPhone — две вкладки: iOS 26+ («Поделиться» спрятан под три точки) и
 * ранние версии; первой открывается та, что подходит по версии Safari
 * (lib/pwa-install.ts). Android — одна инструкция для Chrome, а если Chrome
 * разрешает установку в одно нажатие — ещё и кнопка «Установить приложение».
 * Компьютер — переключатель iPhone / Android: ссылку открывают на телефоне.
 *
 * Тексты шагов — от владельца; названия кнопок телефона — в кавычках, на
 * экране они жирные. Картинки — src/assets/install/ (96×96 от владельца).
 */
type Step = {
  text: string;
  /** Подсказка мелким шрифтом под шагом. */
  hint?: string;
  image?: string;
  /** Под шагом — адрес приложения и кнопка «Скопировать ссылку». */
  copyLink?: boolean;
};

const IOS26_STEPS: Step[] = [
  { text: msg("Откройте эту ссылку в браузере Safari"), copyLink: true },
  {
    text: msg("Нажмите на три точки справа внизу — «Поделиться» — «Показать больше»"),
    image: iosShareMore,
  },
  {
    text: msg(
      "Выберите «На экран „Домой“», включите опцию «Открыть как веб-приложение» и нажмите «Добавить»",
    ),
    image: iosHomeScreen,
  },
];

const IOS_LEGACY_STEPS: Step[] = [
  { text: msg("Откройте эту ссылку в браузере Safari"), copyLink: true },
  { text: msg("Перейдите на сайт и нажмите на иконку «Поделиться»"), image: iosShareButton },
  { text: msg("Выберите пункт «На экран „Домой“» и нажмите «Добавить»"), image: iosHomeScreen },
];

const ANDROID_STEPS: Step[] = [
  { text: msg("Откройте этот сайт в браузере Chrome"), copyLink: true },
  {
    text: msg("Перейдите на сайт и нажмите на три точки в правом верхнем углу Chrome"),
    image: androidChromeMenu,
  },
  {
    text: msg("Выберите «Добавить на главный экран»"),
    hint: msg(
      "Иногда пункт называется «Установить приложение» или «Установить и создать ярлык». Если появится выбор — нажмите «Установить».",
    ),
  },
];

export function InstallScreen() {
  const t = useT();
  const title = t("Установите приложение");
  const subtitle = t(
    "Приложение открывается только после установки на телефон. Это займёт минуту.",
  );
  const note = (
    <p className="text-center text-sm text-muted-foreground">
      {t("Уже установили? Откройте приложение с главного экрана телефона.")}
    </p>
  );

  // Пакетное — в оформлении входа (тёмная шапка с огоньками, белая панель).
  if (IS_PACKAGES) {
    return (
      <DarkFrame
        top={
          <div className="mx-6 mt-4 flex items-center justify-between gap-3">
            <img src={packagesLogo} alt={t("Логотип студии")} className="h-auto w-[150px]" />
            <LanguageSwitcher />
          </div>
        }
        header={
          <div className="px-6 pt-5 pb-7">
            <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
            <p className="mt-2 text-sm text-white/70">{subtitle}</p>
          </div>
        }
        footer={null}
      >
        <InstallGuide />
        <div className="px-6 pb-2">{note}</div>
      </DarkFrame>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in srgb, var(--primary) 28%, transparent), color-mix(in srgb, var(--primary) 8%, transparent) 55%, transparent 75%)",
        }}
      />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col pt-16 pb-[max(env(safe-area-inset-bottom),2rem)]">
        <LanguageSwitcher tone="light" className="absolute right-4 top-4" />
        <div className="mb-8 text-center text-2xl font-black tracking-widest">
          Base<span className="text-primary">40</span>
        </div>
        <div className="px-6 text-center">
          <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="mt-4">
          <InstallGuide />
        </div>
        <div className="mt-auto px-6 pt-4">{note}</div>
      </div>
    </div>
  );
}

function InstallGuide() {
  const t = useT();
  // Экран рисуется только в браузере (после гидратации) — navigator есть.
  const detected = useMemo(() => {
    const ua = navigator.userAgent;
    return {
      platform: detectPlatform(ua, navigator.maxTouchPoints),
      iosGuide: detectIosGuide(ua),
    };
  }, []);
  const [platform, setPlatform] = useState<Exclude<InstallPlatform, "other">>(
    detected.platform === "android" ? "android" : "ios",
  );
  const [iosGuide, setIosGuide] = useState<IosGuide>(detected.iosGuide);
  const prompt = useInstallPrompt();

  const platformTabs = useMemo(
    () => [
      { key: "ios" as const, label: "iPhone" },
      { key: "android" as const, label: "Android" },
    ],
    [],
  );
  const iosTabs = useMemo(
    () => [
      { key: "ios26" as const, label: "iOS 26+" },
      { key: "legacy" as const, label: t("Ранние версии") },
    ],
    [t],
  );

  const steps =
    platform === "android" ? ANDROID_STEPS : iosGuide === "ios26" ? IOS26_STEPS : IOS_LEGACY_STEPS;

  return (
    <div className="px-4 pt-4 pb-4">
      {detected.platform === "other" && (
        <>
          <p className="px-1 text-sm text-muted-foreground">
            {t(
              "Приложение работает на телефоне: откройте эту ссылку на iPhone или Android и установите его по инструкции.",
            )}
          </p>
          <UnderlineTabs
            tabs={platformTabs}
            value={platform}
            onChange={setPlatform}
            className="mt-2 px-1"
          />
        </>
      )}
      {platform === "ios" && (
        <UnderlineTabs tabs={iosTabs} value={iosGuide} onChange={setIosGuide} className="px-1" />
      )}

      {platform === "android" && prompt.installed && (
        <Finish
          title={t("Готово!")}
          text={t("Приложение установлено — откройте его с главного экрана телефона.")}
          className="mt-4"
        />
      )}
      {platform === "android" && prompt.canInstall && !prompt.installed && (
        <div className="mt-2">
          <Button type="button" onClick={() => void prompt.install()} className="w-full">
            <DownloadMinimalistic />
            {t("Установить приложение")}
          </Button>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            {t("Или установите вручную по шагам ниже")}
          </p>
        </div>
      )}

      <ol className="mt-5 space-y-6">
        {steps.map((step, i) => (
          <StepItem key={step.text} n={i + 1} step={step} />
        ))}
      </ol>

      {platform === "android" ? (
        <Finish
          title={t("Готово!")}
          text={t(
            "Мобильное приложение установлено. Иконка приложения создана на вашем главном экране.",
          )}
          className="mt-6"
        />
      ) : (
        <Finish
          text={t("Значок приложения появится на домашнем экране — откройте приложение с него.")}
          className="mt-6"
        />
      )}
    </div>
  );
}

function StepItem({ n, step }: { n: number; step: Step }) {
  const t = useT();
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-base leading-snug">
          <QuotedText text={t(step.text)} />
        </p>
        {step.hint && (
          <p className="mt-1.5 text-sm leading-snug text-muted-foreground">
            <QuotedText text={t(step.hint)} />
          </p>
        )}
        {step.copyLink && <CopyLink />}
        {step.image && (
          <img
            src={step.image}
            alt=""
            width={96}
            height={96}
            decoding="async"
            className="mt-3 h-32 w-32 rounded-2xl object-cover ring-1 ring-black/10"
          />
        )}
      </div>
    </li>
  );
}

/** Названия кнопок телефона («Поделиться», “Share”) — жирным. */
function QuotedText({ text }: { text: string }) {
  return (
    <>
      {splitQuoted(text).map((part, i) =>
        part.quoted ? (
          <span key={i} className="font-semibold">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

function Finish({
  title,
  text,
  className = "",
}: {
  title?: string;
  text: string;
  className?: string;
}) {
  return (
    <div className={`flex gap-3 rounded-2xl bg-muted p-4 ${className}`}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {title && <p className="text-base font-semibold">{title}</p>}
        <p className={title ? "mt-0.5 text-sm text-muted-foreground" : "text-sm leading-snug"}>
          {text}
        </p>
      </div>
    </div>
  );
}

/**
 * Адрес приложения и кнопка «Скопировать ссылку»: клиент часто открывает
 * ссылку во встроенном браузере мессенджера или Instagram, а установить
 * приложение можно только из Safari (iPhone) или Chrome (Android).
 */
function CopyLink() {
  const t = useT();
  const url = `${window.location.origin}/`;
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const id = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(id);
  }, [state]);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex min-h-12 select-all items-center break-all rounded-2xl bg-field px-4 py-2 text-base font-medium">
        {window.location.host}
      </div>
      <Button
        type="button"
        onClick={async () => setState((await copyText(url)) ? "copied" : "failed")}
        className="w-full"
      >
        {state === "copied" ? <Check strokeWidth={3} /> : <Copy />}
        {state === "copied" ? t("Ссылка скопирована") : t("Скопировать ссылку")}
      </Button>
      {state === "failed" && (
        <p className="text-sm text-destructive">
          {t("Не удалось скопировать — выделите ссылку и скопируйте её вручную")}
        </p>
      )}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Встроенные браузеры без Clipboard API — через выделение во временном поле.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      // 16px — иначе iOS увеличивает страницу при выделении.
      area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
