-- ============================================================================
-- Результаты диагностики тела (решение владельца 2026-11-27; перенос формы
-- тренера из прежнего продукта на Lovable, пакетное приложение Lady Stretch).
--
-- Тренер в мобильном приложении видит диагностику в «Моём расписании»
-- (schedule_entries.kind = 'diagnostic', 2026-10-15_zz_diagnostics_client_requests.sql)
-- и по кнопке «Заполнить» проходит форму из пяти шагов: клиент, здоровье,
-- цели, замеры (с фото), рекомендации. Результат клиент видит во вкладке
-- «Диагностика» расписания — все свои диагностики с датами и динамикой.
--
-- 1) body_diagnostics — одна строка на клиента × занятие-диагностику
--    (entry_id; занятие удалили — строка остаётся, entry_id = null). Поля —
--    как в форме прежнего продукта. Варианты выбора хранятся по-русски
--    (ключи словаря приложения, показывается перевод), свободный текст —
--    как написал тренер. rec_focus — свой текст тренера; null — приложение
--    собирает фразу из rec_directions. Дата диагностики — день занятия по
--    Тбилиси. Напрямую таблицу пишет только база (RPC ниже), читают
--    сотрудники клубов, которым видна карточка клиента (под будущий показ в
--    админке). Клиент — RPC my_body_diagnostics, тренер — trainer_*.
-- 2) RPC тренера (security definer, сами проверяют вызывающего —
--    app_trainer_of(auth.uid()), как остальные trainer_*):
--    trainer_diagnostics_state(ids) — кто записан на мои диагностики и
--      заполнена ли форма (кнопка «Заполнить» / «Заполнено»);
--    trainer_diagnostics_todo() — мои прошедшие за 7 дней диагностики, где
--      форма заполнена не у всех (из «Моего расписания» они уже ушли);
--    trainer_diagnostic_form(entry, client) — данные для формы: клиент
--      (имя, телефон, дата рождения из анкеты или карточки), занятие,
--      сохранённая диагностика (правка) и предыдущая (подставить замеры);
--    trainer_save_diagnostic(entry, client, data) — сохранить (повтор —
--      правка той же строки). Можно, пока не прошло 14 дней после занятия;
--      отменённое — нельзя. Посещение («Посетил», списание диагностики) не
--      ставит — это по-прежнему администратор.
-- 3) my_body_diagnostics() — все диагностики учётной записи вызывающего (по
--    его карточкам), старые первыми, с тренером (фото, переводы имени).
-- 4) Фото — закрытый бакет body-diagnostics, папка — id карточки клиента
--    ({client}/{файл}), до 5 на диагностику, 10 МБ на файл. Загружает и
--    удаляет тренер, который ведёт диагностику этого клиента; читают сам
--    клиент (подписанные ссылки), тот же тренер и сотрудники сети карточки.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

-- 1) Таблица ------------------------------------------------------------------------
create table if not exists public.body_diagnostics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  entry_id uuid references public.schedule_entries(id) on delete set null,
  studio_id uuid references public.studios(id) on delete set null,
  trainer_id uuid references public.trainers(id) on delete set null,
  trainer_name text,
  diagnostic_date date not null,
  -- Шаг «Клиент»
  birth_date date,
  activity_level smallint check (activity_level between 0 and 10),
  emotional_level smallint check (emotional_level between 1 and 10),
  emotional_comment text check (char_length(emotional_comment) <= 2000),
  directions text[] not null default '{}',
  -- Шаг «Здоровье»
  no_restrictions boolean not null default false,
  restrictions text[] not null default '{}',
  restrictions_other text check (char_length(restrictions_other) <= 2000),
  -- Шаг «Цели»
  goals text[] not null default '{}',
  priority_today text check (char_length(priority_today) <= 2000),
  -- Шаг «Замеры»
  measure_skipped boolean not null default false,
  chest_cm numeric(5, 1) check (chest_cm between 30 and 250),
  waist_cm numeric(5, 1) check (waist_cm between 30 and 250),
  hips_cm numeric(5, 1) check (hips_cm between 30 and 250),
  weight_kg numeric(5, 1) check (weight_kg between 25 and 300),
  balance_test text check (balance_test in ('Устойчиво', 'Покачивания', 'Риск падения')),
  balance_comment text check (char_length(balance_comment) <= 2000),
  forward_bend text
    check (forward_bend in ('Ладони на полу', 'Пальцы касаются пола', 'До пола не достаёт')),
  forward_bend_cm numeric(4, 1) check (forward_bend_cm between 0 and 100),
  forward_bend_comment text check (char_length(forward_bend_comment) <= 2000),
  split_right_cm numeric(4, 1) check (split_right_cm between 0 and 100),
  split_left_cm numeric(4, 1) check (split_left_cm between 0 and 100),
  split_middle_cm numeric(4, 1) check (split_middle_cm between 0 and 100),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 5),
  -- Шаг «Рекомендации»
  stage smallint check (stage between 1 and 3),
  rec_trainings text check (char_length(rec_trainings) <= 3000),
  rec_directions text[] not null default '{}',
  rec_focus text check (char_length(rec_focus) <= 3000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists body_diagnostics_entry_client_uidx
  on public.body_diagnostics (entry_id, client_id) where entry_id is not null;
create index if not exists body_diagnostics_client_idx
  on public.body_diagnostics (client_id, diagnostic_date);

comment on table public.body_diagnostics is
  'Результаты диагностики тела: форма тренера в приложении (2026-11-27_body_diagnostics.sql).';

alter table public.body_diagnostics enable row level security;
revoke all on public.body_diagnostics from public, anon, authenticated;
grant select on public.body_diagnostics to authenticated;
grant all on public.body_diagnostics to service_role;

drop policy if exists "body_diagnostics staff read" on public.body_diagnostics;
create policy "body_diagnostics staff read" on public.body_diagnostics
  for select to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = body_diagnostics.client_id
       and c.studio_id = any ((select public.auth_network_studio_ids())::uuid[])));

