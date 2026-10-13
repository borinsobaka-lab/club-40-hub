/**
 * Иконки календарей в окне «Выберите календарь» (окно тренировки) — свои SVG
 * в бандле вместо прежних картинок из Lovable, которые перестали
 * загружаться (решение владельца 2026-10-13).
 */

type IconProps = { className?: string };

export function GoogleCalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#fff" d="M37 11H11v26h26z" />
      <path
        fill="#1e88e5"
        d="M25.68 20.92l1.19 1.7 1.88-1.36v9.86h2.03V18.2h-1.7zM22.46 24.58c.73-.66 1.19-1.62 1.19-2.68 0-2.11-1.86-3.83-4.15-3.83-1.95 0-3.62 1.23-4.05 2.99l1.97.5c.2-.82 1.1-1.42 2.08-1.42 1.15 0 2.08.79 2.08 1.76s-.93 1.76-2.08 1.76h-1.19v2.04h1.19c1.29 0 2.38.9 2.38 1.96 0 1.08-1.03 1.96-2.3 1.96-1.15 0-2.13-.73-2.28-1.7l-2.02.33c.32 1.96 2.17 3.41 4.3 3.41 2.39 0 4.33-1.79 4.33-4 0-1.21-.6-2.3-1.45-3.08z"
      />
      <path fill="#fbc02d" d="M34 42H14l-1-4 1-4h20l1 4z" />
      <path fill="#4caf50" d="M38 35l4-1V14l-4-1-4 1v20z" />
      <path fill="#1e88e5" d="M34 14l1-4-1-4H9a3 3 0 0 0-3 3v25l4 1 4-1V14z" />
      <path fill="#e53935" d="M34 34v8l8-8z" />
      <path fill="#1565c0" d="M39 6h-5v8h8V9a3 3 0 0 0-3-3zM9 42h5v-8H6v5a3 3 0 0 0 3 3z" />
    </svg>
  );
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Как значок «Календаря» на iPhone: сегодняшние день недели и число. */
export function AppleCalendarIcon({ className }: IconProps) {
  const today = new Date();
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="44"
        height="44"
        rx="10"
        fill="#fff"
        stroke="#e5e5ea"
        strokeWidth="1.5"
      />
      <text
        x="24"
        y="15"
        fill="#ff3b30"
        fontFamily="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif"
        fontSize="8"
        fontWeight="600"
        textAnchor="middle"
        letterSpacing=".3"
      >
        {WEEKDAYS[today.getDay()]}
      </text>
      <text
        x="24"
        y="37.5"
        fill="#1c1c1e"
        fontFamily="-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif"
        fontSize="22"
        fontWeight="400"
        textAnchor="middle"
      >
        {today.getDate()}
      </text>
    </svg>
  );
}

export function OutlookIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#1a5dab" d="M44 12H24v24h20a2 2 0 0 0 2-2V14a2 2 0 0 0-2-2z" />
      <path fill="#50a0e6" d="M24 12h20a2 2 0 0 1 2 2v2.5L35 24l-11-7.5z" />
      <path fill="#103f91" d="M46 16.5 35 24l-11-7.5V36h20a2 2 0 0 0 2-2z" opacity=".35" />
      <path fill="#0f78d4" d="M27 7 4 11v26l23 4z" />
      <path
        fill="#fff"
        d="M15.4 17.2c-3.5 0-5.9 2.9-5.9 6.9s2.3 6.8 5.8 6.8 5.9-2.9 5.9-6.9-2.3-6.8-5.8-6.8zm-.1 11c-1.9 0-3.1-1.7-3.1-4.1s1.2-4.2 3.1-4.2 3.1 1.8 3.1 4.1-1.2 4.2-3.1 4.2z"
      />
    </svg>
  );
}

/** Прочие календари (.ics-файл). */
export function IcsFileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#e8eaed" d="M12 4h17l11 11v27a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path fill="#c4c7cc" d="M29 4v9a2 2 0 0 0 2 2h9z" />
      <rect
        x="15"
        y="22"
        width="18"
        height="15"
        rx="2"
        fill="#fff"
        stroke="#80868b"
        strokeWidth="1.6"
      />
      <path fill="#80868b" d="M15 24a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H15z" />
      <path stroke="#80868b" strokeWidth="1.6" strokeLinecap="round" d="M19 20v4M29 20v4" />
    </svg>
  );
}
