import { queryOptions } from "@tanstack/react-query";

import type { ContentTranslations } from "@/i18n";
import { untypedDb } from "@/lib/untyped-db";

/**
 * Диагностика тела (2026-11-27, db/migrations/2026-11-27_body_diagnostics.sql):
 * форма тренера в приложении и результаты у клиента. Всё — RPC базы, они
 * сами проверяют вызывающего; фото — закрытый бакет body-diagnostics, папка
 * — id карточки клиента, показ — подписанными ссылками.
 */

export const PHOTO_BUCKET = "body-diagnostics";

/** Поля формы — как их хранит база (body_diag_json). */
export type DiagnosticFields = {
  birth_date: string | null;
  activity_level: number | null;
  emotional_level: number | null;
  emotional_comment: string | null;
  directions: string[];
  no_restrictions: boolean;
  restrictions: string[];
  restrictions_other: string | null;
  goals: string[];
  priority_today: string | null;
  measure_skipped: boolean;
  chest_cm: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  weight_kg: number | null;
  balance_test: string | null;
  balance_comment: string | null;
  forward_bend: string | null;
  forward_bend_cm: number | null;
  forward_bend_comment: string | null;
  split_right_cm: number | null;
  split_left_cm: number | null;
  split_middle_cm: number | null;
  photo_paths: string[];
  stage: number | null;
  rec_trainings: string | null;
  rec_directions: string[];
  rec_focus: string | null;
};

export type BodyDiagnostic = DiagnosticFields & {
  id: string;
  entry_id: string | null;
  studio_id: string | null;
  trainer_id: string | null;
  trainer_name: string | null;
  diagnostic_date: string;
  created_at: string;
  updated_at: string;
  trainer?: {
    id: string;
    full_name: string | null;
    photo_url: string | null;
    translations?: ContentTranslations | null;
  } | null;
};

const NUMERIC: (keyof DiagnosticFields)[] = [
  "activity_level",
  "emotional_level",
  "chest_cm",
  "waist_cm",
  "hips_cm",
  "weight_kg",
  "forward_bend_cm",
  "split_right_cm",
  "split_left_cm",
  "split_middle_cm",
  "stage",
];

/** numeric из jsonb может прийти строкой — к числу; массивы — не null. */
export function normalizeDiagnostic<T extends Partial<DiagnosticFields>>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of NUMERIC) {
    const v = out[k];
    out[k] = v == null || v === "" ? null : Number(v);
  }
  for (const k of ["directions", "restrictions", "goals", "photo_paths", "rec_directions"]) {
    out[k] = Array.isArray(out[k]) ? out[k] : [];
  }
  return out as T;
}

// ---- Тренер ----

export type DiagnosticState = {
  entry_id: string;
  editable: boolean;
  clients: {
    client_id: string;
    name: string | null;
    diagnostic_id: string | null;
    updated_at: string | null;
  }[];
};

/** Кто записан на мои диагностики и заполнена ли форма. До миграции — пусто. */
export function diagnosticsStateQuery(entryIds: string[]) {
  return queryOptions({
    queryKey: ["trainer-diagnostics-state", entryIds],
    queryFn: async (): Promise<Map<string, DiagnosticState>> => {
      const { data, error } = await untypedDb.rpc("trainer_diagnostics_state", {
        p_ids: entryIds,
      });
      if (error) return new Map();
      return new Map(((data as DiagnosticState[] | null) ?? []).map((s) => [s.entry_id, s]));
    },
    enabled: entryIds.length > 0,
    meta: { persist: false },
  });
}

/** Прошедшие за 7 дней диагностики, где форма заполнена не у всех. */
export function diagnosticsTodoQuery(trainerId: string | null) {
  return queryOptions({
    queryKey: ["trainer-diagnostics-todo", trainerId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await untypedDb.rpc("trainer_diagnostics_todo");
      if (error) return [];
      return ((data as string[] | null) ?? []).map(String);
    },
    enabled: !!trainerId,
    meta: { persist: false },
  });
}

export type DiagnosticFormData = {
  entry: {
    id: string;
    studio_id: string;
    studio_name: string | null;
    starts_at: string;
    ends_at: string;
    date: string;
    editable: boolean;
  };
  client: { id: string; name: string | null; phone: string | null; birth_date: string | null };
  diagnostic: BodyDiagnostic | null;
  previous: BodyDiagnostic | null;
};

export function diagnosticFormQuery(entryId: string, clientId: string) {
  return queryOptions({
    queryKey: ["trainer-diagnostic-form", entryId, clientId],
    queryFn: async (): Promise<DiagnosticFormData> => {
      const { data, error } = await untypedDb.rpc("trainer_diagnostic_form", {
        p_entry: entryId,
        p_client: clientId,
      });
      if (error) throw error;
      const res = data as DiagnosticFormData;
      return {
        ...res,
        diagnostic: res.diagnostic ? normalizeDiagnostic(res.diagnostic) : null,
        previous: res.previous ? normalizeDiagnostic(res.previous) : null,
      };
    },
    meta: { persist: false },
    // Пока форма открыта, не перезапрашиваем: сбой сети при возвращении в
    // приложение не должен сменить заполняемую форму экраном ошибки.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export async function saveDiagnostic(entryId: string, clientId: string, data: DiagnosticFields) {
  const { data: id, error } = await untypedDb.rpc("trainer_save_diagnostic", {
    p_entry: entryId,
    p_client: clientId,
    p_data: data,
  });
  if (error) throw error;
  return String(id);
}

/**
 * Фото с телефона — уменьшенная копия (длинная сторона до 1600 px, WebP,
 * у старого Safari — JPEG): снимки камеры весят 3–8 МБ.
 */
async function shrinkPhoto(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    const webp = await encode("image/webp");
    return webp?.type === "image/webp" ? webp : await encode("image/jpeg");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Загружает фото в папку клиента; путь — для photo_paths. */
export async function uploadDiagnosticPhoto(clientId: string, file: File): Promise<string> {
  const blob = await shrinkPhoto(file);
  if (!blob) throw new Error("bad_image");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${clientId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await untypedDb.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (error) throw error;
  return path;
}

/** Убрать фото из хранилища (тренер удалил его в форме); ошибку не показываем. */
export async function removeDiagnosticPhotos(paths: string[]) {
  if (paths.length === 0) return;
  await untypedDb.storage.from(PHOTO_BUCKET).remove(paths);
}

// ---- Клиент ----

/** Все мои диагностики, старые первыми. До миграции — пусто. */
export function myDiagnosticsQuery(userId: string | null) {
  return queryOptions({
    queryKey: ["my-body-diagnostics", userId],
    queryFn: async (): Promise<BodyDiagnostic[]> => {
      const { data, error } = await untypedDb.rpc("my_body_diagnostics");
      if (error) return [];
      return ((data as BodyDiagnostic[] | null) ?? []).map(normalizeDiagnostic);
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}

/** Подписанные ссылки на фото (на час). Ключ — путь в бакете. */
export function diagnosticPhotosQuery(paths: string[]) {
  return queryOptions({
    queryKey: ["diagnostic-photos", paths],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await untypedDb.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(paths, 3600);
      if (error) return {};
      const out: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
      return out;
    },
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    meta: { persist: false },
  });
}
