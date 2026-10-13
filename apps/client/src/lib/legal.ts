import { APP_FORMAT, FORMAT_APP_URL, type StudioFormat } from "@/lib/app-format";

/**
 * Реквизиты для политики конфиденциальности (components/privacy-policy.tsx,
 * экран /privacy). Свои у каждого приложения — по формату сборки.
 *
 * null — данные ещё не переданы владельцем: в тексте видна подсвеченная
 * заглушка «[…]», чтобы пропуск не ушёл незамеченным.
 */
export type PrivacyPolicyInfo = {
  /** Бренд в тексте политики. */
  brand: string;
  /** Адрес приложения. */
  appUrl: string;
  /** Оператор данных: полное наименование (как в реестре, по-английски). */
  operatorName: string | null;
  /** Идентификационный код (ს/კ). */
  operatorIdCode: string | null;
  /** Юридический адрес. */
  operatorAddress: string | null;
  /** Почта для запросов по персональным данным. */
  privacyEmail: string | null;
  /** Телефон оператора (необязательно). */
  phone: string | null;
  /** Публичная оферта на сайте. */
  offerUrl: string | null;
  /** Дата вступления в силу текущей редакции, ISO (ГГГГ-ММ-ДД). */
  effectiveDate: string | null;
};

const POLICY_INFO: Record<StudioFormat, PrivacyPolicyInfo> = {
  subscription: {
    brand: "Base40",
    appUrl: FORMAT_APP_URL.subscription,
    operatorName: null,
    operatorIdCode: null,
    operatorAddress: null,
    privacyEmail: null,
    phone: null,
    offerUrl: null,
    effectiveDate: null,
  },
  packages: {
    brand: "Lady Stretch",
    appUrl: FORMAT_APP_URL.packages,
    operatorName: null,
    operatorIdCode: null,
    operatorAddress: null,
    privacyEmail: null,
    phone: null,
    offerUrl: null,
    effectiveDate: null,
  },
};

export const PRIVACY_POLICY_INFO = POLICY_INFO[APP_FORMAT];
