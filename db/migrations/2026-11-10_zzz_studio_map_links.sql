-- ============================================================================
-- Ссылки на карты у клуба (решение владельца 2026-11-10): «Клубы» в админке —
-- ссылки на Google Карты и Яндекс Карты; в пакетном приложении в «Сменить
-- студию» у каждой студии — «Выбрать» и «Показать на карте» (Google /
-- Яндекс). studios читается публично по колонкам — добавляем в гранты, как
-- photo_url (2026-10-14_zz_app_sign_in_closed_studio_photo.sql). Прежние
-- studio_app_settings.google_maps_url / yandex_maps_url не используются с
-- 2026-10-12 и сюда не переносятся.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

alter table public.studios add column if not exists google_maps_url text;
alter table public.studios add column if not exists yandex_maps_url text;

comment on column public.studios.google_maps_url is
  'Ссылка на клуб в Google Картах (кнопка в выборе студии приложения).';
comment on column public.studios.yandex_maps_url is
  'Ссылка на клуб в Яндекс Картах (кнопка в выборе студии приложения).';

-- Только https-ссылки: кнопка в приложении открывает её как есть.
alter table public.studios drop constraint if exists studios_map_urls_check;
alter table public.studios add constraint studios_map_urls_check
  check (
    (google_maps_url is null or google_maps_url ~ '^https://\S+$')
    and (yandex_maps_url is null or yandex_maps_url ~ '^https://\S+$')
  );

grant select (google_maps_url, yandex_maps_url) on public.studios to anon, authenticated;
grant update (google_maps_url, yandex_maps_url) on public.studios to authenticated;

notify pgrst, 'reload schema';
