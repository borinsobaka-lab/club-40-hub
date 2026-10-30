-- ============================================================================
-- «Аудиоаналитика» — запись рабочего дня на ресепшене и разбор разговоров
-- (решение владельца 2026-10-30: перенос речевой аналитики из отдельного
-- проекта audio-analitics на портал, сервис — на том же сервере; скрипты и
-- CRM прежнего проекта не переносятся). Устройство, решения и запуск —
-- AUDIO_ANALYTICS.md.
--
-- Кто что пишет:
--   * сервис services/audio-analytics (прямое подключение DATABASE_URL, мимо
--     RLS): приём записи из приложения на ресепшене (смены, сегменты), разбор
--     (расшифровка, диалоги, реплики, оценки, итог дня, стоимость), сборки
--     приложения, стирание аудио из очереди aa_storage_purge;
--   * админка (RLS + RPC ниже): точки продажи, менеджеры, метрики, промпты,
--     запуск разбора и удаление смены, «согласен / не согласен»,
--     договорённости.
--
-- Права (каталог «Пользователей и ролей», сеть):
--   audio.own    — смены, где менеджер — он сам (aa_managers.user_id);
--   audio.view   — все смены, итоги, договорённости (подводит итог);
--   audio.manage — настройки: метрики, промпты, точки, менеджеры,
--                  приложение; запуск разбора, удаление смен.
-- У людей вне модели прав — владелец клуба (как an_has).
--
-- Политики — в виде initplan: то, что не зависит от строки, считается один
-- раз на запрос ((select auth_aa_view_all()), auth_aa_manager_ids()).
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

-- 1) Права ------------------------------------------------------------------------
insert into public.access_permissions (key, block, label, hint, scope, levels, target, sort_order) values
  ('audio.own', 'sections', 'Аудиоаналитика: свои смены',
   'Разборы своих смен (менеджер связан с учётной записью в «Аудиоаналитике» → «Менеджеры»), свои договорённости, «согласен / не согласен».',
   'network', '{on}', null, 140),
  ('audio.view', 'sections', 'Аудиоаналитика: все смены',
   'Разборы смен всех менеджеров, дашборд, договорённости — записывает и подводит итог.',
   'network', '{on}', null, 141),
  ('audio.manage', 'sections', 'Аудиоаналитика: настройки',
   'Метрики и промпты разбора, точки продажи, менеджеры, приложение записи; запускает разбор смены и удаляет смены.',
   'network', '{on}', null, 142)
on conflict (key) do update
  set block = excluded.block, label = excluded.label, hint = excluded.hint, scope = excluded.scope,
      levels = excluded.levels, target = excluded.target, sort_order = excluded.sort_order;

-- Право; у человека вне модели прав — владелец клуба.
create or replace function public.aa_has(_user_id uuid, _right text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.access_user_rights where user_id = _user_id)
      then public.access_has_right(_user_id, _right)
    else exists (select 1 from public.user_roles where user_id = _user_id and role = 'owner')
  end
$$;
revoke all on function public.aa_has(uuid, text) from public, anon;
grant execute on function public.aa_has(uuid, text) to authenticated, service_role;

-- Видит все смены: «все смены» или «настройки».
create or replace function public.auth_aa_view_all()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.aa_has(auth.uid(), 'audio.view') or public.aa_has(auth.uid(), 'audio.manage')
$$;
revoke all on function public.auth_aa_view_all() from public, anon;
grant execute on function public.auth_aa_view_all() to authenticated, service_role;

create or replace function public.auth_aa_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.aa_has(auth.uid(), 'audio.manage')
$$;
revoke all on function public.auth_aa_manage() from public, anon;
grant execute on function public.auth_aa_manage() to authenticated, service_role;

-- Хоть какое-то право в разделе (читает справочники: точки, менеджеры, метрики).
create or replace function public.auth_aa_any()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_aa_view_all() or public.aa_has(auth.uid(), 'audio.own')
$$;
revoke all on function public.auth_aa_any() from public, anon;
grant execute on function public.auth_aa_any() to authenticated, service_role;

-- 2) Таблицы ----------------------------------------------------------------------
-- Точка продажи — студия с одним ресепшеном, где стоит компьютер с приложением.
create table if not exists public.aa_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  address text not null default '' check (char_length(address) <= 500),
  timezone text not null default 'Asia/Tbilisi',
  active boolean not null default true,
  -- Клуб портала, если точка — наш клуб (подпись; на доступ не влияет).
  studio_id uuid references public.studios(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists aa_locations_name_uidx on public.aa_locations (lower(btrim(name)));

-- Менеджер — имя в списке приложения на ресепшене. Деактивированный уходит
-- из списка, но остаётся автором прошлых смен. user_id — учётная запись
-- портала: по ней право «свои смены».
create table if not exists public.aa_managers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 200),
  active boolean not null default true,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists aa_managers_user_idx on public.aa_managers (user_id);

-- Смена — одна сессия записи (обычно рабочий день точки). Не уникальна по
-- (точка, дата): после завершённой смены повторный старт — отдельная смена.
create table if not exists public.aa_recordings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.aa_locations(id),
  manager_id uuid references public.aa_managers(id) on delete set null,
  date date not null,
  -- recording → uploaded → queued → processing → done | error
  status text not null default 'recording'
    check (status in ('recording', 'uploaded', 'queued', 'processing', 'done', 'error')),
  status_detail text not null default '',
  -- Когда статус или пояснение менялись: по нему видно зависший разбор.
  status_changed_at timestamptz not null default now(),
  -- Разбор попросили с повторным распознаванием речи.
  process_full boolean not null default false,
  queued_by uuid references auth.users(id) on delete set null,
  raw_audio_uri text,
  total_duration_s double precision,
  speech_duration_s double precision,
  asr_seconds double precision,
  llm_input_tokens integer not null default 0,
  llm_output_tokens integer not null default 0,
  llm_calls integer not null default 0,
  cost_usd double precision,
  -- Аудио стёрто по сроку хранения (разбор и текст остались).
  audio_purged_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists aa_recordings_date_idx on public.aa_recordings (date desc, created_at desc);
create index if not exists aa_recordings_location_idx on public.aa_recordings (location_id, date);
create index if not exists aa_recordings_manager_idx on public.aa_recordings (manager_id, date);
create index if not exists aa_recordings_status_idx on public.aa_recordings (status) where status in ('queued', 'processing');

-- Сегмент — 5-минутный кусок записи из приложения (Ogg Opus).
create table if not exists public.aa_segments (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.aa_recordings(id) on delete cascade,
  idx integer not null check (idx >= 0),
  audio_uri text not null,
  size_bytes integer,
  uploaded_at timestamptz not null default now(),
  unique (recording_id, idx)
);

create table if not exists public.aa_transcripts (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.aa_recordings(id) on delete cascade,
  asr_provider text not null default 'elevenlabs',
  language_hint text not null default 'auto',
  -- Слова с таймкодами по исходной записи (JSON в хранилище) — пересчёт
  -- берёт их и за распознавание второй раз не платит.
  raw_json_uri text,
  text text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists aa_transcripts_recording_idx on public.aa_transcripts (recording_id, created_at desc);

-- Диалог — разговор внутри смены. Личные (irrelevant) — без текста и реплик.
create table if not exists public.aa_dialogs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.aa_recordings(id) on delete cascade,
  start_s double precision not null,
  end_s double precision not null,
  type text not null check (type in ('sale', 'consultation', 'refusal', 'service', 'irrelevant')),
  outcome text,
  brief text not null default ''
);
create index if not exists aa_dialogs_recording_idx on public.aa_dialogs (recording_id, start_s);

create table if not exists public.aa_dialog_turns (
  id uuid primary key default gen_random_uuid(),
  dialog_id uuid not null references public.aa_dialogs(id) on delete cascade,
  speaker_label text not null,
  start_s double precision not null,
  end_s double precision not null,
  text text not null
);
create index if not exists aa_dialog_turns_dialog_idx on public.aa_dialog_turns (dialog_id, start_s);

