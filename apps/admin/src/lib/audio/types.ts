/**
 * «Аудиоаналитика» — типы строк базы (таблицы aa_*, RPC aa_*,
 * db/migrations/2026-10-30_audio_analytics.sql) и ответов сервиса
 * services/audio-analytics. Даты — yyyy-MM-dd, время — ISO.
 */

/** Права в разделе (RPC aa_access): свои смены, все смены, настройки. */
export type AaAccess = {
  own: boolean;
  view: boolean;
  manage: boolean;
  /** Менеджеры, связанные с учётной записью (право «свои смены»). */
  manager_ids: string[];
  /** Открытые договорённости, которые видит сотрудник. */
  open_agreements: number;
};

/** Видит ли сотрудник раздел (рейка, меню). */
export const aaVisible = (a: AaAccess | undefined) => !!a && (a.own || a.view || a.manage);

/** Видит смены всех менеджеров («все смены» или «настройки»). */
export const aaViewAll = (a: AaAccess | undefined) => !!a && (a.view || a.manage);

export type AaStatus = "recording" | "uploaded" | "queued" | "processing" | "done" | "error";

export type AaDialogType = "sale" | "consultation" | "refusal" | "service" | "irrelevant";

export type AaAgreementStatus = "open" | "done" | "missed" | "cancelled";

/** Показатель метрики за смену (aa_days.metric_stats). */
export type AaMetricStat = {
  metric_id: string;
  name: string;
  scale_max: number;
  triggered: number;
  avg: number | null;
};

/** Строка списка смен (RPC aa_days). */
export type AaDay = {
  id: string;
  location_id: string;
  location_name: string;
  manager_id: string | null;
  manager_name: string | null;
  date: string;
  status: AaStatus;
  status_detail: string;
  status_changed_at: string;
  stale: boolean;
  total_duration_s: number | null;
  speech_duration_s: number | null;
  cost_usd: number | null;
  created_at: string;
  segments: number;
  dialogs_total: number | null;
  sales_count: number | null;
  metric_stats: AaMetricStat[];
};

export type AaLocation = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  active: boolean;
  studio_id: string | null;
  created_at: string;
  /** Смен на точке (вложенный count). */
  shifts: number;
};

export type AaManager = {
  id: string;
  full_name: string;
  active: boolean;
  user_id: string | null;
  created_at: string;
};

export type AaMetric = {
  id: string;
  name: string;
  prompt: string;
  scale_max: 5 | 10;
  active: boolean;
  position: number;
  updated_at: string;
};

export type AaRecording = {
  id: string;
  location_id: string;
  manager_id: string | null;
  date: string;
  status: AaStatus;
  status_detail: string;
  status_changed_at: string;
  process_full: boolean;
  total_duration_s: number | null;
  speech_duration_s: number | null;
  asr_seconds: number | null;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_calls: number;
  cost_usd: number | null;
  audio_purged_at: string | null;
  created_at: string;
  location: { name: string; timezone: string } | null;
  manager: { full_name: string } | null;
};

export type AaDialog = {
  id: string;
  recording_id: string;
  start_s: number;
  end_s: number;
  type: AaDialogType;
  outcome: string | null;
  brief: string;
};

export type AaTurn = {
  id: string;
  speaker_label: string;
  start_s: number;
  end_s: number;
  text: string;
};

export type AaEvaluation = {
  id: string;
  dialog_id: string;
  metric_id: string;
  applicable: boolean;
  score: number | null;
  good: string[];
  bad: string[];
  comment: string;
  metric_name: string;
  scale_max: number;
  position: number;
};

export type AaFeedback = {
  id: string;
  recording_id: string;
  dialog_id: string;
  metric_id: string;
  author_id: string | null;
  author_name: string;
  subject_name: string;
  agree: boolean;
  comment: string;
  created_at: string;
};

export type AaAgreement = {
  id: string;
  manager_id: string | null;
  manager_name: string;
  recording_id: string;
  day_date: string;
  dialog_id: string | null;
  dialog_start_s: number | null;
  text: string;
  status: AaAgreementStatus;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by_name: string;
  resolved_recording_id: string | null;
  resolution_note: string;
};

/** Итог смены от модели (aa_day_summaries.summary); у сбоя — { error }. */
export type AaDaySummaryText = {
  top_deviations: string[];
  recommendations: string[];
  script_suggestions: string[];
  highlights: string[];
  error: string | null;
};

export type AaDaySummary = {
  dialogs_total: number;
  sales_count: number;
  conversion: number | null;
  summary: AaDaySummaryText | null;
};

/** Всё для отчёта смены одним запросом. */
export type AaReport = {
  recording: AaRecording;
  summary: AaDaySummary | null;
  dialogs: AaDialog[];
  evaluations: AaEvaluation[];
  feedback: AaFeedback[];
  agreements: AaAgreement[];
  /** Открытые договорённости этого менеджера с прошлых смен (и отмеченные здесь). */
  carried: AaAgreement[];
};

export type AaPromptKey = "dialog_segmentation" | "daily_summary";

export type AaPrompt = {
  id: string;
  key: AaPromptKey;
  name: string;
  description: string;
  content: string;
  model: string | null;
  version: number;
  active: boolean;
  updated_by_name: string;
  created_at: string;
};

export type AaRelease = {
  id: string;
  platform: "darwin" | "windows" | "linux";
  version: string;
  notes: string;
  size_bytes: number;
  published: boolean;
  created_by_name: string;
  created_at: string;
};

/** Итоги за период (aa_summary.totals / previous / managers[].totals). */
export type AaTotals = {
  shifts: number;
  dialogs: number;
  sales: number;
  conversion: number | null;
  speech_seconds: number;
  cost_usd: number;
};

export type AaPeriodMetric = {
  metric_id: string;
  name: string;
  scale_max: number;
  triggered: number;
  avg: number | null;
  prev_avg: number | null;
};

export type AaSummary = {
  date_from: string;
  date_to: string;
  prev_date_from: string;
  prev_date_to: string;
  totals: AaTotals;
  previous: AaTotals;
  metrics: AaPeriodMetric[];
  managers: {
    manager_id: string | null;
    full_name: string;
    totals: AaTotals;
    metrics: AaPeriodMetric[];
  }[];
  trend: {
    date: string;
    dialogs: number;
    sales: number;
    conversion: number | null;
    cost_usd: number;
    avg_scores: Record<string, number | null>;
  }[];
};

/** Состояние сервиса (GET /api/staff/status) — поля читаются осторожно. */
export type AaServiceStatus = {
  version: string | null;
  storage: string | null;
  asr_configured: boolean | null;
  llm_configured: boolean | null;
  app_key_set: boolean | null;
  worker_heartbeat_age_s: number | null;
  queued: number | null;
  processing: number | null;
  models: Record<string, string>;
};
