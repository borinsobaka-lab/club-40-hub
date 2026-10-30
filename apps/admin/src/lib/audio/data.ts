/**
 * «Аудиоаналитика» — загрузка и запись (React Query, таблицы aa_* под RLS и
 * RPC aa_*, db/migrations/2026-10-30_audio_analytics.sql) и запросы к сервису
 * services/audio-analytics (аудио смены, сборки приложения, состояние).
 * Ключи — ["audio", …], после записи — invalidateAudio.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getAudioServiceConfig } from "@/lib/audio.functions";
import { aaErrorText, compareVersions } from "./logic";
import type {
  AaAccess,
  AaAgreement,
  AaAgreementStatus,
  AaDay,
  AaDaySummary,
  AaDaySummaryText,
  AaDialog,
  AaEvaluation,
  AaFeedback,
  AaLocation,
  AaManager,
  AaMetric,
  AaPrompt,
  AaRecording,
  AaRelease,
  AaReport,
  AaServiceStatus,
  AaSummary,
  AaTurn,
} from "./types";

export const AUDIO_KEY = "audio";

type DbError = { message: string; hint?: string | null; code?: string | null };

function fail(error: DbError): never {
  throw new Error(aaErrorText(error.message, error.hint, error.code));
}

export async function aaRpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error);
  return data as T;
}

/** Запись в таблицу (insert/update/delete) с понятной ошибкой. */
export async function aaWrite<T = unknown>(
  query: PromiseLike<{ data: unknown; error: DbError | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) fail(error);
  return data as T;
}

/** Сбросить всё раздела — после любой записи (и счётчик договорённостей в правах). */
export function invalidateAudio(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: [AUDIO_KEY] });
}

export const audioAccessQuery = queryOptions({
  queryKey: [AUDIO_KEY, "access"],
  queryFn: async (): Promise<AaAccess> => {
    const raw = await aaRpc<Partial<AaAccess> | null>("aa_access");
    return {
      own: !!raw?.own,
      view: !!raw?.view,
      manage: !!raw?.manage,
      manager_ids: Array.isArray(raw?.manager_ids) ? raw.manager_ids : [],
      open_agreements: Number(raw?.open_agreements ?? 0),
    };
  },
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить права в «Аудиоаналитике»" },
});

/** Адрес сервиса (AUDIO_API_URL сервера админки); null — не подключён. */
export const audioConfigQuery = queryOptions({
  queryKey: [AUDIO_KEY, "config"],
  queryFn: () => getAudioServiceConfig(),
  staleTime: Infinity,
  meta: { errorMessage: "Не удалось узнать адрес сервиса аудиоаналитики" },
});

// --- Справочники ----------------------------------------------------------------

export const aaLocationsQuery = queryOptions({
  queryKey: [AUDIO_KEY, "locations"],
  queryFn: async (): Promise<AaLocation[]> => {
    const rows = await aaWrite<
      (Omit<AaLocation, "shifts"> & { aa_recordings?: { count: number }[] })[]
    >(supabase.from("aa_locations").select("*, aa_recordings(count)").order("name"));
    return rows.map(({ aa_recordings, ...l }) => ({
      ...l,
      shifts: Number(aa_recordings?.[0]?.count ?? 0),
    }));
  },
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить точки продажи" },
});

export const aaManagersQuery = queryOptions({
  queryKey: [AUDIO_KEY, "managers"],
  queryFn: () =>
    aaWrite<AaManager[]>(
      supabase
        .from("aa_managers")
        .select("id, full_name, active, user_id, created_at")
        .order("full_name"),
    ),
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить менеджеров" },
});

export const aaMetricsQuery = queryOptions({
  queryKey: [AUDIO_KEY, "metrics"],
  queryFn: () =>
    aaWrite<AaMetric[]>(
      supabase
        .from("aa_metrics")
        .select("id, name, prompt, scale_max, active, position, updated_at")
        .order("position")
        .order("name"),
    ),
  meta: { errorMessage: "Не удалось загрузить метрики" },
});

