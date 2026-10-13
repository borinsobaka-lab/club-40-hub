import { IS_PACKAGES } from "@/lib/terms";

/**
 * Реквизиты политики конфиденциальности (components/privacy-policy.tsx,
 * экран /privacy). Политика — только у приложения Lady Stretch (пакетное,
 * решение владельца 2026-10-13); у подписочного (Base40) её нет — null, в
 * профиле остаётся прежняя строка «Правовые документы».
 */
export type PrivacyPolicyInfo = {
  /** Бренд в тексте политики. */
  brand: string;
  /** Студии бренда — к каждой своя публичная оферта. */
  studios: string;
  /** Оператор данных — как в реестре (по-английски). */
  operatorName: string;
  /** Идентификационный номер. */
  operatorIdCode: string;
  /** Адрес оператора. */
  operatorAddress: string;
  /** Почта для запросов по персональным данным. */
  email: string;
  phone: string;
  /** Дата вступления в силу текущей редакции, ISO (ГГГГ-ММ-ДД). */
  effectiveDate: string;
};

export const PRIVACY_POLICY_INFO: PrivacyPolicyInfo | null = IS_PACKAGES
  ? {
      brand: "Lady Stretch",
      studios: "Vake and Saburtalo",
      operatorName: "Individual entrepreneur Vladimir Borin",
      operatorIdCode: "304731431",
      operatorAddress: "Georgia",
      email: "ladystretch.georgia@gmail.com",
      phone: "+995 591 099 719",
      effectiveDate: "2026-10-13",
    }
  : null;