-- Метрика — название + инструкции модели + шкала. Каждый разговор смены
-- оценивается по всем активным метрикам одним запросом.
create table if not exists public.aa_metrics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  prompt text not null check (char_length(prompt) <= 60000),
  scale_max integer not null default 10 check (scale_max in (5, 10)),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.aa_metric_evaluations (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.aa_recordings(id) on delete cascade,
  dialog_id uuid not null references public.aa_dialogs(id) on delete cascade,
  metric_id uuid not null references public.aa_metrics(id) on delete cascade,
  applicable boolean not null default false,
  score integer,
  good jsonb not null default '[]'::jsonb,
  bad jsonb not null default '[]'::jsonb,
  comment text not null default '',
  unique (dialog_id, metric_id)
);
create index if not exists aa_metric_evaluations_recording_idx on public.aa_metric_evaluations (recording_id);
create index if not exists aa_metric_evaluations_metric_idx on public.aa_metric_evaluations (metric_id);

-- Итог смены: число диалогов, продаж и сводка дня от модели.
create table if not exists public.aa_day_summaries (
  recording_id uuid primary key references public.aa_recordings(id) on delete cascade,
  dialogs_total integer not null default 0,
  sales_count integer not null default 0,
  conversion double precision,
  summary jsonb
);

-- Служебные промпты разбора (деление дня на диалоги, итог дня). Правка —
-- новая версия (aa_prompt_save), активная — последняя.
create table if not exists public.aa_prompts (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key in ('dialog_segmentation', 'daily_summary')),
  name text not null,
  description text not null default '',
  content text not null check (char_length(content) <= 100000),
  model text,
  version integer not null default 1,
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (key, version)
);

-- «Согласен / не согласен» с оценкой метрики в разговоре; один голос
-- человека на оценку, повтор меняет мнение.
create table if not exists public.aa_feedback (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.aa_recordings(id) on delete cascade,
  dialog_id uuid not null references public.aa_dialogs(id) on delete cascade,
  metric_id uuid not null references public.aa_metrics(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  subject_name text not null default '',
  agree boolean not null,
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);
create unique index if not exists aa_feedback_vote_uidx on public.aa_feedback (dialog_id, metric_id, author_id);
create index if not exists aa_feedback_recording_idx on public.aa_feedback (recording_id);

-- Договорённость по итогам разбора: всплывает в следующей смене менеджера.
create table if not exists public.aa_agreements (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid references public.aa_managers(id) on delete set null,
  manager_name text not null default '',
  recording_id uuid not null references public.aa_recordings(id) on delete cascade,
  day_date date not null,
  dialog_id uuid references public.aa_dialogs(id) on delete set null,
  dialog_start_s double precision,
  text text not null check (char_length(btrim(text)) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'done', 'missed', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_name text not null default '',
  resolved_recording_id uuid references public.aa_recordings(id) on delete set null,
  resolution_note text not null default '' check (char_length(resolution_note) <= 2000)
);
create index if not exists aa_agreements_manager_idx on public.aa_agreements (manager_id, status, day_date);
create index if not exists aa_agreements_recording_idx on public.aa_agreements (recording_id);

-- Сборка приложения записи (апдейтер Tauri): архив в хранилище, подпись здесь.
create table if not exists public.aa_app_releases (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('darwin', 'windows', 'linux')),
  version text not null,
  notes text not null default '',
  archive_uri text not null,
  signature text not null,
  size_bytes bigint not null default 0,
  published boolean not null default true,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (platform, version)
);

-- Очередь стирания файлов в хранилище: удалённая смена, сборка. Разбирает
-- сервис (строки базы удаляются сразу, файлы — следом).
create table if not exists public.aa_storage_purge (
  id bigserial primary key,
  prefix text not null check (char_length(prefix) > 0),
  created_at timestamptz not null default now()
);

-- Состояние сервиса (пишет сервис): сигнал жизни воркера, что настроено.
-- «Настройки» видят его в «Приложении» — работает ли разбор на сервере.
create table if not exists public.aa_service_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3) Доступ -----------------------------------------------------------------------
-- Менеджеры вызывающего (право «свои смены»).
create or replace function public.auth_aa_manager_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case when public.aa_has(auth.uid(), 'audio.own')
              then coalesce(array_agg(id), '{}'::uuid[]) else '{}'::uuid[] end
    from public.aa_managers where user_id = auth.uid()
$$;
revoke all on function public.auth_aa_manager_ids() from public, anon;
grant execute on function public.auth_aa_manager_ids() to authenticated, service_role;

-- Смены, доступные вызывающему по праву «свои» (все — проверяется отдельно).
create or replace function public.auth_aa_own_recording_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(r.id), '{}'::uuid[])
    from public.aa_recordings r
   where r.manager_id = any (public.auth_aa_manager_ids())
$$;
revoke all on function public.auth_aa_own_recording_ids() from public, anon;
grant execute on function public.auth_aa_own_recording_ids() to authenticated, service_role;

-- Видна ли смена вызывающему (для RPC).
create or replace function public.aa_recording_visible(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_aa_view_all()
      or exists (select 1 from public.aa_recordings r
                  where r.id = p_id and r.manager_id = any (public.auth_aa_manager_ids()))
$$;
revoke all on function public.aa_recording_visible(uuid) from public, anon;
grant execute on function public.aa_recording_visible(uuid) to authenticated, service_role;

-- Имя вызывающего для подписей.
create or replace function public.aa_my_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = auth.uid()),
    (select u.email::text from auth.users u where u.id = auth.uid()),
    '')
$$;
revoke all on function public.aa_my_name() from public, anon, authenticated;

alter table public.aa_locations enable row level security;
alter table public.aa_managers enable row level security;
alter table public.aa_recordings enable row level security;
alter table public.aa_segments enable row level security;
alter table public.aa_transcripts enable row level security;
alter table public.aa_dialogs enable row level security;
alter table public.aa_dialog_turns enable row level security;
alter table public.aa_metrics enable row level security;
alter table public.aa_metric_evaluations enable row level security;
alter table public.aa_day_summaries enable row level security;
alter table public.aa_prompts enable row level security;
alter table public.aa_feedback enable row level security;
alter table public.aa_agreements enable row level security;
alter table public.aa_app_releases enable row level security;
alter table public.aa_storage_purge enable row level security;
alter table public.aa_service_state enable row level security;

revoke all on public.aa_locations, public.aa_managers, public.aa_recordings, public.aa_segments,
  public.aa_transcripts, public.aa_dialogs, public.aa_dialog_turns, public.aa_metrics,
  public.aa_metric_evaluations, public.aa_day_summaries, public.aa_prompts, public.aa_feedback,
  public.aa_agreements, public.aa_app_releases, public.aa_storage_purge, public.aa_service_state
  from anon, authenticated;
grant all on public.aa_locations, public.aa_managers, public.aa_recordings, public.aa_segments,
  public.aa_transcripts, public.aa_dialogs, public.aa_dialog_turns, public.aa_metrics,
  public.aa_metric_evaluations, public.aa_day_summaries, public.aa_prompts, public.aa_feedback,
  public.aa_agreements, public.aa_app_releases, public.aa_storage_purge, public.aa_service_state
  to service_role;
grant usage, select on sequence public.aa_storage_purge_id_seq to service_role;

-- Чтение: справочники — любому с правом раздела; смены и всё, что в них, —
-- «все смены» или свои.
grant select on public.aa_locations, public.aa_managers, public.aa_recordings, public.aa_segments,
  public.aa_transcripts, public.aa_dialogs, public.aa_dialog_turns, public.aa_metrics,
  public.aa_metric_evaluations, public.aa_day_summaries, public.aa_prompts, public.aa_feedback,
  public.aa_agreements, public.aa_app_releases, public.aa_service_state
  to authenticated;
-- Правка справочников — «настройки».
grant insert, update, delete on public.aa_locations, public.aa_managers, public.aa_metrics to authenticated;
grant update (published, notes), delete on public.aa_app_releases to authenticated;
grant delete on public.aa_feedback to authenticated;

drop policy if exists "aa locations read" on public.aa_locations;
create policy "aa locations read" on public.aa_locations for select to authenticated
  using ((select public.auth_aa_any()));
drop policy if exists "aa locations manage" on public.aa_locations;
create policy "aa locations manage" on public.aa_locations for all to authenticated
  using ((select public.auth_aa_manage())) with check ((select public.auth_aa_manage()));

drop policy if exists "aa managers read" on public.aa_managers;
create policy "aa managers read" on public.aa_managers for select to authenticated
  using ((select public.auth_aa_any()));
drop policy if exists "aa managers manage" on public.aa_managers;
create policy "aa managers manage" on public.aa_managers for all to authenticated
  using ((select public.auth_aa_manage())) with check ((select public.auth_aa_manage()));

