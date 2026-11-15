-- ============================================================================
-- «Цена за занятие» в номенклатуре (решение владельца 2026-11-15, как в прайсе
-- студии): «20 ₾ за занятие» рядом с ценой пакета в приложении. Вводится
-- вручную в «Номенклатурах», база не считает и нигде больше не использует —
-- только витрина. null — не показывается.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

alter table public.memberships add column if not exists price_per_class numeric(10, 2);

alter table public.memberships drop constraint if exists memberships_price_per_class_check;
alter table public.memberships add constraint memberships_price_per_class_check
  check (price_per_class is null or price_per_class >= 0);

comment on column public.memberships.price_per_class is
  'Цена за занятие — «N ₾ за занятие» рядом с ценой пакета в приложении (вручную, null — нет).';
