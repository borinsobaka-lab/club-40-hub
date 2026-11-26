import { useQuery } from "@tanstack/react-query";

import { useStudios } from "@/hooks/use-studios";
import { supabase } from "@/integrations/supabase/client";
import type { PayFormat, PayrollAdjustment, MonthKey } from "@/lib/payroll";
import { BONUS_RATE, monthBounds } from "@/lib/payroll";
import type { ContentTranslations } from "@/lib/content-i18n";
import { unwrap } from "@/lib/query";

/**
 * Справочник сотрудников — общий над студиями (раздел рейки «Сотрудники»):
 * тренеры, администраторы и массажисты (таблица trainers, роль —
 * trainers.role; массажист — с 2026-10-12, db/migrations/2026-10-12_zzzzzzz_staff_masseurs.sql). Один
 * сотрудник может работать в нескольких студиях (trainer_studios); в
 * расписании студии выбираются только её сотрудники. Реквизиты
 * (trainer_bank_details) и зарплатные ставки (trainer_pay_rates) — отдельные
 * таблицы, их видят только сотрудники с разделом «Сотрудники». Страницы
 * раздела — «Сотрудники» (/trainers), «Зарплатные ставки» (/pay-rates),
 * «График администраторов» (/admin-shifts) и «Зарплаты» (/payroll; расчёт —
 * lib/payroll.ts).
 */

// Роли сотрудников — в lib/staff-roles.ts (без запросов к базе: их проверяют тесты).
export {
  TRAINER_ROLES,
  hasRating,
  isAdminRole,
  roleGroup,
  type TrainerRole,
} from "@/lib/staff-roles";
import { isAdminRole, type TrainerRole } from "@/lib/staff-roles";

export type BankCode = "bog" | "tbc" | "credo";

/** iban — код банка в грузинском IBAN (5–6-й знаки): по нему банк подставляется сам. */
export const BANKS: { value: BankCode; label: string; short: string; iban: string }[] = [
  { value: "bog", label: "Bank of Georgia", short: "BOG", iban: "BG" },
  { value: "tbc", label: "TBC", short: "TBC", iban: "TB" },
  { value: "credo", label: "Credo", short: "Credo", iban: "CD" },
];

export const bankLabel = (code: string | null | undefined) =>
  BANKS.find((b) => b.value === code)?.label ?? null;

/** GE29 NB00 0000 0101 9049 17 — как в банковских документах. */
export const formatIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");

export type BankDetails = {
  bank: BankCode | null;
  account_number: string | null;
  account_holder: string | null;
};

export type Employee = {
  id: string;
  full_name: string;
  role: TrainerRole;
  photo_url: string | null;
  telegram: string | null;
  /** Биография для приложения (текст с разметкой, lib/formatted-text.tsx). */
  bio: string | null;
  /** Переводы для приложения: {en|ka: {full_name, bio}} (lib/content-i18n.ts). */
  translations: ContentTranslations;
  /** Ссылка на внешний сервис чаевых — кнопка «Поблагодарить тренера» в приложении. */
  tip_url: string | null;
  /**
   * Рейтинг до сотых и число отзывов: прежний сервис (rating_base_*) +
   * оценки клиентов в приложении (trainer_reviews). Итог считает база —
   * db/migrations/2026-10-11_zzzzzzzzzzzzz_trainer_ratings.sql; numeric
   * приходит строкой.
   */
  rating_avg: number | string | null;
  rating_count: number;
  rating_base_avg: number | string | null;
  rating_base_count: number;
  trainer_studios: { studio_id: string; studio: { name: string } | null }[];
  // Связь один к одному: PostgREST отдаёт объект, но на всякий случай
  // принимаем и массив.
  bank_details: BankDetails | BankDetails[] | null;
};

const EMPLOYEE_SELECT =
  "id, full_name, role, photo_url, telegram, bio, translations, tip_url, rating_avg, rating_count, rating_base_avg, rating_base_count, trainer_studios(studio_id, studio:studios(name)), bank_details:trainer_bank_details(bank, account_number, account_holder)";