-- 2) Помощники ---------------------------------------------------------------------

-- Клиент записан на эту диагностику (кроме отменённой записи).
create or replace function public.body_diag_booked(p_entry uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.schedule_bookings b
     where b.entry_id = p_entry and b.client_id = p_client
       and b.status in ('booked', 'attended', 'no_show'))
$$;

revoke all on function public.body_diag_booked(uuid, uuid) from public, anon, authenticated;

-- Тренер ведёт диагностику, на которую записан клиент (папка фото — id карточки).
create or replace function public.body_diag_trainer_of_client(p_user uuid, p_client text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.schedule_bookings b
      join public.schedule_entries e on e.id = b.entry_id and e.kind = 'diagnostic'
      join public.schedule_entry_trainers et on et.entry_id = e.id
     where b.client_id::text = p_client
       and b.status in ('booked', 'attended', 'no_show')
       and et.trainer_id = public.app_trainer_of(p_user))
$$;

revoke all on function public.body_diag_trainer_of_client(uuid, text) from public, anon;
grant execute on function public.body_diag_trainer_of_client(uuid, text) to authenticated, service_role;

-- Кто может смотреть фото диагностики клиента: сам клиент, его тренер
-- диагностики, сотрудники сети карточки.
create or replace function public.body_diag_photo_readable(p_user uuid, p_client text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and (
    exists (select 1 from public.clients c
             where c.id::text = p_client
               and (c.user_id = p_user
                    or c.studio_id = any (public.auth_network_studio_ids())))
    or public.body_diag_trainer_of_client(p_user, p_client))
$$;

revoke all on function public.body_diag_photo_readable(uuid, text) from public, anon;
grant execute on function public.body_diag_photo_readable(uuid, text) to authenticated, service_role;

-- Строка диагностики для приложения (тренеру и клиенту — одни поля).
create or replace function public.body_diag_json(d public.body_diagnostics)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id,
    'entry_id', d.entry_id,
    'studio_id', d.studio_id,
    'trainer_id', d.trainer_id,
    'trainer_name', d.trainer_name,
    'diagnostic_date', d.diagnostic_date,
    'birth_date', d.birth_date,
    'activity_level', d.activity_level,
    'emotional_level', d.emotional_level,
    'emotional_comment', d.emotional_comment,
    'directions', to_jsonb(d.directions),
    'no_restrictions', d.no_restrictions,
    'restrictions', to_jsonb(d.restrictions),
    'restrictions_other', d.restrictions_other,
    'goals', to_jsonb(d.goals),
    'priority_today', d.priority_today,
    'measure_skipped', d.measure_skipped,
    'chest_cm', d.chest_cm,
    'waist_cm', d.waist_cm,
    'hips_cm', d.hips_cm,
    'weight_kg', d.weight_kg,
    'balance_test', d.balance_test,
    'balance_comment', d.balance_comment,
    'forward_bend', d.forward_bend,
    'forward_bend_cm', d.forward_bend_cm,
    'forward_bend_comment', d.forward_bend_comment,
    'split_right_cm', d.split_right_cm,
    'split_left_cm', d.split_left_cm,
    'split_middle_cm', d.split_middle_cm,
    'photo_paths', to_jsonb(d.photo_paths),
    'stage', d.stage,
    'rec_trainings', d.rec_trainings,
    'rec_directions', to_jsonb(d.rec_directions),
    'rec_focus', d.rec_focus,
    'created_at', d.created_at,
    'updated_at', d.updated_at)