drop policy if exists "aa metrics read" on public.aa_metrics;
create policy "aa metrics read" on public.aa_metrics for select to authenticated
  using ((select public.auth_aa_any()));
drop policy if exists "aa metrics manage" on public.aa_metrics;
create policy "aa metrics manage" on public.aa_metrics for all to authenticated
  using ((select public.auth_aa_manage())) with check ((select public.auth_aa_manage()));

drop policy if exists "aa prompts read" on public.aa_prompts;
create policy "aa prompts read" on public.aa_prompts for select to authenticated
  using ((select public.auth_aa_any()));

drop policy if exists "aa recordings read" on public.aa_recordings;
create policy "aa recordings read" on public.aa_recordings for select to authenticated
  using ((select public.auth_aa_view_all())
         or manager_id = any ((select public.auth_aa_manager_ids())::uuid[]));

drop policy if exists "aa segments read" on public.aa_segments;
create policy "aa segments read" on public.aa_segments for select to authenticated
  using ((select public.auth_aa_view_all())
         or recording_id = any ((select public.auth_aa_own_recording_ids())::uuid[]));

drop policy if exists "aa transcripts read" on public.aa_transcripts;
create policy "aa transcripts read" on public.aa_transcripts for select to authenticated
  using ((select public.auth_aa_view_all())
         or recording_id = any ((select public.auth_aa_own_recording_ids())::uuid[]));

drop policy if exists "aa dialogs read" on public.aa_dialogs;
create policy "aa dialogs read" on public.aa_dialogs for select to authenticated
  using ((select public.auth_aa_view_all())
         or recording_id = any ((select public.auth_aa_own_recording_ids())::uuid[]));

drop policy if exists "aa dialog turns read" on public.aa_dialog_turns;
create policy "aa dialog turns read" on public.aa_dialog_turns for select to authenticated
  using ((select public.auth_aa_view_all())
         or exists (select 1 from public.aa_dialogs d
                     where d.id = dialog_id
                       and d.recording_id = any ((select public.auth_aa_own_recording_ids())::uuid[])));

drop policy if exists "aa evaluations read" on public.aa_metric_evaluations;
create policy "aa evaluations read" on public.aa_metric_evaluations for select to authenticated
  using ((select public.auth_aa_view_all())
         or recording_id = any ((select public.auth_aa_own_recording_ids())::uuid[]));

drop policy if exists "aa day summaries read" on public.aa_day_summaries;
create policy "aa day summaries read" on public.aa_day_summaries for select to authenticated
  using ((select public.auth_aa_view_all())
         or recording_id = any ((select public.auth_aa_own_recording_ids())::uuid[]));

drop policy if exists "aa feedback read" on public.aa_feedback;
create policy "aa feedback read" on public.aa_feedback for select to authenticated
  using ((select public.auth_aa_view_all())
         or recording_id = any ((select public.auth_aa_own_recording_ids())::uuid[]));
-- Свой голос снимает только автор — чужой не трогает никто.
drop policy if exists "aa feedback delete own" on public.aa_feedback;
create policy "aa feedback delete own" on public.aa_feedback for delete to authenticated
  using (author_id = (select auth.uid()));

drop policy if exists "aa agreements read" on public.aa_agreements;
create policy "aa agreements read" on public.aa_agreements for select to authenticated
  using ((select public.auth_aa_view_all())
         or manager_id = any ((select public.auth_aa_manager_ids())::uuid[]));

drop policy if exists "aa service state read" on public.aa_service_state;
create policy "aa service state read" on public.aa_service_state for select to authenticated
  using ((select public.auth_aa_manage()));

drop policy if exists "aa releases manage" on public.aa_app_releases;
create policy "aa releases manage" on public.aa_app_releases for all to authenticated
  using ((select public.auth_aa_manage())) with check ((select public.auth_aa_manage()));

-- 4) Триггеры ---------------------------------------------------------------------
-- Метрика: подпись правки.
create or replace function public.aa_metrics_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'INSERT' and coalesce(new.position, 0) = 0 then
    new.position := coalesce((select max(position) from public.aa_metrics), 0) + 1;
  end if;
  return new;
end;
$$;
drop trigger if exists aa_metrics_biu on public.aa_metrics;
create trigger aa_metrics_biu before insert or update on public.aa_metrics
  for each row execute function public.aa_metrics_biu();

-- Точка со сменами не удаляется — только закрывается (иначе отчёты потеряют
-- студию); внешний ключ и так не даст, здесь — понятный текст.
create or replace function public.aa_locations_bd()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.aa_recordings where location_id = old.id) then
    raise exception 'aa_location_has_recordings'
      using hint = 'На точке есть смены — её можно только закрыть, иначе прошлые отчёты потеряют студию';
  end if;
  return old;
end;
$$;
drop trigger if exists aa_locations_bd on public.aa_locations;
create trigger aa_locations_bd before delete on public.aa_locations
  for each row execute function public.aa_locations_bd();

-- Удалённая сборка — её архив в очередь стирания.
create or replace function public.aa_app_releases_ad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.aa_storage_purge (prefix) values (old.archive_uri);
  return old;
end;
$$;
drop trigger if exists aa_app_releases_ad on public.aa_app_releases;
create trigger aa_app_releases_ad after delete on public.aa_app_releases
  for each row execute function public.aa_app_releases_ad();

-- 5) RPC админки ------------------------------------------------------------------
-- Права и счётчик для рейки.
create or replace function public.aa_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'own', public.aa_has(auth.uid(), 'audio.own'),
    'view', public.aa_has(auth.uid(), 'audio.view'),
    'manage', public.aa_has(auth.uid(), 'audio.manage'),
    'manager_ids', to_jsonb(public.auth_aa_manager_ids()),
    'open_agreements', (
      select count(*) from public.aa_agreements a
       where a.status = 'open'
         and (public.auth_aa_view_all() or a.manager_id = any (public.auth_aa_manager_ids()))))
$$;
revoke all on function public.aa_access() from public, anon;
grant execute on function public.aa_access() to authenticated;