/** Все сотрудники справочника — общий кэш обеих страниц раздела. */
export function useEmployees() {
  return useQuery({
    queryKey: ["trainers", "all"],
    queryFn: () =>
      unwrap<Employee[]>(supabase.from("trainers").select(EMPLOYEE_SELECT).order("full_name")),
    meta: { errorMessage: "Не удалось загрузить сотрудников" },
  });
}

export function bankOf(e: Pick<Employee, "bank_details"> | null): BankDetails | null {
  const b = e?.bank_details;
  return (Array.isArray(b) ? b[0] : b) ?? null;
}

/**
 * Клубы текущего сотрудника — зарплаты считаются по ним (студия есть, если в
 * ней есть роль), и сотрудники справочника, привязанные хоть к одному из них.
 */
export function usePayrollScope() {
  const { data: studios = [], isLoading: studiosLoading } = useStudios();
  const { data: employees = [], isLoading: employeesLoading } = useEmployees();
  const ids = new Set(studios.map((s) => s.id));
  return {
    studios,
    employees: employees.filter((e) => e.trainer_studios.some((s) => ids.has(s.studio_id))),
    loading: studiosLoading || employeesLoading,
  };
}

export type PayRates = {
  trainer_id: string;
  admin_shift_enabled: boolean;
  admin_shift_rate: number | null;
  group_training_enabled: boolean;
  group_training_rate: number | null;
  personal_training_enabled: boolean;
  personal_training_rate: number | null;
  /** Формат оплаты тренера; у строки, заведённой до 2026-11-24, — classic. */
  pay_format: PayFormat;
  /** Прогрессивная ставка: ₾ тренеру пробного за купленный абонемент; null — 5 % при продаже. */
  trial_sale_bonus: number | null;
  /** Свой процент бонуса с продаж; null — 5 %, как у всех. */
  sales_percent: number | null;
};

/** Доля бонуса с продаж сотрудника: 0.05 по умолчанию. */
export function salesRateOf(rates: Pick<PayRates, "sales_percent"> | null | undefined): number {
  const p = rates?.sales_percent;
  return p == null ? BONUS_RATE : Number(p) / 100;
}

/**
 * Формат выплат сотрудника (вкладка «Зарплат» и дни выплат): прогрессивная —
 * тренер с форматом «Прогрессивная» или администратор со своим процентом с
 * продаж, отличным от 5 (решение владельца 2026-11-26: администраторы
 * купленной студии). То же правило в базе — payroll_pay_format.
 */
export function payFormatOf(
  employee: Pick<Employee, "role">,
  rates: Partial<Pick<PayRates, "pay_format" | "sales_percent">> | null | undefined,
): PayFormat {
  if (employee.role === "trainer")
    return rates?.pay_format === "progressive" ? "progressive" : "classic";
  if (isAdminRole(employee.role)) {
    const p = rates?.sales_percent;
    return p != null && Number(p) !== 5 ? "progressive" : "classic";
  }
  return "classic";
}

export function usePayRates() {
  return useQuery({
    queryKey: ["trainer_pay_rates"],
    queryFn: () => unwrap<PayRates[]>(supabase.from("trainer_pay_rates").select("*")),
    meta: { errorMessage: "Не удалось загрузить зарплатные ставки" },
  });
}

/** Корректировки оклада за месяц — общий кэш «Графика администраторов» и «Зарплат». */
export function usePayrollAdjustments(month: MonthKey, range?: { from: string; to: string }) {
  const { from, to } = range ?? monthBounds(month);
  return useQuery({
    queryKey: ["payroll_adjustments", month, from, to],
    queryFn: () =>
      unwrap<PayrollAdjustment[]>(
        supabase
          .from("payroll_adjustments")
          .select("id, trainer_id, kind, amount, adjusted_on, reason, created_by_name, created_at")
          .gte("adjusted_on", from)
          .lte("adjusted_on", to)
          .order("adjusted_on", { ascending: false })
          .order("created_at", { ascending: false }),
      ),
    meta: { errorMessage: "Не удалось загрузить корректировки" },
  });
}
