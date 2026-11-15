-- ============================================================================
-- «Полная стоимость до скидки» и «Выгода» в номенклатуре (решение владельца
-- 2026-11-15, как в прайсе студии): зачёркнутая цена под ценой пакета и плашка
-- «выгода N ₾» в карточке пакета приложения. Оба числа вводят вручную в
-- «Номенклатурах», база их не считает и ни в продажах, ни в отчётах не
-- использует — только витрина. null — не показывается.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

alter table public.memberships add column if not exists full_price numeric(10, 2);
alter table public.memberships add column if not exists savings_amount numeric(10, 2);

alter table public.memberships drop constraint if exists memberships_full_price_check;
alter table public.memberships add constraint memberships_full_price_check
  check (full_price is null or full_price >= 0);
alter table public.memberships drop constraint if exists memberships_savings_amount_check;
alter table public.memberships add constraint memberships_savings_amount_check
  check (savings_amount is null or savings_amount >= 0);

comment on column public.memberships.full_price is
  'Полная стоимость до скидки — зачёркнутая цена в карточке пакета приложения (вручную, null — нет).';
comment on column public.memberships.savings_amount is
  'Выгода, ₾ — плашка «выгода N ₾» в карточке пакета приложения (вручную, null — нет).';