$$;

revoke all on function public.body_diag_json(public.body_diagnostics) from public, anon, authenticated;

-- 3) RPC тренера -------------------------------------------------------------------

-- Записанные на мои диагностики и заполнена ли форма.
create or replace function public.trainer_diagnostics_state(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id', e.id,
           'editable', e.cancelled_at is null and now() <= e.ends_at + interval '14 days',
           'clients', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'client_id', c.id,
                      'name', coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.full_name),
                      'diagnostic_id', d.id,
                      'updated_at', d.updated_at)
                    order by c.last_name, c.first_name), '[]'::jsonb)
               from public.schedule_bookings b
               join public.clients c on c.id = b.client_id
               left join public.body_diagnostics d on d.entry_id = e.id and d.client_id = c.id
              where b.entry_id = e.id
                and b.status in ('booked', 'attended', 'no_show'))
         ) order by e.starts_at), '[]'::jsonb)
    from public.schedule_entries e
   where e.id = any (coalesce(p_ids, '{}'::uuid[]))
     and e.kind = 'diagnostic'
     and exists (select 1 from public.schedule_entry_trainers et
                  where et.entry_id = e.id
                    and et.trainer_id = public.app_trainer_of(auth.uid()))
$$;

-- Прошедшие за 7 дней диагностики, где форма заполнена не у всех записанных.
create or replace function public.trainer_diagnostics_todo()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
    from public.schedule_entries e
    join public.schedule_entry_trainers et on et.entry_id = e.id
   where et.trainer_id = public.app_trainer_of(auth.uid())
     and e.kind = 'diagnostic'
     and e.cancelled_at is null
     and e.ends_at <= now()
     and e.ends_at > now() - interval '7 days'
     and exists (
       select 1 from public.schedule_bookings b
        where b.entry_id = e.id
          and b.status in ('booked', 'attended')
          and b.client_id is not null
          and not exists (select 1 from public.body_diagnostics d
                           where d.entry_id = e.id and d.client_id = b.client_id))
   order by e.starts_at desc
   limit 20
$$;