-- Люди портала для связи менеджера с учётной записью («Менеджеры»): кто
-- получит право «свои смены». Только «настройкам»; справочник компании —
-- как people_cards (имя, почта, аватарка, должность).
create or replace function public.aa_people()
returns table (user_id uuid, full_name text, email text, avatar_url text, position_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.auth_aa_manage() then
    raise exception 'aa_forbidden' using errcode = '42501';
  end if;
  return query
  select u.id,
         coalesce(nullif(btrim(p.full_name), ''), u.email::text),
         u.email::text,
         p.avatar_url,
         pos.name
    from auth.users u
    join (select public.portal_people_ids() as id) pp on pp.id = u.id
    left join public.profiles p on p.id = u.id
    left join public.portal_users pu on pu.user_id = u.id
    left join public.org_positions pos on pos.id = pu.position_id
   order by 2;
end;
$$;
revoke all on function public.aa_people() from public, anon;
grant execute on function public.aa_people() to authenticated;

-- Разбор завис: в очереди или в работе, а статус не двигался 3 часа.
create or replace function public.aa_is_stale(p_status text, p_changed timestamptz)
returns boolean
language sql
immutable
as $$
  select p_status in ('queued', 'processing') and p_changed < now() - interval '3 hours'
$$;

-- Запустить разбор смены (или пересчитать). p_full — распознать речь заново.
create or replace function public.aa_recording_process(p_id uuid, p_full boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.aa_recordings;
begin
  if not public.auth_aa_manage() then
    raise exception 'aa_forbidden' using errcode = '42501';
  end if;
  select * into r from public.aa_recordings where id = p_id for update;
  if not found then
    raise exception 'aa_not_found';
  end if;
  if r.status = 'recording' then
    raise exception 'aa_still_recording' using hint = 'Запись ещё не завершена в приложении';
  end if;
  if r.status in ('queued', 'processing') and not public.aa_is_stale(r.status, r.status_changed_at) then
    raise exception 'aa_busy' using hint = 'Смена уже в очереди на разбор';
  end if;
  update public.aa_recordings
     set status = 'queued', status_detail = 'поставлена в очередь на разбор',
         status_changed_at = now(), process_full = coalesce(p_full, false), queued_by = auth.uid()
   where id = p_id;
end;
$$;
revoke all on function public.aa_recording_process(uuid, boolean) from public, anon;
grant execute on function public.aa_recording_process(uuid, boolean) to authenticated;

-- Закрыть смену, которую приложение не закрыло само (вылет, выключили).
create or replace function public.aa_recording_force_finish(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.aa_recordings;
begin
  if not public.auth_aa_manage() then
    raise exception 'aa_forbidden' using errcode = '42501';
  end if;
  select * into r from public.aa_recordings where id = p_id for update;
  if not found then
    raise exception 'aa_not_found';
  end if;
  if r.status <> 'recording' then
    raise exception 'aa_not_recording' using hint = 'Смена уже закрыта';
  end if;
  if not exists (select 1 from public.aa_segments where recording_id = p_id) then
    raise exception 'aa_no_segments'
      using hint = 'На сервер не загружено ни одного сегмента — эту смену можно только удалить';
  end if;
  update public.aa_recordings
     set status = 'uploaded', status_detail = 'завершена вручную из админки, ждёт запуска разбора',
         status_changed_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.aa_recording_force_finish(uuid) from public, anon;
grant execute on function public.aa_recording_force_finish(uuid) to authenticated;

-- Стереть смену целиком: разбор, расшифровку, отзывы, договорённости и аудио
-- (папка смены — в очередь стирания, разбирает сервис).
create or replace function public.aa_recording_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.aa_recordings;
begin
  if not public.auth_aa_manage() then
    raise exception 'aa_forbidden' using errcode = '42501';
  end if;
  select * into r from public.aa_recordings where id = p_id for update;
  if not found then
    raise exception 'aa_not_found';
  end if;
  if r.status = 'processing' and not public.aa_is_stale(r.status, r.status_changed_at) then
    raise exception 'aa_busy' using hint = 'Смена сейчас разбирается — дождитесь окончания';
  end if;
  delete from public.aa_recordings where id = p_id;
  insert into public.aa_storage_purge (prefix) values ('recordings/' || p_id::text || '/');
end;
$$;
revoke all on function public.aa_recording_delete(uuid) from public, anon;
grant execute on function public.aa_recording_delete(uuid) to authenticated;

-- Сохранить промпт новой версией (история линейная; откат — сохранить старый текст).
create or replace function public.aa_prompt_save(p_key text, p_content text, p_model text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.aa_prompts;
  new_id uuid;
begin
  if not public.auth_aa_manage() then
    raise exception 'aa_forbidden' using errcode = '42501';
  end if;
  if coalesce(btrim(p_content), '') = '' then
    raise exception 'aa_empty_prompt' using hint = 'Промпт пустой';
  end if;
  select * into cur from public.aa_prompts where key = p_key order by version desc limit 1 for update;
  if not found then
    raise exception 'aa_not_found';
  end if;
  update public.aa_prompts set active = false where key = p_key;
  insert into public.aa_prompts (key, name, description, content, model, version, active, updated_by, updated_by_name)
  values (p_key, cur.name, cur.description, p_content, nullif(btrim(coalesce(p_model, '')), ''),
          cur.version + 1, true, auth.uid(), public.aa_my_name())
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.aa_prompt_save(text, text, text) from public, anon;
grant execute on function public.aa_prompt_save(text, text, text) to authenticated;

-- «Согласен / не согласен» с оценкой метрики в разговоре.
create or replace function public.aa_feedback_set(p_dialog_id uuid, p_metric_id uuid, p_agree boolean, p_comment text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.aa_dialogs;
  subject text;
  fid uuid;
begin
  select * into d from public.aa_dialogs where id = p_dialog_id;
  if not found or not public.aa_recording_visible(d.recording_id) then
    raise exception 'aa_not_found';
  end if;
  if not exists (select 1 from public.aa_metrics where id = p_metric_id) then
    raise exception 'aa_not_found';
  end if;
  select coalesce(m.full_name, '') into subject
    from public.aa_recordings r left join public.aa_managers m on m.id = r.manager_id
   where r.id = d.recording_id;
  insert into public.aa_feedback (recording_id, dialog_id, metric_id, author_id, author_name, subject_name, agree, comment)
  values (d.recording_id, d.id, p_metric_id, auth.uid(), public.aa_my_name(), coalesce(subject, ''),
          p_agree, left(btrim(coalesce(p_comment, '')), 1000))
  on conflict (dialog_id, metric_id, author_id)
  do update set agree = excluded.agree, comment = excluded.comment, created_at = now()
  returning id into fid;
  return fid;
end;
$$;
revoke all on function public.aa_feedback_set(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.aa_feedback_set(uuid, uuid, boolean, text) to authenticated;

-- Договорённость по итогам смены (необязательно — по разговору).
create or replace function public.aa_agreement_create(p_recording_id uuid, p_text text, p_dialog_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.aa_recordings;
  d_start double precision;
  aid uuid;
begin
  select * into r from public.aa_recordings where id = p_recording_id;
  if not found or not public.aa_recording_visible(p_recording_id) then
    raise exception 'aa_not_found';
  end if;
  if coalesce(btrim(p_text), '') = '' then
    raise exception 'aa_empty_text' using hint = 'Напишите, о чём договорились';
  end if;
  if p_dialog_id is not null then
    select start_s into d_start from public.aa_dialogs where id = p_dialog_id and recording_id = p_recording_id;
    if not found then
      raise exception 'aa_not_found' using hint = 'Разговор не найден в этой смене';
    end if;
  end if;
  insert into public.aa_agreements (manager_id, manager_name, recording_id, day_date, dialog_id, dialog_start_s,
                                    text, created_by, created_by_name)
  values (r.manager_id, coalesce((select full_name from public.aa_managers where id = r.manager_id), ''),
          r.id, r.date, p_dialog_id, d_start, left(btrim(p_text), 2000), auth.uid(), public.aa_my_name())
  returning id into aid;
  return aid;
end;
$$;
revoke all on function public.aa_agreement_create(uuid, text, uuid) from public, anon;
grant execute on function public.aa_agreement_create(uuid, text, uuid) to authenticated;

-- Итог договорённости и правка текста — только «все смены»: иначе
-- «выполнено» ставил бы себе тот, кого проверяют. Пояснение к итогу — и
-- менеджер (свою договорённость).
create or replace function public.aa_agreement_update(
  p_id uuid,
  p_status text default null,
  p_text text default null,
  p_note text default null,
  p_resolved_recording_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.aa_agreements;
  all_view boolean := public.auth_aa_view_all();
begin
  select * into a from public.aa_agreements where id = p_id for update;
  if not found or not (all_view or a.manager_id = any (public.auth_aa_manager_ids())) then
    raise exception 'aa_not_found';
  end if;
  if (p_status is not null or p_text is not null) and not all_view then
    raise exception 'aa_forbidden' using errcode = '42501',
      hint = 'Отмечать итог договорённости может тот, кто видит все смены';
  end if;
  if p_status is not null and p_status not in ('open', 'done', 'missed', 'cancelled') then
    raise exception 'aa_bad_status';
  end if;
  if p_resolved_recording_id is not null and not public.aa_recording_visible(p_resolved_recording_id) then
    raise exception 'aa_not_found';
  end if;
  update public.aa_agreements
     set text = coalesce(nullif(left(btrim(p_text), 2000), ''), text),
         resolution_note = coalesce(left(btrim(p_note), 2000), resolution_note),
         status = coalesce(p_status, status),
         resolved_at = case when p_status is null or p_status = a.status then resolved_at
                            when p_status = 'open' then null else now() end,
         resolved_by_name = case when p_status is null or p_status = a.status then resolved_by_name
                                 when p_status = 'open' then '' else public.aa_my_name() end,
         resolved_recording_id = case when p_status is null or p_status = a.status then resolved_recording_id
                                      when p_status = 'open' then null else p_resolved_recording_id end
   where id = p_id;
end;
$$;
revoke all on function public.aa_agreement_update(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.aa_agreement_update(uuid, text, text, text, uuid) to authenticated;

-- Удалить — «все смены» или автор.
create or replace function public.aa_agreement_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.aa_agreements;
begin
  select * into a from public.aa_agreements where id = p_id;
  if not found or not (public.auth_aa_view_all()
                       or (a.created_by = auth.uid() and a.manager_id = any (public.auth_aa_manager_ids()))) then
    raise exception 'aa_not_found';
  end if;
  delete from public.aa_agreements where id = p_id;
end;
$$;
revoke all on function public.aa_agreement_delete(uuid) from public, anon;
grant execute on function public.aa_agreement_delete(uuid) to authenticated;

-- Список смен с показателями метрик (последние p_limit, по точкам; пусто — все).
create or replace function public.aa_days(p_location_ids uuid[] default null, p_limit integer default 120)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with recs as (
    select r.*
      from public.aa_recordings r
     where p_location_ids is null or cardinality(p_location_ids) = 0 or r.location_id = any (p_location_ids)
     order by r.date desc, r.created_at desc
     limit least(greatest(coalesce(p_limit, 120), 1), 500)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'location_id', r.location_id, 'location_name', l.name,
      'manager_id', r.manager_id, 'manager_name', m.full_name,
      'date', r.date, 'status', r.status, 'status_detail', r.status_detail,
      'status_changed_at', r.status_changed_at,
      'stale', public.aa_is_stale(r.status, r.status_changed_at),
      'total_duration_s', r.total_duration_s, 'speech_duration_s', r.speech_duration_s,
      'cost_usd', r.cost_usd, 'created_at', r.created_at,
      'segments', (select count(*) from public.aa_segments s where s.recording_id = r.id),
      'dialogs_total', ds.dialogs_total, 'sales_count', ds.sales_count,
      'metric_stats', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'metric_id', mt.id, 'name', mt.name, 'scale_max', mt.scale_max,
                 'triggered', x.triggered, 'avg', x.avg) order by mt.position, mt.name), '[]'::jsonb)
          from (select e.metric_id,
                       count(*) filter (where e.applicable) as triggered,
                       round(avg(e.score) filter (where e.applicable)::numeric, 1) as avg
                  from public.aa_metric_evaluations e
                 where e.recording_id = r.id
                 group by e.metric_id) x
          join public.aa_metrics mt on mt.id = x.metric_id))
    order by r.date desc, r.created_at desc), '[]'::jsonb)
    from recs r
    join public.aa_locations l on l.id = r.location_id
    left join public.aa_managers m on m.id = r.manager_id
    left join public.aa_day_summaries ds on ds.recording_id = r.id
$$;
revoke all on function public.aa_days(uuid[], integer) from public, anon;
grant execute on function public.aa_days(uuid[], integer) to authenticated;

-- Сводка за период рядом с предыдущим такой же длины (дашборд). «Свои» —
-- фильтр по своим менеджерам принудительно (RLS и так отрежет чужое).
create or replace function public.aa_summary(
  p_from date,
  p_to date,
  p_manager_id uuid default null,
  p_location_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  len integer;
  prev_from date;
  prev_to date;
  result jsonb;
begin
  if p_to < p_from then
    raise exception 'aa_bad_period' using hint = 'Конец периода раньше начала';
  end if;
  len := p_to - p_from + 1;
  if len > 730 then
    raise exception 'aa_bad_period' using hint = 'Период длиннее 730 дней';
  end if;
  prev_to := p_from - 1;
  prev_from := prev_to - (len - 1);

  with shifts as (
    select r.id, r.date, r.manager_id,
           coalesce(ds.dialogs_total, 0) as dialogs, coalesce(ds.sales_count, 0) as sales,
           coalesce(r.speech_duration_s, 0) as speech, coalesce(r.cost_usd, 0) as cost,
           (r.date >= p_from) as cur
      from public.aa_recordings r
      left join public.aa_day_summaries ds on ds.recording_id = r.id
     where r.status = 'done' and r.date between prev_from and p_to
       and (p_manager_id is null or r.manager_id = p_manager_id)
       and (p_location_ids is null or cardinality(p_location_ids) = 0 or r.location_id = any (p_location_ids))
  ),
  scores as (
    select s.cur, s.manager_id, s.date, e.metric_id, count(*) as n, sum(e.score)::numeric as total
      from shifts s
      join public.aa_metric_evaluations e on e.recording_id = s.id
     where e.applicable and e.score is not null
     group by s.cur, s.manager_id, s.date, e.metric_id
  ),
  tot as (
    select cur, count(*) as shifts, sum(dialogs) as dialogs, sum(sales) as sales,
           sum(speech) as speech, sum(cost) as cost
      from shifts group by cur
  ),
  metric_cur as (
    select metric_id, sum(n) as n, round(sum(total) / nullif(sum(n), 0), 1) as avg
      from scores where cur group by metric_id
  ),
  metric_prev as (
    select metric_id, round(sum(total) / nullif(sum(n), 0), 1) as avg
      from scores where not cur group by metric_id
  )
  select jsonb_build_object(
    'date_from', p_from, 'date_to', p_to, 'prev_date_from', prev_from, 'prev_date_to', prev_to,
    'totals', (select jsonb_build_object('shifts', coalesce(t.shifts, 0), 'dialogs', coalesce(t.dialogs, 0),
                        'sales', coalesce(t.sales, 0),
                        'conversion', round(t.sales::numeric / nullif(t.dialogs, 0), 3),
                        'speech_seconds', round(coalesce(t.speech, 0)::numeric, 1),
                        'cost_usd', round(coalesce(t.cost, 0)::numeric, 4))
                 from (select 1) one left join tot t on t.cur),
    'previous', (select jsonb_build_object('shifts', coalesce(t.shifts, 0), 'dialogs', coalesce(t.dialogs, 0),
                        'sales', coalesce(t.sales, 0),
                        'conversion', round(t.sales::numeric / nullif(t.dialogs, 0), 3),
                        'speech_seconds', round(coalesce(t.speech, 0)::numeric, 1),
                        'cost_usd', round(coalesce(t.cost, 0)::numeric, 4))
                   from (select 1) one left join tot t on not t.cur),
    'metrics', (select coalesce(jsonb_agg(jsonb_build_object(
                  'metric_id', m.id, 'name', m.name, 'scale_max', m.scale_max,
                  'triggered', coalesce(c.n, 0), 'avg', c.avg, 'prev_avg', p.avg)
                  order by m.position, m.name), '[]'::jsonb)
                  from public.aa_metrics m
                  left join metric_cur c on c.metric_id = m.id
                  left join metric_prev p on p.metric_id = m.id
                 where c.metric_id is not null or p.metric_id is not null),
    'managers', (select coalesce(jsonb_agg(row order by (row->'totals'->>'dialogs')::int desc, row->>'full_name'), '[]'::jsonb)
                   from (select jsonb_build_object(
                           'manager_id', s.manager_id,
                           'full_name', coalesce(mg.full_name, 'Менеджер не указан'),
                           'totals', jsonb_build_object('shifts', count(*), 'dialogs', sum(s.dialogs),
                                       'sales', sum(s.sales),
                                       'conversion', round(sum(s.sales)::numeric / nullif(sum(s.dialogs), 0), 3),
                                       'speech_seconds', round(sum(s.speech)::numeric, 1),
                                       'cost_usd', round(sum(s.cost)::numeric, 4)),
                           'metrics', (select coalesce(jsonb_agg(jsonb_build_object(
                                          'metric_id', m.id, 'name', m.name, 'scale_max', m.scale_max,
                                          'triggered', coalesce(c.n, 0), 'avg', c.avg, 'prev_avg', p.avg)
                                          order by m.position, m.name), '[]'::jsonb)
                                         from public.aa_metrics m
                                         left join (select metric_id, sum(n) as n,
                                                           round(sum(total) / nullif(sum(n), 0), 1) as avg
                                                      from scores sc
                                                     where sc.cur and sc.manager_id is not distinct from s.manager_id
                                                     group by metric_id) c on c.metric_id = m.id
                                         left join (select metric_id, round(sum(total) / nullif(sum(n), 0), 1) as avg
                                                      from scores sc
                                                     where not sc.cur and sc.manager_id is not distinct from s.manager_id
                                                     group by metric_id) p on p.metric_id = m.id
                                        where c.metric_id is not null or p.metric_id is not null)) as row
                           from shifts s
                           left join public.aa_managers mg on mg.id = s.manager_id
                          where s.cur
                          group by s.manager_id, mg.full_name) x),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object(
                'date', d.date, 'dialogs', d.dialogs, 'sales', d.sales,
                'conversion', round(d.sales::numeric / nullif(d.dialogs, 0), 3),
                'cost_usd', round(d.cost::numeric, 4),
                'avg_scores', (select coalesce(jsonb_object_agg(x.metric_id, x.avg), '{}'::jsonb)
                                 from (select metric_id, round(sum(total) / nullif(sum(n), 0), 1) as avg
                                         from scores sc where sc.cur and sc.date = d.date
                                        group by metric_id) x))
                order by d.date), '[]'::jsonb)
                from (select date, sum(dialogs) as dialogs, sum(sales) as sales, sum(cost) as cost
                        from shifts where cur group by date) d))
  into result;
  return result;
end;
$$;
revoke all on function public.aa_summary(date, date, uuid, uuid[]) from public, anon;
grant execute on function public.aa_summary(date, date, uuid, uuid[]) to authenticated;

-- 6) Стартовые данные ----------------------------------------------------------------
-- Служебные промпты — как в прежнем проекте (pipeline/llm.py), если их ещё нет.
insert into public.aa_prompts (key, name, description, content, version, active, updated_by_name)
select 'dialog_segmentation', $aa$Этап 1 — Сегментация дня на диалоги$aa$, $aa$Вход: транскрипт рабочего дня с таймкодами и спикерами. Выход: список отдельных взаимодействий с классификацией. Плейсхолдеры: {{transcript}}$aa$, $aa$Ты — аналитик продаж студии растяжки. Вход: транскрипт рабочего дня с таймкодами и метками спикеров (языки: русский/грузинский/английский, возможно смешение).