export const aaPromptsQuery = queryOptions({
  queryKey: [AUDIO_KEY, "prompts"],
  queryFn: () =>
    aaWrite<AaPrompt[]>(
      supabase
        .from("aa_prompts")
        .select(
          "id, key, name, description, content, model, version, active, updated_by_name, created_at",
        )
        .order("version", { ascending: false }),
    ),
  meta: { errorMessage: "Не удалось загрузить промпты" },
});

export const aaReleasesQuery = queryOptions({
  queryKey: [AUDIO_KEY, "releases"],
  queryFn: async () => {
    const rows = await aaWrite<AaRelease[]>(
      supabase
        .from("aa_app_releases")
        .select("id, platform, version, notes, size_bytes, published, created_by_name, created_at"),
    );
    return rows.sort(
      (a, b) => a.platform.localeCompare(b.platform) || compareVersions(b.version, a.version),
    );
  },
  meta: { errorMessage: "Не удалось загрузить сборки приложения" },
});

// --- Смены -----------------------------------------------------------------------

export function aaDaysQuery(locationIds: string[]) {
  return queryOptions({
    queryKey: [AUDIO_KEY, "days", locationIds.join(",")],
    queryFn: async () =>
      (
        (await aaRpc<AaDay[] | null>("aa_days", {
          p_location_ids: locationIds.length ? locationIds : null,
          p_limit: 200,
        })) ?? []
      ).map((d) => ({ ...d, metric_stats: d.metric_stats ?? [] })),
    meta: { errorMessage: "Не удалось загрузить смены" },
  });
}

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => (typeof x === "string" ? x : x == null ? "" : JSON.stringify(x)))
        .filter((x) => x.trim())
    : [];

/** Итог смены от модели — поля читаются осторожно (старые разборы, сбой). */
export function parseSummaryText(raw: unknown): AaDaySummaryText | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    top_deviations: strings(r.top_deviations),
    recommendations: strings(r.recommendations),
    script_suggestions: strings(r.script_suggestions),
    highlights: strings(r.highlights),
    error: typeof r.error === "string" && r.error.trim() ? r.error : null,
  };
}

const AGREEMENT_COLUMNS =
  "id, manager_id, manager_name, recording_id, day_date, dialog_id, dialog_start_s, text, status, created_by, created_by_name, created_at, resolved_at, resolved_by_name, resolved_recording_id, resolution_note";

export function aaReportQuery(id: string) {
  return queryOptions({
    queryKey: [AUDIO_KEY, "report", id],
    queryFn: async (): Promise<AaReport | null> => {
      const [recording, summary, dialogs, evals, feedback, agreements] = await Promise.all([
        aaWrite<AaRecording | null>(
          supabase
            .from("aa_recordings")
            .select(
              "id, location_id, manager_id, date, status, status_detail, status_changed_at, process_full, total_duration_s, speech_duration_s, asr_seconds, llm_input_tokens, llm_output_tokens, llm_calls, cost_usd, audio_purged_at, created_at, location:aa_locations(name, timezone), manager:aa_managers(full_name)",
            )
            .eq("id", id)
            .maybeSingle(),
        ),
        aaWrite<(Omit<AaDaySummary, "summary"> & { summary: unknown }) | null>(
          supabase
            .from("aa_day_summaries")
            .select("dialogs_total, sales_count, conversion, summary")
            .eq("recording_id", id)
            .maybeSingle(),
        ),
        aaWrite<AaDialog[]>(
          supabase
            .from("aa_dialogs")
            .select("id, recording_id, start_s, end_s, type, outcome, brief")
            .eq("recording_id", id)
            .order("start_s"),
        ),
        aaWrite<
          (Omit<AaEvaluation, "metric_name" | "scale_max" | "position" | "good" | "bad"> & {
            good: unknown;
            bad: unknown;
            metric: { name: string; scale_max: number; position: number } | null;
          })[]
        >(
          supabase
            .from("aa_metric_evaluations")
            .select(
              "id, dialog_id, metric_id, applicable, score, good, bad, comment, metric:aa_metrics(name, scale_max, position)",
            )
            .eq("recording_id", id),
        ),
        aaWrite<AaFeedback[]>(supabase.from("aa_feedback").select("*").eq("recording_id", id)),
        aaWrite<AaAgreement[]>(
          supabase
            .from("aa_agreements")
            .select(AGREEMENT_COLUMNS)
            .eq("recording_id", id)
            .order("created_at"),
        ),
      ]);
      if (!recording) return null;
      // С прошлых смен этого менеджера: открытые и те, что отметили здесь.
      const carried = recording.manager_id
        ? await aaWrite<AaAgreement[]>(
            supabase
              .from("aa_agreements")
              .select(AGREEMENT_COLUMNS)
              .eq("manager_id", recording.manager_id)
              .lt("day_date", recording.date)
              .or(`status.eq.open,resolved_recording_id.eq.${id}`)
              .order("day_date")
              .order("created_at"),
          )
        : [];
      return {
        recording,
        summary: summary ? { ...summary, summary: parseSummaryText(summary.summary) } : null,
        dialogs,
        evaluations: evals
          .map(({ metric, good, bad, ...e }) => ({
            ...e,
            good: strings(good),
            bad: strings(bad),
            metric_name: metric?.name ?? "Метрика",
            scale_max: metric?.scale_max ?? 10,
            position: metric?.position ?? 0,
          }))
          .sort((a, b) => a.position - b.position || a.metric_name.localeCompare(b.metric_name)),
        feedback,
        agreements,
        carried,
      };
    },
    meta: { errorMessage: "Не удалось загрузить отчёт смены" },
  });
}

