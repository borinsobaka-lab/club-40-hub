/**
 * Значки карт для кнопок «Показать на карте» (выбор студии, 2026-11-10):
 * метка Google Карт (четыре цвета Google) и метка Яндекс Карт (красная).
 * Нарисованы здесь, без внешних картинок.
 */

const PIN =
  "M12 1.5c-4.3 0-7.75 3.4-7.75 7.65 0 5.6 6.55 12.35 7.2 13 .3.3.8.3 1.1 0 .65-.65 7.2-7.4 7.2-13C19.75 4.9 16.3 1.5 12 1.5Z";

export function GoogleMapsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <clipPath id="gmaps-pin">
          <path d={PIN} />
        </clipPath>
      </defs>
      <g clipPath="url(#gmaps-pin)">
        <rect x="0" y="0" width="12" height="9" fill="#1A73E8" />
        <rect x="12" y="0" width="12" height="9" fill="#EA4335" />
        <rect x="0" y="9" width="12" height="15" fill="#FBBC04" />
        <rect x="12" y="9" width="12" height="15" fill="#34A853" />
      </g>
      <circle cx="12" cy="9.1" r="2.9" fill="#fff" />
    </svg>
  );
}

export function YandexMapsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={PIN} fill="#FC3F1D" />
      <circle cx="12" cy="9.1" r="2.9" fill="#fff" />
    </svg>
  );
}
