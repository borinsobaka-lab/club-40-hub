/**
 * «Аудиоаналитика» — подписи, которые нужны и странице, и её скелетону
 * (components/page-skeletons.tsx грузится в основном бандле — сюда только
 * строки, без запросов).
 */
import { SERIES_COLORS } from "@/components/dashboard/colors";
import type { AaAgreementStatus, AaDialogType, AaPromptKey } from "./types";

export const AUDIO_TITLES = {
  days: "Смены",
  report: "Отчёт смены",
  dashboard: "Дашборд",
  agreements: "Договорённости",
  metrics: "Метрики и промпты",
  locations: "Точки продажи",
  managers: "Менеджеры",
  app: "Приложение",
} as const;

export const DIALOG_TYPE_LABEL: Record<AaDialogType, string> = {
  sale: "Продажа",
  consultation: "Консультация",
  refusal: "Отказ",
  service: "Сервис",
  irrelevant: "Личное",
};

/** Типы в фильтре разговоров отчёта — по порядку. */
export const DIALOG_TYPES: AaDialogType[] = [
  "sale",
  "consultation",
  "refusal",
  "service",
  "irrelevant",
];

export const AGREEMENT_STATUS_LABEL: Record<AaAgreementStatus, string> = {
  open: "Ждёт проверки",
  done: "Выполнено",
  missed: "Не выполнено",
  cancelled: "Снято",
};

export const PROMPT_LABEL: Record<AaPromptKey, { title: string; placeholders: string }> = {
  dialog_segmentation: {
    title: "Деление дня на диалоги",
    placeholders: "{{transcript}} — расшифровка дня с таймкодами и спикерами.",
  },
  daily_summary: {
    title: "Итог смены",
    placeholders:
      "{{analyses}} — разборы всех разговоров смены (JSON), {{stats}} — статистика дня.",
  },
};

export const PLATFORM_LABEL: Record<"darwin" | "windows" | "linux", string> = {
  darwin: "macOS",
  windows: "Windows",
  linux: "Linux",
};

/** Колонки таблиц — их берут и скелетоны. */
export const LOCATIONS_COLUMNS = ["Точка", "Адрес", "Часовой пояс", "Клуб", "Смен", "Статус"];
export const MANAGERS_COLUMNS = ["Менеджер", "Учётная запись", "Статус"];
export const RELEASES_COLUMNS = ["Версия", "Платформа", "Размер", "Выложена", "Раздаётся"];
export const AGREEMENTS_COLUMNS = ["Договорённость", "Менеджер", "Смена", "Статус", "Итог"];
export const DASHBOARD_MANAGER_COLUMNS = [
  "Менеджер",
  "Смен",
  "Разговоров",
  "Продаж",
  "Конверсия",
  "Метрики",
];

/** Плитки дашборда — подписи и подсказки. */
export const AUDIO_KPI = {
  shifts: { label: "Смены", tip: "Разобранные смены за период (статус «Готово»)." },
  dialogs: { label: "Разговоры", tip: "Разговоры с клиентами в разобранных сменах, без личных." },
  sales: { label: "Продажи", tip: "Разговоры, которые модель отнесла к продаже." },
  conversion: {
    label: "Конверсия",
    tip: "Продажи / разговоры. Сравнение — в процентных пунктах.",
  },
  speech: { label: "Часы речи", tip: "Сколько чистой речи разобрано (без тишины и музыки)." },
  cost: {
    label: "Стоимость разбора",
    tip: "Распознавание речи плюс обращения к модели — по последней обработке каждой смены.",
  },
} as const;

export const AUDIO_FILTERS = {
  period: {
    label: "Период",
    tip: "Даты смен включительно; сравнение — с прошлым периодом той же длины.",
  },
  manager: { label: "Менеджер", tip: "Смены одного менеджера." },
  locations: { label: "Точки", tip: "Точки продажи, где записывались смены." },
} as const;

export const AUDIO_NOT_CONNECTED =
  "Сервис аудиоаналитики не подключён (AUDIO_API_URL) — аудио, загрузка сборок и состояние сервиса недоступны.";

/** Подписи и пояснения действий со сменой — общие у списка смен и отчёта. */
export const DAY_ACTION_TEXT = {
  process: "Обработать",
  restart: "Запустить заново",
  recalc: "Пересчитать",
  full: "Распознать заново",
  finish: "Завершить принудительно",
  delete: "Удалить",
} as const;

/** Цвет отрезка разговора на ленте плеера и точки у разговора — по типу. */
export const DIALOG_TYPE_COLOR: Record<Exclude<AaDialogType, "irrelevant">, string> = {
  sale: SERIES_COLORS[0],
  consultation: SERIES_COLORS[2],
  refusal: SERIES_COLORS[3],
  service: SERIES_COLORS[1],
};
