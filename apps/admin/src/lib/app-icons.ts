import { supabase } from "@/integrations/supabase/client";
import { STORAGE_BUCKETS } from "@/lib/storage";

/**
 * Иконка клиентского приложения («Мобильное приложение» → «Настройки»):
 * фавикон и значок на рабочем столе, когда приложение сохраняют как PWA.
 *
 * Из загруженной картинки браузер нарезает готовые PNG и кладёт их в одну
 * папку бакета app-icons; в club_settings.app_icon_path пишется папка.
 * Клиент (apps/client/src/lib/app-install.ts) собирает адреса по тем же
 * именам файлов — меняя их здесь, поменяй и там.
 */
export const APP_ICON_FILES = {
  /** Манифест, purpose any. */
  icon512: { name: "icon-512.png", size: 512 },
  icon192: { name: "icon-192.png", size: 192 },
  /** Манифест, purpose maskable: Android сам обрезает края кругом/скруглением. */
  maskable512: { name: "icon-maskable-512.png", size: 512, opaque: true },
  /** iOS: прозрачное он заливает чёрным, поэтому — на белом. */
  appleTouch: { name: "apple-touch-icon.png", size: 180, opaque: true },
  favicon32: { name: "favicon-32.png", size: 32 },
} as const;

/** Меньше — значок на рабочем столе будет мыльным. */
export const APP_ICON_MIN_SIZE = 512;

export const APP_NAME_MAX = 30;
/** Длиннее — телефоны обрезают подпись под значком многоточием. */
export const APP_NAME_FITS = 12;
export const APP_NAME_DEFAULT = "Base40";

const BUCKET = STORAGE_BUCKETS.appIcons.id;

/** Публичный адрес файла иконки в папке. */
export function appIconUrl(folder: string, file: keyof typeof APP_ICON_FILES) {
  return supabase.storage.from(BUCKET).getPublicUrl(`${folder}/${APP_ICON_FILES[file].name}`).data
    .publicUrl;
}

/** Картинка через <img>: в отличие от createImageBitmap понимает и SVG. */
function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось прочитать картинку — нужен PNG, JPG или SVG"));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

/** Квадрат size×size из центра картинки; opaque — на белом фоне. */
function renderSquare(img: HTMLImageElement, size: number, opaque: boolean): Promise<Blob> {
  // SVG без width/height бывает с нулевым размером — тогда рисуем целиком.
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;
  const side = Math.min(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не умеет обрабатывать картинки");
  if (opaque) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
  }
  ctx.imageSmoothingQuality = "high";
  if (img.naturalWidth && img.naturalHeight) {
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  } else {
    ctx.drawImage(img, 0, 0, size, size);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Не удалось обработать картинку"))),
      "image/png",
    ),
  );
}

/**
 * Проверяет картинку, нарезает все размеры и загружает их в новую папку.
 * Возвращает папку — её сохраняем в club_settings.app_icon_path. Новая папка
 * на каждую загрузку: адреса иконок меняются, и браузеры с установленными
 * приложениями не держат старую картинку из кэша.
 */
export async function uploadAppIcon(file: File): Promise<string> {
  const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
  const img = await loadImage(file);
  if (!isSvg && Math.min(img.naturalWidth, img.naturalHeight) < APP_ICON_MIN_SIZE) {
    throw new Error(
      `Картинка ${img.naturalWidth}×${img.naturalHeight} px — нужна не меньше ${APP_ICON_MIN_SIZE}×${APP_ICON_MIN_SIZE} px`,
    );
  }
  const folder = crypto.randomUUID();
  const files = Object.values(APP_ICON_FILES);
  const blobs = await Promise.all(
    files.map((f) => renderSquare(img, f.size, "opaque" in f && f.opaque)),
  );
  await Promise.all(
    files.map(async (f, i) => {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(`${folder}/${f.name}`, blobs[i], { upsert: false, contentType: "image/png" });
      if (error) throw new Error(error.message);
    }),
  );
  return folder;
}
