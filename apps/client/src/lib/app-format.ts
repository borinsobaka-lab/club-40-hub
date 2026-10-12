/**
 * Формат студий, для которого собрано приложение (studios.format; подробно —
 * STUDIO_FORMATS.md в корне репозитория).
 *
 * Одна кодовая база — два приложения: app.base40.fit для «Зала с подписочной
 * моделью» и отдельный адрес для «Зала с пакетами тренировок». Формат задаёт
 * build-переменная VITE_APP_FORMAT (в Coolify — Build Variable); без неё —
 * подписочный, как было до разделения.
 */
export type StudioFormat = "subscription" | "packages";

export const APP_FORMAT: StudioFormat =
  import.meta.env.VITE_APP_FORMAT === "packages" ? "packages" : "subscription";

/** Адреса приложений форматов. Те же значения — в studio-formats.ts админки. */
export const FORMAT_APP_URL: Record<StudioFormat, string> = {
  subscription: "https://app.base40.fit",
  packages: "https://app.lady-stretch.one",
};