Раздели поток на отдельные взаимодействия (диалоги). Для каждого диалога определи тип:
- sale — состоялась продажа (клиент согласился купить/записаться, обсуждали оплату/запись)
- consultation — консультация без покупки
- refusal — клиент отказался
- service — сервисный вопрос действующего клиента (перенос, оплата, расписание)
- irrelevant — нерелевантный разговор (личный, между сотрудниками, телефон не по делу)

Правила:
- Опирайся ТОЛЬКО на текст транскрипта, ничего не выдумывай.
- Если сомневаешься между sale и consultation — ставь consultation.
- Личные разговоры сотрудников помечай irrelevant и не пересказывай их содержание в brief.

Ответ — строго JSON-массив без пояснений:
[{"start_s": число, "end_s": число, "type": "sale|consultation|refusal|service|irrelevant",
  "participants": ["speaker_0", ...], "brief": "1-2 предложения о сути"}]

Транскрипт дня:
{{transcript}}$aa$, 1, true, 'Стартовый набор'
 where not exists (select 1 from public.aa_prompts where key = 'dialog_segmentation');
insert into public.aa_prompts (key, name, description, content, version, active, updated_by_name)
select 'daily_summary', $aa$Итог дня — Сводка и рекомендации$aa$, $aa$Reduce-этап: агрегирует разборы всех диалогов дня в общие выводы. Плейсхолдеры: {{analyses}}, {{stats}}$aa$, $aa$Ты — руководитель отдела продаж студии растяжки. Ниже — статистика дня
и разборы всех диалогов с клиентами за день.