-- Данные для формы.
create or replace function public.trainer_diagnostic_form(p_entry uuid, p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entry public.schedule_entries;
  v_client public.clients;
  v_mine public.body_diagnostics;
  v_prev public.body_diagnostics;
  v_birth date;
  v_studio text;
begin
  perform public.trainer_check_entry(p_entry);
  select * into v_entry from public.schedule_entries where id = p_entry;
  if v_entry.kind is distinct from 'diagnostic' or not public.body_diag_booked(p_entry, p_client) then
    raise exception 'not_a_diagnostic' using errcode = '22023';
  end if;
  select * into v_client from public.clients where id = p_client;
  select * into v_mine from public.body_diagnostics where entry_id = p_entry and client_id = p_client;
  select * into v_prev from public.body_diagnostics
   where client_id = p_client and (v_mine.id is null or id <> v_mine.id)
     and diagnostic_date <= (v_entry.starts_at at time zone 'Asia/Tbilisi')::date
   order by diagnostic_date desc, created_at desc
   limit 1;
  select mp.birth_date into v_birth
    from public.member_profiles mp
   where v_client.user_id is not null and mp.user_id = v_client.user_id;
  select s.name into v_studio from public.studios s where s.id = v_entry.studio_id;

  return jsonb_build_object(
    'entry', jsonb_build_object(
      'id', v_entry.id,
      'studio_id', v_entry.studio_id,
      'studio_name', v_studio,
      'starts_at', v_entry.starts_at,
      'ends_at', v_entry.ends_at,
      'date', (v_entry.starts_at at time zone 'Asia/Tbilisi')::date,
      'editable', v_entry.cancelled_at is null and now() <= v_entry.ends_at + interval '14 days'),
    'client', jsonb_build_object(
      'id', v_client.id,
      'name', coalesce(nullif(btrim(concat_ws(' ', v_client.first_name, v_client.last_name)), ''), v_client.full_name),
      'phone', v_client.phone,
      'birth_date', coalesce(v_birth, v_client.birthday::date)),
    'diagnostic', case when v_mine.id is null then null else public.body_diag_json(v_mine) end,
    'previous', case when v_prev.id is null then null else public.body_diag_json(v_prev) end);
end;
$$;

-- Сохранить форму (повтор — правка той же строки).
create or replace function public.trainer_save_diagnostic(p_entry uuid, p_client uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trainer uuid := public.trainer_check_entry(p_entry);
  v_entry public.schedule_entries;
  v_trainer_name text;
  v_id uuid;
  v_photos text[];
  v_skip boolean := coalesce((p_data ->> 'measure_skipped')::boolean, false);
  v_none boolean := coalesce((p_data ->> 'no_restrictions')::boolean, false);
  v_bend text := nullif(btrim(p_data ->> 'forward_bend'), '');
  p jsonb := coalesce(p_data, '{}'::jsonb);
begin
  select * into v_entry from public.schedule_entries where id = p_entry;
  if v_entry.kind is distinct from 'diagnostic' or not public.body_diag_booked(p_entry, p_client) then
    raise exception 'not_a_diagnostic' using errcode = '22023';
  end if;
  if v_entry.cancelled_at is not null or now() > v_entry.ends_at + interval '14 days' then
    raise exception 'diagnostic_closed' using errcode = '22023';
  end if;

  -- Обязательные поля — как в форме.
  if p ->> 'activity_level' is null then
    raise exception 'diagnostic_required:activity' using errcode = '22023';
  end if;
  if not v_none and jsonb_array_length(coalesce(p -> 'restrictions', '[]')) = 0
     and coalesce(btrim(p ->> 'restrictions_other'), '') = '' then
    raise exception 'diagnostic_required:restrictions' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p -> 'goals', '[]')) = 0 then
    raise exception 'diagnostic_required:goals' using errcode = '22023';
  end if;
  if coalesce(btrim(p ->> 'priority_today'), '') = '' then
    raise exception 'diagnostic_required:priority' using errcode = '22023';
  end if;
  if coalesce(p ->> 'balance_test', '') = '' then
    raise exception 'diagnostic_required:balance' using errcode = '22023';
  end if;
  if p ->> 'stage' is null then
    raise exception 'diagnostic_required:stage' using errcode = '22023';
  end if;
  if coalesce(btrim(p ->> 'rec_trainings'), '') = '' then
    raise exception 'diagnostic_required:rec_trainings' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p -> 'rec_directions', '[]')) = 0
     and coalesce(btrim(p ->> 'rec_focus'), '') = '' then
    raise exception 'diagnostic_required:rec_focus' using errcode = '22023';
  end if;

  -- Фото — только из папки этого клиента.
  select coalesce(array_agg(x), '{}') into v_photos
    from jsonb_array_elements_text(coalesce(p -> 'photo_paths', '[]')) x;
  if exists (select 1 from unnest(v_photos) x where x not like p_client::text || '/%' or x like '%..%') then
    raise exception 'diagnostic_bad_photo' using errcode = '22023';
  end if;

  select full_name into v_trainer_name from public.trainers where id = v_trainer;

  insert into public.body_diagnostics as d (
    client_id, entry_id, studio_id, trainer_id, trainer_name, diagnostic_date,
    birth_date, activity_level, emotional_level, emotional_comment, directions,
    no_restrictions, restrictions, restrictions_other, goals, priority_today,
    measure_skipped, chest_cm, waist_cm, hips_cm, weight_kg,
    balance_test, balance_comment, forward_bend, forward_bend_cm, forward_bend_comment,
    split_right_cm, split_left_cm, split_middle_cm, photo_paths,
    stage, rec_trainings, rec_directions, rec_focus, created_by)
  values (
    p_client, p_entry, v_entry.studio_id, v_trainer, v_trainer_name,
    (v_entry.starts_at at time zone 'Asia/Tbilisi')::date,
    nullif(p ->> 'birth_date', '')::date,
    (p ->> 'activity_level')::smallint,
    nullif(p ->> 'emotional_level', '')::smallint,
    nullif(btrim(p ->> 'emotional_comment'), ''),
    array(select jsonb_array_elements_text(coalesce(p -> 'directions', '[]'))),
    v_none,
    case when v_none then '{}'::text[]
         else array(select jsonb_array_elements_text(coalesce(p -> 'restrictions', '[]'))) end,
    case when v_none then null else nullif(btrim(p ->> 'restrictions_other'), '') end,
    array(select jsonb_array_elements_text(coalesce(p -> 'goals', '[]'))),
    btrim(p ->> 'priority_today'),
    v_skip,
    case when v_skip then null else nullif(p ->> 'chest_cm', '')::numeric end,
    case when v_skip then null else nullif(p ->> 'waist_cm', '')::numeric end,
    case when v_skip then null else nullif(p ->> 'hips_cm', '')::numeric end,
    case when v_skip then null else nullif(p ->> 'weight_kg', '')::numeric end,
    p ->> 'balance_test',
    nullif(btrim(p ->> 'balance_comment'), ''),
    v_bend,
    case when v_bend = 'До пола не достаёт' then nullif(p ->> 'forward_bend_cm', '')::numeric end,
    nullif(btrim(p ->> 'forward_bend_comment'), ''),
    nullif(p ->> 'split_right_cm', '')::numeric,
    nullif(p ->> 'split_left_cm', '')::numeric,
    nullif(p ->> 'split_middle_cm', '')::numeric,
    v_photos,
    (p ->> 'stage')::smallint,
    btrim(p ->> 'rec_trainings'),
    array(select jsonb_array_elements_text(coalesce(p -> 'rec_directions', '[]'))),
    nullif(btrim(p ->> 'rec_focus'), ''),
    auth.uid())
  on conflict (entry_id, client_id) where entry_id is not null do update set
    trainer_id = excluded.trainer_id,
    trainer_name = excluded.trainer_name,
    diagnostic_date = excluded.diagnostic_date,
    birth_date = excluded.birth_date,
    activity_level = excluded.activity_level,
    emotional_level = excluded.emotional_level,
    emotional_comment = excluded.emotional_comment,
    directions = excluded.directions,
    no_restrictions = excluded.no_restrictions,
    restrictions = excluded.restrictions,
    restrictions_other = excluded.restrictions_other,
    goals = excluded.goals,
    priority_today = excluded.priority_today,
    measure_skipped = excluded.measure_skipped,
    chest_cm = excluded.chest_cm,
    waist_cm = excluded.waist_cm,
    hips_cm = excluded.hips_cm,
    weight_kg = excluded.weight_kg,
    balance_test = excluded.balance_test,
    balance_comment = excluded.balance_comment,
    forward_bend = excluded.forward_bend,
    forward_bend_cm = excluded.forward_bend_cm,
    forward_bend_comment = excluded.forward_bend_comment,
    split_right_cm = excluded.split_right_cm,
    split_left_cm = excluded.split_left_cm,
    split_middle_cm = excluded.split_middle_cm,
    photo_paths = excluded.photo_paths,
    stage = excluded.stage,
    rec_trainings = excluded.rec_trainings,
    rec_directions = excluded.rec_directions,
    rec_focus = excluded.rec_focus,
    updated_at = now()
  returning d.id into v_id;
  return v_id;