export function aaTurnsQuery(dialogId: string, enabled: boolean) {
  return queryOptions({
    queryKey: [AUDIO_KEY, "turns", dialogId],
    queryFn: () =>
      aaWrite<AaTurn[]>(
        supabase
          .from("aa_dialog_turns")
          .select("id, speaker_label, start_s, end_s, text")
          .eq("dialog_id", dialogId)
          .order("start_s"),
      ),
    enabled,
    staleTime: Infinity,
    meta: { errorMessage: "Не удалось загрузить расшифровку" },
  });
}

// --- Дашборд, договорённости, отзывы ----------------------------------------------------

export function aaSummaryQuery(
  from: string,
  to: string,
  managerId: string | null,
  locationIds: string[],
) {
  return queryOptions({
    queryKey: [AUDIO_KEY, "summary", from, to, managerId ?? "all", locationIds.join(",")],
    queryFn: () =>
      aaRpc<AaSummary>("aa_summary", {
        p_from: from,
        p_to: to,
        p_manager_id: managerId,
        p_location_ids: locationIds.length ? locationIds : null,
      }),
    meta: { errorMessage: "Не удалось загрузить дашборд" },
  });
}

export function aaAgreementsQuery(status: AaAgreementStatus | "all", managerId: string | null) {
  return queryOptions({
    queryKey: [AUDIO_KEY, "agreements", status, managerId ?? "all"],
    queryFn: () => {
      let q = supabase.from("aa_agreements").select(AGREEMENT_COLUMNS);
      if (status !== "all") q = q.eq("status", status);
      if (managerId) q = q.eq("manager_id", managerId);
      return aaWrite<AaAgreement[]>(
        q
          .order("day_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
      );
    },
    meta: { errorMessage: "Не удалось загрузить договорённости" },
  });
}

/** Несогласие с оценкой — для «Метрик и промптов». */
export type AaFeedbackRow = AaFeedback & {
  recording: { date: string } | null;
  dialog: { start_s: number } | null;
};

export const aaFeedbackAllQuery = queryOptions({
  queryKey: [AUDIO_KEY, "feedback-all"],
  queryFn: () =>
    aaWrite<AaFeedbackRow[]>(
      supabase
        .from("aa_feedback")
        .select("*, recording:aa_recordings(date), dialog:aa_dialogs(start_s)")
        .order("created_at", { ascending: false })
        .limit(2000),
    ),
  meta: { errorMessage: "Не удалось загрузить отзывы об оценках" },
});

/** Последний сигнал сервиса из базы (aa_service_state) — когда сервис не отвечает. */
export const aaServiceStateQuery = queryOptions({
  queryKey: [AUDIO_KEY, "service-state"],
  queryFn: () =>
    aaWrite<{ key: string; value: unknown; updated_at: string }[]>(
      supabase.from("aa_service_state").select("key, value, updated_at").order("key"),
    ),
  meta: { errorMessage: "Не удалось загрузить состояние сервиса" },
});

// --- Сервис ----------------------------------------------------------------------

async function bearer(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Текст ошибки сервиса: { detail: "русский текст" } или список ошибок полей. */
export function serviceErrorText(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string } | string;
    return typeof first === "string" ? first : (first?.msg ?? `Ошибка сервиса (${status})`);
  }
  if (status === 401) return "Сервис не принял вход — обновите страницу и попробуйте снова";
  if (status === 403) return "Нет прав на это действие в «Аудиоаналитике»";
  if (status === 413) return "Файл слишком большой для сервиса";
  return `Сервис аудиоаналитики ответил ошибкой (${status})`;
}