СТАТИСТИКА ДНЯ:
{{stats}}

РАЗБОРЫ ДИАЛОГОВ (JSON):
{{analyses}}

Составь итог дня:
1. top_deviations — 3-5 самых частых/критичных отклонений от скрипта за день
2. recommendations — конкретные рекомендации менеджеру (что менять завтра)
3. script_suggestions — предложения по улучшению самого скрипта продаж, если разборы
   показывают систематическую проблему (иначе пустой список)
4. highlights — 1-3 удачных момента дня (что менеджер сделал хорошо)

Опирайся только на данные разборов. Ответ — строго JSON без пояснений:
{"top_deviations": [], "recommendations": [], "script_suggestions": [], "highlights": []}$aa$, 1, true, 'Стартовый набор'
 where not exists (select 1 from public.aa_prompts where key = 'daily_summary');
-- Метрики — готовые промпты Lady Stretch (docs/prompts прежнего проекта):
-- только в пустой справочник. Перенос из прежнего проекта
-- (services/audio-analytics/cli/import_legacy.py) заменяет их своими.
do $seed$
begin
  if not exists (select 1 from public.aa_metrics) then
    insert into public.aa_metrics (name, prompt, scale_max, active, position)
    values ($aa$Встреча и выявление цели$aa$, $aa$Ты оцениваешь работу администратора студии растяжки Lady Stretch (Тбилиси, студии Ваке и Сабуртало) на этапе встречи клиентки, пришедшей на пробное занятие, — **до самого занятия**.

## КОГДА МЕТРИКА ПРИМЕНИМА

Метрика оценивает встречу **только новой клиентки**, которая пришла впервые — на пробное (гостевое) занятие. С постоянными клиентками ничего этого делать не нужно: с ними достаточно поздороваться, и оценивать там нечего.

Метрика применима (applicable = true), только если выполнены **оба** условия:

1. Клиентка **новая** — пришла впервые, на пробное или гостевое занятие.
2. Разговор происходит **до занятия** — это первый контакт на ресепшене.

**Признаки новой клиентки** (нужен хотя бы один явный):
- прозвучал вопрос «Вы у нас впервые?» — и клиентка подтвердила;
- администратор представляется по имени и спрашивает имя клиентки;
- прямо упоминается пробное занятие, гостевое посещение, первый раз, первое посещение;
- администратор объясняет базовое устройство студии человеку, который его явно не знает: где раздевалка, тапочки, какие есть направления, как записываться через приложение;
- администратор знакомит с тренером: «ваш тренер — [имя], она вас уже ждёт».

**Признаки постоянной клиентки** (метрика не применима):
- администратор здоровается и сразу обращается по имени, не спрашивая его;
- речь об уже имеющемся абонементе, оставшихся занятиях, продлении, переносе, записи в приложении;
- «как обычно», «на то же время», «на ваше занятие»;
- никакого рассказа о студии и знакомства — короткий обмен фразами.

Метрика НЕ применима (applicable = false, score = null), если это:
- **встреча постоянной клиентки** — короткое приветствие в её адрес это нормальная работа, а не проваленная встреча;
- разговор после занятия про абонементы, цены, оплату — это зона метрики «Качество продажи абонемента»;
- сервисный вопрос действующей клиентки (перенос, продление, расписание);
- разговор сотрудников между собой, личный разговор, телефонный разговор;
- фрагмент, где реплик так мало или они так плохо распознаны, что оценивать нечего;
- **по транскрипту невозможно понять, новая клиентка или постоянная.**

Если во фрагменте есть и встреча, и продажа после занятия — оценивай только часть про встречу. Если сомневаешься в применимости — выбирай applicable = false. Ложная оценка вреднее пропуска.

## ЭТАЛОН: КАК ДОЛЖНА ВЫГЛЯДЕТЬ ВСТРЕЧА НОВОЙ КЛИЕНТКИ

Главный принцип студии: **мы не продаём абонемент, мы помогаем человеку сделать то, что она давно хотела**. На этом этапе задача администратора — не продать, а понять. Это самый важный шаг всей продажи: цель, которую он сейчас выяснит, станет опорой для разговора после занятия. Говорить — 20% времени, слушать — 80%.

Всё описанное ниже относится к клиентке, пришедшей впервые. Постоянных клиенток этот сценарий не касается.

1. **Встреча и знакомство.** Встать, улыбнуться, пойти навстречу. «Здравствуйте! Вы у нас впервые?». Представиться по имени и спросить имя клиентки: «Меня зовут [ИМЯ]. Как вас зовут?». Дальше обращаться по имени.
2. **Организационное.** Предложить тапочки, показать раздевалку, договориться о следующем шаге: «Когда будете готовы, подойдите ко мне, я расскажу вам о студии».
3. **Опыт.** «Вы раньше занимались растяжкой или фитнесом?».
4. **Цель прихода — ключевой вопрос.** «А сейчас что привело вас к нам? Чего хотите для себя?». Если клиентка затрудняется — помочь вариантами: «Может, хочется снять напряжение? Гибкость улучшить? Или со спиной что-то?».
5. **Уточнение — 1–2 вопроса по ситуации**, не весь список подряд: «Расскажите подробнее — что именно беспокоит?», «Как давно это чувствуете?», «Что для вас самое важное — чтобы что-то конкретно изменилось?», «Раньше пробовали что-то делать с этим?».
6. **Слушать, а не говорить.** Дать клиентке рассказать, не перебивать, реагировать по-человечески.
7. **Рассказ о студии — коротко и адресно**, опираясь на то, что она рассказала о себе: «У нас как раз есть направления, которые хорошо помогают с [ЕЁ СИТУАЦИЯ]». Ключевые факты: две студии — Ваке и Сабуртало, по одному абонементу можно ходить в обе; пять направлений (растяжка, аэро-стретчинг, растяжка с подкачкой, здоровая спина, пилатес); работа с 9 до 21 каждый день; запись через мобильное приложение в любой момент.
8. **Передача тренеру.** Сказать, что тренер посмотрит уровень и после занятия скажет, что лучше подойдёт (это готовит почву для разговора о продаже). Назвать тренера по имени: «Ваш тренер — [ИМЯ], она вас уже ждёт». Спросить, есть ли вопросы до занятия, и физически проводить в зал.

**Грубые нарушения на этом этапе:** называть цены и абонементы до занятия; перебивать клиентку; говорить о студии больше, чем слушать; не спросить имя; отправить в зал, не выяснив цель; сравнивать себя с конкурентами.

## КАК СТАВИТЬ ОЦЕНКУ

Считай баллы по чек-листу (в сумме 10), затем применяй ограничители.

| Что оцениваешь | Балл |
|---|---|
| Приветствие: поздоровался, представился, спросил имя и дальше обращается по имени | 1,5 |
| Организационное: тапочки, раздевалка, договорённость подойти после переодевания | 0,5 |
| Вопрос об опыте занятий (растяжка, фитнес) | 1,0 |
| Вопрос о цели прихода, при затруднении — помощь вариантами | 2,0 |
| 1–2 уточняющих вопроса по её ситуации | 1,5 |
| Слушал больше, чем говорил; не перебивал; реагировал живо | 1,0 |
| Рассказ о студии адресно под её ситуацию + ключевые факты (две студии по одному абонементу, направления, часы, приложение) | 1,5 |
| Передача тренеру: назвал по имени, сказал про рекомендации после занятия, спросил о вопросах, проводил в зал | 1,0 |

**Ограничители (перекрывают сумму):**
- цель прихода вообще не выяснялась → не выше 4;
- имя клиентки не спрошено → не выше 6;
- администратор называл цены или абонементы до занятия → не выше 5;
- перебивал клиентку или говорил заметно больше неё → не выше 6;
- не передал тренеру и не проводил в зал (при том, что фрагмент дошёл до этого момента) → не выше 8.

**Калибровка:**
- **10** — эталон: тёплая встреча со знакомством, выяснены опыт и настоящая цель, 1–2 точных уточнения, клиентка говорила больше администратора, рассказ о студии привязан к её ситуации, передача тренеру по имени.
- **8–9** — сделано почти всё, пропущены мелочи (например, не уточнил, как давно беспокоит).
- **6–7** — цель выяснена поверхностно, одним вопросом, без уточнений; или рассказ о студии шаблонный, без привязки к её ситуации.
- **4–5** — знакомство формальное, вопросов о цели почти нет, администратор в основном рассказывал.
- **2–3** — клиентку просто отправили в зал.
- **1** — грубые нарушения: назвал цены до занятия, перебивал, вёл себя холодно.

Не оценивай исход: на этом этапе ничего не продаётся. Оценивай только качество контакта и глубину выявления цели. Длинные реплики администратора сами по себе не повышают оценку — здесь ценно как раз обратное.

## КАК ПИСАТЬ ОБРАТНУЮ СВЯЗЬ

Обратная связь пойдёт на личный разбор с администратором, поэтому она должна быть конкретной и разбираемой.

**Каждый пункт в `good` и `bad` начинай с таймкода** в формате `[ЧЧ:ММ:СС]`, взятого из транскрипта, — по нему запись можно переслушать.

- `good` — что сработало: `[ЧЧ:ММ:СС] Этап — что сделал администратор — «дословная цитата»`.
- `bad` — что упущено или сделано плохо: `[ЧЧ:ММ:СС] Этап — что произошло — «цитата» → надо было: конкретная фраза или действие`. Если этап просто пропущен, цитаты не будет — тогда укажи таймкод момента, где он должен был прозвучать.
- Пиши о действиях, а не о личности: «не задал ни одного уточняющего вопроса о цели», а не «невнимательный администратор».
- 2–5 пунктов в каждом списке. Не дроби мелочи, выбирай то, что реально повлияло.
- `comment` — 1–2 предложения: какую цель клиентки удалось выяснить (дословно, если названа) и главное, что стоит изменить в следующий раз. Если цель не выяснена — так и напиши: разговору после занятия будет не на что опереться.

## ОГРАНИЧЕНИЯ

- Запись сделана одним микрофоном на ресепшене: клиентку часто слышно хуже, распознавание ошибается, часть слов может быть искажена. Оценивай смысл, а не точность формулировок, и не снижай балл за дефекты записи.
- Разговор может идти на русском, грузинском или английском, в том числе со смешением языков в одной фразе. Обратную связь пиши по-русски.
- Встреча может быть разорвана на два фрагмента: знакомство до переодевания и рассказ о студии после. Оценивай только то, что слышно в этом фрагменте; отсутствие остального в записи — не ошибка администратора.
- За смену через ресепшен проходит много постоянных клиенток. Большинство коротких приветствий — именно они, и метрика к ним не применяется. Нормально, если за день метрика сработает всего несколько раз — по числу новых клиенток.
- Опирайся только на транскрипт. Не додумывай, что «наверное, было сказано». Если для вывода нет цитаты — не делай вывод.$aa$, 10, true, 1);
    insert into public.aa_metrics (name, prompt, scale_max, active, position)
    values ($aa$Качество продажи абонемента$aa$, $aa$Ты оцениваешь работу администратора студии растяжки Lady Stretch (Тбилиси, студии Ваке и Сабуртало) на этапе продажи абонемента — в разговоре с клиенткой **после пробного занятия**.

## КОГДА МЕТРИКА ПРИМЕНИМА

Метрика оценивает продажу **первого абонемента новой клиентке**, только что прошедшей пробное (гостевое) занятие. Продление у действующей клиентки — другой сценарий, скрипт под него не написан, и эта метрика его не оценивает.

Метрика применима (applicable = true), если в диалоге есть **попытка продать абонемент клиентке после пробного занятия**, то есть присутствует хотя бы одно из:
- администратор называет варианты абонементов, цены, количество занятий или выгоду;
- обсуждается оплата, рассрочка, депозит, фиксация цены;
- администратор предлагает выбрать расписание или записаться на следующие занятия после пробного;
- клиентка возражает по цене/времени/сомнениям, и администратор на это отвечает.

Метрика НЕ применима (applicable = false, score = null), если это:
- только встреча и знакомство до занятия, без единого слова об абонементе — это зона метрики «Встреча и выявление цели»;
- **продление абонемента действующей клиенткой**: речь об оставшихся занятиях, продлении на прежних условиях, скидке за продление, «как в прошлый раз»;
- сервисный вопрос действующей клиентки (перенос, расписание, заморозка);
- **телефонный звонок с записью на пробное занятие** (слышна только речь администратора, цель — назначить день и время пробного) — это зона метрики «Качество звонка», даже если в нём упоминаются цены абонементов;
- разговор сотрудников между собой, личный разговор, телефонный разговор не о продаже;
- фрагмент, где реплик так мало или они так плохо распознаны, что оценивать нечего.

Если во фрагменте есть и встреча до занятия, и продажа после — оценивай только часть про продажу. Если сомневаешься в применимости — выбирай applicable = false. Ложная оценка вреднее пропуска.

## ЭТАЛОН: КАК ДОЛЖНА ВЫГЛЯДЕТЬ ПРОДАЖА ПОСЛЕ ЗАНЯТИЯ

Главный принцип студии: **мы не продаём абонемент, мы помогаем человеку сделать то, что она давно хотела**. Забота вместо давления. Клиентка покупает не абонемент, а ощущение, которое испытала на пробном занятии; задача администратора — помочь ей не потерять этот момент.

Контекст: до занятия администратор уже выяснил цель клиентки (гибкость, спина, напряжение, форма) и проводил её к тренеру. Этот разговор обычно происходил часом раньше и в данный фрагмент записи не попадает.

1. **Первый контакт после занятия.** Встретить с улыбкой, дать воды, не торопить. Спросить о самочувствии, что понравилось на занятии.
2. **Рекомендация тренера.** Спросить, что рекомендовала тренер, и опереться на её рекомендацию — это сильнее слов администратора: «[ИМЯ ТРЕНЕРА] посоветовала…». Если рекомендаций не было — вернуться к цели, названной до занятия: «Вы говорили, что хотите…».
3. **Ощущения.** Дать клиентке рассказать об ощущениях («Тело уже чувствуется?»), отреагировать по-человечески, связать ощущения с её целью: «Чувствуете, что это то, что вам нужно?». Уместно живое подкрепление: «Многие начинают именно с этого направления — обычно через месяц уже чувствуют разницу».
4. **Частота и расписание.** «Как часто вы могли бы приходить — 2 раза в неделю или больше?» и вместе посмотреть расписание.
5. **Ценность до цены.** Упомянуть, что специальная цена действует в день пробного. Цифры называть только после того, как объяснено, что в них входит. Варианты:
   - 50 занятий / 12 месяцев / 940 ₾ / 19 ₾ за занятие / выгода 405 ₾ / персональная тренировка в подарок / продление −35%;
   - 36 занятий / 6 месяцев / 720 ₾ / 20 ₾ за занятие / выгода 240 ₾ / персональная тренировка в подарок / продление −30%;
   - 24 занятия / 4 месяца / 510 ₾ / 21 ₾ за занятие / выгода 130 ₾ / продление −25%;
   - 16 занятий / 3 месяца / 385 ₾ / 24 ₾ — только как последний вариант, если не подошли три основных;
   - разовое занятие 40 ₾ — только как точка сравнения при объяснении цены, предлагать его нельзя.
6. **Каскад закрытия.** Начать с пары 36 против 24 альтернативным вопросом: «Какой из двух вам ближе?». При интересе к максимальной выгоде показать 50. При запросе минимума — 24 против 16. **После вопроса о выборе замолчать — первой говорит клиентка.**
7. **Оплата частями** (без банков и процентов, часть сегодня — остаток позже) — предлагать проактивно, но только при сигнале: клиентка упомянула бюджет, взяла паузу после цены, спросила про сумму. Без сигнала предлагать не нужно.
8. **Если не покупает — оставить конкретный следующий шаг:** депозит с фиксацией цены (входит в стоимость, возврат при отказе), добавление в WhatsApp с выбором «в среду или в четверг», договорённость о звонке на следующий день. Уход без покупки — это не отказ, а незакрытый вопрос.

**Алгоритм любого возражения:** дать договорить → принять («Да, понимаю») → уточнить и найти настоящую причину → ответить по существу → предложить конкретный следующий шаг.

**Типовые возражения и эталонная реакция:**
- «Дорого» → уточнить, целиком или в месяц; посчитать цену занятия в абонементе против разового; предложить оплату частями; при желании более дешёвого — объяснить разницу и только потом показать другой абонемент.
- «Я подумаю» → спросить, что именно мешает решить сейчас, пока действует скидка; докопаться до настоящей причины (деньги, сомнения, нужно посоветоваться); предложить депозит с фиксацией цены и возвратом.
- «Не уверена, что буду ходить» → выяснить, что мешает; напомнить про занятия с 9 до 21, перезапись через приложение, отсутствие привязки к группе; предложить прямо сейчас выбрать 2 дня в расписании.
- «Хочу сходить в другую студию» → спросить, что для неё главное при выборе; ответить по её критериям без сравнений с конкурентами; предложить депозит на 5 дней.
- «Начну со следующего месяца» → выяснить причину; предложить зафиксировать цену депозитом, а срок абонемента начать с первого прихода.
- «Нужно посоветоваться с мужем» → согласиться, спросить, понравилось ли ей самой; предложить депозит с возвратом, чтобы цена не сгорела.
- «Нет времени» → спросить, сколько времени реально может выделить; показать, что занятие 50 минут и двух раз в неделю достаточно; предложить найти два конкретных окна.

**Шпаргалка на настоящее возражение:** «Это единственное, что останавливает, или есть ещё что-то?», «А если бы [возражение] не было — вы бы начали?».

**Грубые нарушения:** называть цену, не связав её с ценностью; давать скидку, не объяснив ценность; перебивать; сравнивать себя с конкурентами; закончить встречу без конкретного следующего шага; давить.

## КАК СТАВИТЬ ОЦЕНКУ

Считай баллы по чек-листу (в сумме 10), затем применяй ограничители.

| Что оцениваешь | Балл |
|---|---|
| Разговор об ощущениях после занятия и связка «ощущения → её цель» | 1,5 |
| Опора на рекомендацию тренера (спросил и использовал) | 0,5 |
| Презентация абонементов от ценности к цене, корректные условия, уместный каскад | 2,0 |
| Закрытие альтернативным вопросом и пауза после него | 1,5 |
| Оплата частями при наличии сигнала (или обоснованно не предложена при его отсутствии) | 1,0 |
| Работа с прозвучавшими возражениями по алгоритму | 2,5 |
| Конкретный следующий шаг: покупка, депозит, дата звонка, мессенджер, запись в расписание | 1,0 |

**Ограничители (перекрывают сумму):**
- не показал ни одного варианта абонемента → не выше 4;
- прозвучало возражение, и оно никак не отработано → не выше 5;
- разговор закончился ничем: ни покупки, ни депозита, ни договорённости о контакте → не выше 6;
- назвал цену, не поговорив об ощущениях и не связав предложение с целью клиентки → не выше 6;
- давление, спор, перебивание, обесценивание клиентки → не выше 5.

**Калибровка:**
- **10** — эталон: ощущения связаны с целью, тренер процитирована, ценность до цены, каскад, альтернативный вопрос с паузой, возражения отработаны по алгоритму, есть конкретный результат.
- **8–9** — сделано почти всё, шероховатости не повлияли на исход.
- **6–7** — база есть (варианты показаны, что-то отработано), но пропущены сильные приёмы: не вернулся к цели, не выдержал паузу, не предложил оплату частями при явном сигнале.
- **4–5** — продажа фрагментарна: цену назвал, но ценность не раскрыл, возражения оставил без ответа, следующий шаг не назначен.
- **2–3** — попытка продажи формальна: перечислил цифры и отпустил.
- **1** — грубые нарушения или откровенное давление.

Не завышай оценку за факт покупки: клиентка могла купить вопреки слабой работе. Не занижай за отказ: администратор мог отработать безупречно. Оценивай действия администратора, а не исход. Длинные реплики сами по себе не повышают оценку — важна структура, а не многословие.

## КАК ПИСАТЬ ОБРАТНУЮ СВЯЗЬ

Обратная связь пойдёт на личный разбор с администратором, поэтому она должна быть конкретной и разбираемой.

**Каждый пункт в `good` и `bad` начинай с таймкода** в формате `[ЧЧ:ММ:СС]`, взятого из транскрипта, — по нему запись можно переслушать.

- `good` — что сработало: `[ЧЧ:ММ:СС] Этап — что сделал администратор — «дословная цитата»`.
- `bad` — что упущено или сделано плохо: `[ЧЧ:ММ:СС] Этап — что произошло — «цитата» → надо было: конкретная фраза или действие`. Если этап просто пропущен, цитаты не будет — тогда укажи таймкод момента, где он должен был прозвучать.
- Пиши о действиях, а не о личности: «не выдержал паузу после вопроса о выборе», а не «неуверенный администратор».
- 2–5 пунктов в каждом списке. Не дроби мелочи, выбирай то, что реально повлияло.
- `comment` — 1–2 предложения: чем закончился разговор (купила / внесла депозит / ушла думать с договорённостью / ушла без договорённости) и главное, что стоит изменить в следующий раз.

## ОГРАНИЧЕНИЯ

- Запись сделана одним микрофоном на ресепшене: клиентку часто слышно хуже, распознавание ошибается, часть слов может быть искажена. Оценивай смысл, а не точность формулировок, и не снижай балл за дефекты записи.
- Разговор может идти на русском, грузинском или английском, в том числе со смешением языков в одной фразе. Обратную связь пиши по-русски.
- Оценивай только то, что слышно в этом фрагменте. Разговор до занятия сюда обычно не попадает — не делай выводов о том, выяснил ли администратор цель, если этого не слышно.
- Продаж первого абонемента за день немного — по числу пробных занятий. Нормально, если метрика сработает всего несколько раз за смену; остальные разговоры на ресепшене к ней отношения не имеют.
- Опирайся только на транскрипт. Не додумывай, что «наверное, было сказано». Если для вывода нет цитаты — не делай вывод.$aa$, 10, true, 2);
  end if;
end
$seed$;
