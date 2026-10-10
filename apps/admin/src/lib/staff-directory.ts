import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/query";

/**
 * Справочник сотрудников — общий над студиями (раздел рейки «Сотрудники»):
 * тренеры и администраторы (таблица trainers, роль — trainers.role). Один
 * сотрудник может работать в нескольких студиях (trainer_studios); в
 * расписании студии выбираются только её сотрудники. Реквизиты
 * (trainer_bank_details) и зарплатные ставки (trainer_pay_rates) — отдельные
 * таблицы, их видят только сотрудники с разделом «Сотрудники». Страницы
 * раздела — «Сотрудники» (/trainers) и «Зарплатные ставки» (/pay-rates).
 */

export type TrainerRole = "trainer" | "admin";

export const TRAINER_ROLES: Record<TrainerRole, { label: string; badge: string }> = {
  trainer: { label: "Тренер", badge: "bg-sky-100 text-sky-700" },
  admin: { label: "Администратор", badge: "bg-violet-100 text-violet-700" },
};

export type BankCode = "bog" | "tbc" | "credo";

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
  trainer_studios: { studio_id: string; studio: { name: string } | null }[];
  // Связь один к одному: PostgREST отдаёт объект, но на всякий случай
  // принимаем и массив.
  bank_details: BankDetails | BankDetails[] | null;
};

const EMPLOYEE_SELECT =
  "id, full_name, role, photo_url, telegram, trainer_studios(studio_id, studio:studios(name)), bank_details:trainer_bank_details(bank, account_number, account_holder)";

/** Все сотрудники справочника — общий кэш обеих страниц раздела. */
export function useEmployees() {
  return useQuery({
    queryKey: ["trainers", "all"],
    queryFn: () =>
      unwrap<Employee[]>(supabase.from("trainers").select(EMPLOYEE_SELECT).order("full_name")),
    meta: { errorMessage: "Не удалось загрузить сотрудников" },
  });
}
