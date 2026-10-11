import { supabase } from "@/integrations/supabase/client";

/**
 * Иконка и подпись приложения для установки (PWA, «На экран „Домой“») и
 * фавикон. Задаются в админке: «Мобильное приложение» → «Настройки»
 * (club_settings.app_name / app_icon_path,
 * db/migrations/2026-10-11_app_install_settings.sql). Одни на обе сборки
 * (app. и pack.): мобильное приложение общее для всех студий.
 *
 * app_icon_path — папка в публичном бакете app-icons с готовыми PNG (их
 * нарезает админка, apps/admin/src/lib/app-icons.ts — имена файлов те же).
 * Без своей иконки — Base40 из public/.
 */
export type AppInstall = {
  name: string;
  icons: {
    icon192: string;
    icon512: string;
    maskable512: string;
    appleTouch: string;
    favicon32: string;
  };
  /** Своя иконка из админки (иначе — Base40 по умолчанию). */
  custom: boolean;
};

const DEFAULT_NAME = "Base40";

const DEFAULT_ICONS: AppInstall["icons"] = {
  icon192: "/icon-192.png",
  icon512: "/icon-512.png",
  maskable512: "/icon-maskable-512.png",
  appleTouch: "/apple-touch-icon.png",
  favicon32: "/favicon-32.png",
};

const ICON_FILES: AppInstall["icons"] = {
  icon192: "icon-192.png",
  icon512: "icon-512.png",
  maskable512: "icon-maskable-512.png",
  appleTouch: "apple-touch-icon.png",
  favicon32: "favicon-32.png",
};

export const DEFAULT_APP_INSTALL: AppInstall = {
  name: DEFAULT_NAME,
  icons: DEFAULT_ICONS,
  custom: false,
};

function iconUrls(folder: string): AppInstall["icons"] {
  const bucket = supabase.storage.from("app-icons");
  const url = (file: string) => bucket.getPublicUrl(`${folder}/${file}`).data.publicUrl;
  return {
    icon192: url(ICON_FILES.icon192),
    icon512: url(ICON_FILES.icon512),
    maskable512: url(ICON_FILES.maskable512),
    appleTouch: url(ICON_FILES.appleTouch),
    favicon32: url(ICON_FILES.favicon32),
  };
}

// Читается на каждый серверный рендер (head корня) и манифестом: держим
// минуту в памяти процесса, чтобы не ходить в базу на каждую страницу.
const TTL_MS = 60_000;
let cached: { value: AppInstall; at: number } | null = null;

/**
 * Настройки установки. Никогда не бросает: при ошибке или медленной базе —
 * Base40 по умолчанию (иконка не должна ронять или задерживать страницу).
 */
export async function fetchAppInstall(): Promise<AppInstall> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const { data, error } = await supabase
      .from("club_settings")
      .select("app_name, app_icon_path")
      .eq("id", true)
      .abortSignal(AbortSignal.timeout(2000))
      .maybeSingle();
    if (error) throw error;
    const value: AppInstall = {
      name: data?.app_name?.trim() || DEFAULT_NAME,
      icons: data?.app_icon_path ? iconUrls(data.app_icon_path) : DEFAULT_ICONS,
      custom: !!data?.app_icon_path,
    };
    cached = { value, at: Date.now() };
    return value;
  } catch {
    // Ошибку не кэшируем: следующий запрос попробует снова.
    return cached?.value ?? DEFAULT_APP_INSTALL;
  }
}

/** Веб-манифест (/manifest.webmanifest). */
export function buildManifest(app: AppInstall) {
  return {
    id: "/",
    name: app.name,
    short_name: app.name,
    description: "Расписание, запись на тренировки и абонементы.",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      { src: app.icons.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: app.icons.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: app.icons.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
