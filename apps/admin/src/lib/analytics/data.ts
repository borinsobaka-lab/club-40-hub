/**
 * «Аналитика» — загрузка (React Query + RPC analytics_*,
 * db/migrations/2026-10-26_zz_analytics.sql). База отдаёт только агрегаты по
 * клубам, где у сотрудника открыт раздел клуба «Аналитика»; строки приходят
 * массивами — здесь они раскладываются в объекты (lib/analytics/types.ts).
 * Ключи начинаются с ANALYTICS_KEY.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  AnScope,
  AnStudio,
  ClassesData,
  Period,
  RevenueRow,
  SaleOrigin,
  SalesData,
  TrialsData,
  ZeroRow,
} from "./types";

export const ANALYTICS_KEY = "analytics";

export type Bucket = "day" | "month";

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v);

type RawStudio = {
  id: string;
  name: string;
  city: string | null;
  format: AnStudio["format"];
  ownership: AnStudio["ownership"];
  brand_id: string | null;
  brand_name: string | null;
  brand_color: string | null;
  point_zero: number | string | null;
  closed_on: string | null;
  can_manage: boolean;
};

export function parseScope(raw: {
  today: string;
  can_manage: boolean;
  studios: RawStudio[];
}): AnScope {
  return {
    today: raw.today,
    canManage: raw.can_manage,
    studios: raw.studios.map((s) => ({
      id: s.id,
      name: s.name,
      city: s.city,
      format: s.format,
      ownership: s.ownership,
      brandId: s.brand_id,
      brandName: s.brand_name,
      brandColor: s.brand_color,
      pointZero: s.point_zero === null ? null : Number(s.point_zero),
      closedOn: s.closed_on,
      canManage: s.can_manage,
    })),
  };
}

export const analyticsScopeQuery = queryOptions({
  queryKey: [ANALYTICS_KEY, "scope"],
  queryFn: async () => parseScope(await rpc("analytics_scope")),
  staleTime: 60_000,
  meta: { errorMessage: "Не удалось загрузить клубы аналитики" },
});

/** Аргументы выборки: клубы (null — все доступные), период, корзина. */
const args = (ids: string[] | null, p: Period, bucket?: Bucket) => ({
  p_studio_ids: ids,
  p_from: p.from,
  p_to: p.to,
  ...(bucket ? { p_bucket: bucket } : {}),
});

const key = (name: string, ids: string[] | null, p: Period, bucket?: Bucket) => [
  ANALYTICS_KEY,
  name,
  ids ? ids.join(",") : "all",
  p.from,
  p.to,
  bucket ?? "",
];

export function revenueQuery(ids: string[] | null, p: Period, bucket: Bucket = "day") {
  return queryOptions({
    queryKey: key("revenue", ids, p, bucket),
    queryFn: async (): Promise<RevenueRow[]> =>
      (await rpc<unknown[][]>("analytics_revenue", args(ids, p, bucket))).map((r) => ({
        studioId: str(r[0]),
        date: str(r[1]),
        membership: num(r[2]),
        other: num(r[3]),
        refunds: num(r[4]),
      })),
    meta: { errorMessage: "Не удалось загрузить выручку" },
  });
}

export function salesQuery(ids: string[] | null, p: Period, bucket: Bucket = "day") {
  return queryOptions({
    queryKey: key("sales", ids, p, bucket),
    queryFn: async (): Promise<SalesData> => {
      const raw = await rpc<{
        sold: unknown[][];
        paid: unknown[][];
        paid_total: unknown[][];
        names: Record<string, [string, string]>;
      }>("analytics_sales", args(ids, p, bucket));
      return {
        sold: raw.sold.map((r) => ({
          studioId: str(r[0]),
          date: str(r[1]),
          membershipId: r[2] === null ? null : str(r[2]),
          origin: r[3] as SaleOrigin,
          count: num(r[4]),
          amount: num(r[5]),
        })),
        paid: raw.paid.map((r) => ({
          studioId: str(r[0]),
          date: str(r[1]),
          origin: r[2] as SaleOrigin,
          income: num(r[3]),
          refunds: num(r[4]),
        })),
        paidTotal: raw.paid_total.map((r) => ({
          studioId: str(r[0]),
          origin: r[1] as SaleOrigin,
          income: num(r[2]),
          refunds: num(r[3]),
          paidSales: num(r[4]),
        })),
        names: Object.fromEntries(
          Object.entries(raw.names).map(([id, [name, kind]]) => [id, { name, kind }]),
        ),
      };
    },
    meta: { errorMessage: "Не удалось загрузить продажи" },
  });
}

export function classesQuery(ids: string[] | null, p: Period, bucket: Bucket = "day") {
  return queryOptions({
    queryKey: key("classes", ids, p, bucket),
    queryFn: async (): Promise<ClassesData> => {
      const raw = await rpc<{ rows: unknown[][]; names: Record<string, string> }>(
        "analytics_classes",
        args(ids, p, bucket),
      );
      return {
        names: raw.names,
        rows: raw.rows.map((r) => ({
          studioId: str(r[0]),
          date: str(r[1]),
          workoutId: r[2] === null ? null : str(r[2]),
          kind: r[3] as "group" | "personal",
          classes: num(r[4]),
          booked: num(r[5]),
          attended: num(r[6]),
          noShow: num(r[7]),
          capacity: num(r[8]),
          capAttended: num(r[9]),
        })),
      };
    },
    meta: { errorMessage: "Не удалось загрузить занятия" },
  });
}

export function trialsQuery(ids: string[] | null, p: Period, bucket: Bucket = "day") {
  return queryOptions({
    queryKey: key("trials", ids, p, bucket),
    queryFn: async (): Promise<TrialsData> => {
      const raw = await rpc<{ rows: unknown[][]; names: Record<string, string> }>(
        "analytics_trials",
        args(ids, p, bucket),
      );
      return {
        names: raw.names,
        rows: raw.rows.map((r) => ({
          studioId: str(r[0]),
          date: str(r[1]),
          membershipId: str(r[2]),
          trials: num(r[3]),
          attended: num(r[4]),
          day0: num(r[5]),
          d14: num(r[6]),
          open: num(r[7]),
        })),
      };
    },
    meta: { errorMessage: "Не удалось загрузить пробные" },
  });
}

export function zeroQuery(ids: string[] | null, p: Period) {
  return queryOptions({
    queryKey: key("zero", ids, p),
    queryFn: async (): Promise<ZeroRow[]> =>
      (await rpc<unknown[][]>("analytics_zero", args(ids, p))).map((r) => ({
        studioId: str(r[0]),
        kind: r[1] as ZeroRow["kind"],
        name: str(r[2]),
        count: num(r[3]),
        lastOn: str(r[4]),
      })),
    meta: { errorMessage: "Не удалось загрузить нулевые продажи" },
  });
}

/** Точка 0 и дата закрытия клуба (право analytics.manage). */
export async function saveStudioSettings(
  studioId: string,
  pointZero: number | null,
  closedOn: string | null,
) {
  await rpc("analytics_settings_save", {
    p_studio_id: studioId,
    p_point_zero: pointZero,
    p_closed_on: closedOn,
  });
}

export function invalidateAnalytics(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: [ANALYTICS_KEY] });
}