end;
$$;

revoke all on function public.trainer_diagnostics_state(uuid[]), public.trainer_diagnostics_todo(),
  public.trainer_diagnostic_form(uuid, uuid), public.trainer_save_diagnostic(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.trainer_diagnostics_state(uuid[]), public.trainer_diagnostics_todo(),
  public.trainer_diagnostic_form(uuid, uuid), public.trainer_save_diagnostic(uuid, uuid, jsonb)
  to authenticated, service_role;

-- 4) RPC клиента -------------------------------------------------------------------
create or replace function public.my_body_diagnostics()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           public.body_diag_json(d) || jsonb_build_object(
             'trainer', case when t.id is null then null else jsonb_build_object(
               'id', t.id,
               'full_name', t.full_name,
               'photo_url', t.photo_url,
               'translations', t.translations) end)
           order by d.diagnostic_date, d.created_at), '[]'::jsonb)
    from public.body_diagnostics d
    join public.clients c on c.id = d.client_id
    left join public.trainers t on t.id = d.trainer_id
   where auth.uid() is not null and c.user_id = auth.uid()
$$;

revoke all on function public.my_body_diagnostics() from public, anon;
grant execute on function public.my_body_diagnostics() to authenticated, service_role;

-- 5) Фото --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('body-diagnostics', 'body-diagnostics', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "body-diagnostics read" on storage.objects;
create policy "body-diagnostics read" on storage.objects
  for select to authenticated
  using (bucket_id = 'body-diagnostics'
         and public.body_diag_photo_readable(auth.uid(), (storage.foldername(name))[1]));

drop policy if exists "body-diagnostics trainer insert" on storage.objects;
create policy "body-diagnostics trainer insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'body-diagnostics'
              and public.body_diag_trainer_of_client(auth.uid(), (storage.foldername(name))[1]));

drop policy if exists "body-diagnostics trainer delete" on storage.objects;
create policy "body-diagnostics trainer delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'body-diagnostics'
         and public.body_diag_trainer_of_client(auth.uid(), (storage.foldername(name))[1]));