/** Ошибка ссылки на аудио: 404 — смена не видна, 410 — аудио стёрто по сроку. */
export class AudioUrlError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Временная ссылка на склеенное аудио смены. */
export async function fetchAudioUrl(base: string, recordingId: string) {
  let res: Response;
  try {
    res = await fetch(`${base}/api/staff/audio/${recordingId}`, { headers: await bearer() });
  } catch {
    throw new AudioUrlError("Сервис аудиоаналитики не отвечает", 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 410)
    throw new AudioUrlError("Аудио удалено по сроку хранения, текст разбора остался", 410);
  if (res.status === 404) throw new AudioUrlError("Аудио этой смены не найдено", 404);
  if (!res.ok) throw new AudioUrlError(serviceErrorText(res.status, body), res.status);
  const r = body as { url?: string; expires_in_s?: number } | null;
  if (!r?.url) throw new AudioUrlError("Сервис не вернул ссылку на аудио", res.status);
  return { url: r.url, expiresInS: Number(r.expires_in_s ?? 3600) };
}

const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const numOrNull = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export function aaServiceStatusQuery(base: string | null) {
  return queryOptions({
    queryKey: [AUDIO_KEY, "service-status", base ?? ""],
    queryFn: async (): Promise<AaServiceStatus> => {
      const res = await fetch(`${base}/api/staff/status`, { headers: await bearer() });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) throw new Error(serviceErrorText(res.status, raw));
      const models =
        raw?.models && typeof raw.models === "object"
          ? Object.fromEntries(
              Object.entries(raw.models as Record<string, unknown>).map(([k, v]) => [
                k,
                typeof v === "string" ? v : JSON.stringify(v),
              ]),
            )
          : {};
      return {
        version: typeof raw?.version === "string" ? raw.version : null,
        storage: typeof raw?.storage === "string" ? raw.storage : null,
        asr_configured: bool(raw?.asr_configured),
        llm_configured: bool(raw?.llm_configured),
        app_key_set: bool(raw?.app_key_set),
        worker_heartbeat_age_s: numOrNull(raw?.worker_heartbeat_age_s),
        queued: numOrNull(raw?.queued),
        processing: numOrNull(raw?.processing),
        models,
      };
    },
    enabled: !!base,
    refetchInterval: 30_000,
    // Без тоста: опрос раз в 30 с засыпал бы ими страницу — ошибка видна в карточке.
    retry: 1,
  });
}

/**
 * Выложить сборку приложения: multipart в сервис с прогрессом (у fetch его
 * нет — XMLHttpRequest). Возвращает версию из ответа.
 */
export async function uploadRelease(
  base: string,
  form: FormData,
  onProgress: (share: number) => void,
): Promise<{ version: string }> {
  const headers = await bearer();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/staff/releases`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Сервис аудиоаналитики не отвечает"));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const version = (body as { version?: string } | null)?.version ?? "";
        resolve({ version });
      } else reject(new Error(serviceErrorText(xhr.status, body)));
    };
    xhr.send(form);
  });
}

/** id вошедшего — «мой голос» в «Согласен / не согласен». */
export const myUserIdQuery = queryOptions({
  queryKey: [AUDIO_KEY, "me"],
  queryFn: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
  staleTime: Infinity,
});
