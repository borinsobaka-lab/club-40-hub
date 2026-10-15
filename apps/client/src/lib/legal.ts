import { IS_PACKAGES } from "@/lib/terms";

/**
 * Реквизиты политики конфиденциальности (components/privacy-policy.tsx,
 * экран /privacy). Политика — только у приложения Lady Stretch (пакетное,
 * решение владельца 2026-10-13); у подписочного (Base40) её нет — null, в
 * профиле остаётся прежняя строка «Правовые документы».
 */
export type PrivacyOperator = {
  /** ИП — как в реестре и в оферте студии (по-английски). */
  name: string;
  /** Идентификационный номер. */
  idCode: string;
  /** Студия, с клиентами которой ИП заключает оферту. */
  studio: string;
  address: string;
  phone: string;
};

export type PrivacyPolicyInfo = {
  /** Бренд в тексте политики. */
  brand: string;
  /**
   * Операторы данных — у каждой студии свой ИП (исполнитель по её оферте):
   * Сабуртало — Vladimir Borin, Ваке — Milana Shirshikova (решение
   * владельца 2026-10-13).
   */
  operators: PrivacyOperator[];
  /** Общая почта для запросов по персональным данным. */
  email: string;
  /** Дата вступления в силу текущей редакции, ISO (ГГГГ-ММ-ДД). */
  effectiveDate: string;
};

export const PRIVACY_POLICY_INFO: PrivacyPolicyInfo | null = IS_PACKAGES
  ? {
      brand: "Lady Stretch",
      operators: [
        {
          name: "Individual entrepreneur Vladimir Borin",
          idCode: "304731431",
          studio: "Saburtalo",
          address: "Georgia",
          phone: "+995 591 099 719",
        },
        {
          name: "Individual entrepreneur Milana Shirshikova",
          idCode: "306476569",
          studio: "Vake",
          address: "Georgia",
          phone: "+995 591 288 682",
        },
      ],
      email: "ladystretch.georgia@gmail.com",
      effectiveDate: "2026-10-15",
    }
  : null;
