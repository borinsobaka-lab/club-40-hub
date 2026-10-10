-- ============================================================================
-- «Скрипты LS» — скрипты администраторов студий Lady Stretch (перенос из
-- «Аудиоаналитики», решение владельца 2026-10-10).
--
-- Что администратор пишет клиенту в чат и говорит по телефону: разделы
-- (рейка админки → «Скрипты LS», меню раздела — список разделов), в разделе —
-- текстовые скрипты на трёх языках (RU/EN/GE) с вариантами по студиям, или
-- один сценарий звонка с ветвлениями. Раздел общий для студий — без studio_id.
--
-- Доступ — разделы рейки в «Доступах» (admin_permissions, has_admin_section):
--   'scripts'      — читать, копировать, предлагать правки, вести звонки;
--   'scripts-edit' — правка скриптов, разделов, сценариев и настроек.
-- Нет строки прав — открыто всё (как у остальных разделов рейки), владельцу —
-- всё. Граница — RLS ниже, интерфейс только прячет кнопки.
--
-- Таблицы:
--   scripts_sections    — разделы; kind = 'text' | 'call', у звонка flow
--                         (сценарий целиком одним JSONB);
--   scripts_items       — скрипты: варианты по студиям → сообщения → языки
--                         (variants JSONB — читают и сохраняют целиком);
--   scripts_changes     — хронология: каждое создание, правка, удаление
--                         скрипта и правка сценария; пишут только триггеры;
--   scripts_suggestions — «Предложить изменения» от сотрудников;
--   scripts_seen        — когда сотрудник последний раз смотрел предложения
--                         (счётчик новых у каждого свой);
--   scripts_copies      — каждое нажатие «Копировать» (статистика);
--   scripts_call_runs   — проход сценария звонка по шагам (статистика);
--   scripts_settings    — синглтон: названия студий и имена администраторов
--                         на трёх языках, свои переменные ({цена} и т. п.).
--
-- Кто и когда правил (updated_by, author, user_name) ставят триггеры по
-- профилю вошедшего — из браузера подпись не подделать.
--
-- Стартовый набор — документ «Скрипты LS Tbilisi» (9 разделов, 44 скрипта) и
-- сценарий «Звонок: запись на пробное», как в «Аудиоаналитике»
-- (backend/app/playbook_default.json, playbook_call_default.json); грузится,
-- только если разделов ещё нет. Актуальную версию из «Аудиоаналитики»
-- переносит импорт в «Настройках скриптов» (scripts_import).
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

-- 1) Права ----------------------------------------------------------------------
create or replace function public.scripts_can_read(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_admin_section(_user_id, 'scripts')
$$;

create or replace function public.scripts_can_edit(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_admin_section(_user_id, 'scripts')
     and public.has_admin_section(_user_id, 'scripts-edit')
$$;

-- Подпись того, кто вошёл: ФИО из профиля, иначе почта.
create or replace function public.scripts_author_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''))
       from public.profiles p where p.id = auth.uid()),
    'сотрудник'
  )
$$;

revoke all on function public.scripts_can_read(uuid) from public, anon;
revoke all on function public.scripts_can_edit(uuid) from public, anon;
revoke all on function public.scripts_author_name() from public, anon;
grant execute on function public.scripts_can_read(uuid) to authenticated, service_role;
grant execute on function public.scripts_can_edit(uuid) to authenticated, service_role;
grant execute on function public.scripts_author_name() to authenticated, service_role;

-- Хронологию не пишем при импорте и стартовой загрузке (флаг транзакции).
create or replace function public.scripts_journal_off()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('scripts.skip_journal', true), '') = 'on'
$$;

-- 2) Таблицы ----------------------------------------------------------------------
create table if not exists public.scripts_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 255),
  -- Ключ иконки в меню (calendar-add, wallet-money…); пусто — по умолчанию.
  icon text not null default '' check (icon ~ '^[a-z0-9-]{0,40}$'),
  position integer not null default 0,
  kind text not null default 'text' check (kind in ('text', 'call')),
  -- Только у звонка: {start, nodes: [{id, title, group, text, hint, client, answers}]}.
  flow jsonb,
  flow_updated_at timestamptz,
  flow_updated_by text not null default '',
  flow_change_note text not null default '',
  created_at timestamptz not null default now(),
  constraint scripts_sections_flow_kind check (
    (kind = 'call') = (flow is not null)
    and (flow is null or jsonb_typeof(flow -> 'nodes') = 'array')
  )
);
create index if not exists scripts_sections_position_idx on public.scripts_sections (position);

create table if not exists public.scripts_items (
  id uuid primary key default gen_random_uuid(),
  -- Раздел со скриптами не удаляется (триггер ниже говорит почему).
  section_id uuid not null references public.scripts_sections (id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 255),
  kind text not null default 'chat' check (kind in ('chat', 'call', 'task', 'info')),
  keywords text not null default '',
  note text not null default '',
  follow_up text not null default '',
  -- [{label, messages: [{label, ru, en, ka}]}]; label варианта — студия.
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array'),
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  -- Что изменили при последней правке — внизу карточки.
  change_note text not null default ''
);
create index if not exists scripts_items_section_idx on public.scripts_items (section_id, position);

create table if not exists public.scripts_changes (
  id uuid primary key default gen_random_uuid(),
  -- Скрипт или раздел-звонок; удалённый остаётся в журнале.
  item_id uuid,
  item_title text not null default '',
  action text not null check (action in ('created', 'updated', 'deleted')),
  before jsonb,
  after jsonb,
  change_note text not null default '',
  author text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists scripts_changes_time_idx on public.scripts_changes (created_at desc, id desc);

create table if not exists public.scripts_suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default '',
  -- Скрипт, к которому предложение; название — на момент отправки.
  item_id uuid,
  item_title text not null default '',
  text text not null check (length(btrim(text)) between 3 and 3000),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text not null default ''
);
create index if not exists scripts_suggestions_time_idx on public.scripts_suggestions (created_at desc, id desc);

create table if not exists public.scripts_seen (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  suggestions_seen_at timestamptz not null default now()
);

create table if not exists public.scripts_copies (
  id uuid primary key default gen_random_uuid(),
  item_id uuid,
  item_title text not null default '',
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_name text not null default '',
  lang text not null check (lang in ('ru', 'en', 'ka')),
  -- Вариант какой студии скопировали.
  studio text not null default '' check (length(studio) <= 120),
  source text not null default 'card' check (source in ('card')),
  created_at timestamptz not null default now()
);
create index if not exists scripts_copies_time_idx on public.scripts_copies (created_at);
create index if not exists scripts_copies_user_time_idx on public.scripts_copies (user_id, created_at);

create table if not exists public.scripts_call_runs (
  -- id задаёт админка: путь шлётся после каждого шага под одним id.
  id uuid primary key,
  -- Без внешнего ключа: удалили раздел — статистика остаётся под названием.
  section_id uuid not null,
  section_title text not null default '',
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_name text not null default '',
  studio text not null default '',
  lang text not null default 'ru',
  -- Версия сценария (время его правки) на момент звонка.
  flow_version timestamptz,
  -- [{id, title, group, answer, at}] — пройденные блоки по порядку.
  path jsonb not null default '[]'::jsonb check (jsonb_typeof(path) = 'array'),
  steps integer not null default 0,
  last_node_id text not null default '',
  last_node_title text not null default '',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Дошли до конца сценария или нажали «Новый звонок».
  ended_at timestamptz
);
create index if not exists scripts_call_runs_time_idx on public.scripts_call_runs (started_at);
create index if not exists scripts_call_runs_section_time_idx on public.scripts_call_runs (section_id, started_at);
create index if not exists scripts_call_runs_user_time_idx on public.scripts_call_runs (user_id, started_at);

create table if not exists public.scripts_settings (
  id boolean primary key default true check (id),
  -- {studios: [{name, ru, en, ka}], admins: {user_id: {ru, en, ka}}, variables: [...]}
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz,
  updated_by text not null default ''
);

-- 3) Триггеры -----------------------------------------------------------------------
-- Версия скрипта для хронологии — всё, что видно в карточке.
create or replace function public.scripts_item_snapshot(_item public.scripts_items)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'title', _item.title,
    'kind', _item.kind,
    'section', coalesce((select s.title from public.scripts_sections s where s.id = _item.section_id), ''),
    'keywords', _item.keywords,
    'note', _item.note,
    'follow_up', _item.follow_up,
    'variants', _item.variants
  )
$$;

create or replace function public.scripts_items_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _kind text;
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'position') = (to_jsonb(old) - 'position') then
    return new; -- перестановка: ни подписи, ни журнала
  end if;

  select kind into _kind from public.scripts_sections where id = new.section_id;
  if _kind = 'call' then
    raise exception 'В разделе-звонке один сценарий — текстовые скрипты сюда не добавляются';
  end if;

  if public.scripts_journal_off() then
    return new;
  end if;

  if tg_op = 'INSERT' or new.section_id is distinct from old.section_id then
    -- Новый и перенесённый скрипт встаёт в конец раздела: там его и ищут.
    new.position := coalesce(
      (select max(position) + 1 from public.scripts_items
        where section_id = new.section_id and id <> new.id), 0);
  end if;

  new.title := btrim(new.title);
  new.updated_at := now();
  new.updated_by := public.scripts_author_name();
  if tg_op = 'INSERT' then
    new.change_note := coalesce(nullif(btrim(new.change_note), ''), 'Новый скрипт');
  elsif btrim(new.change_note) = '' then
    -- Скрипт меняется у всех сразу: без пары слов человек у стойки не
    -- поймёт, ошибка это или так задумано.
    raise exception 'Опишите, что изменили — это увидят все на карточке скрипта';
  end if;
  return new;
end;
$$;

create or replace function public.scripts_items_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.scripts_journal_off() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.scripts_changes (item_id, item_title, action, before, after, change_note, author)
    values (new.id, new.title, 'created', null, public.scripts_item_snapshot(new),
            new.change_note, public.scripts_author_name());
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'position') = (to_jsonb(old) - 'position') then
      return null;
    end if;
    insert into public.scripts_changes (item_id, item_title, action, before, after, change_note, author)
    values (new.id, new.title, 'updated', public.scripts_item_snapshot(old),
            public.scripts_item_snapshot(new), new.change_note, public.scripts_author_name());
  else
    insert into public.scripts_changes (item_id, item_title, action, before, after, change_note, author)
    values (old.id, old.title, 'deleted', public.scripts_item_snapshot(old), null,
            'Скрипт удалён', public.scripts_author_name());
  end if;
  return null;
end;
$$;

drop trigger if exists scripts_items_before on public.scripts_items;
create trigger scripts_items_before
  before insert or update on public.scripts_items
  for each row execute function public.scripts_items_before();

drop trigger if exists scripts_items_after on public.scripts_items;
create trigger scripts_items_after
  after insert or update or delete on public.scripts_items
  for each row execute function public.scripts_items_after();

create or replace function public.scripts_sections_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.scripts_items where section_id = old.id) then
      raise exception 'В разделе есть скрипты — сначала перенесите их в другой раздел или удалите';
    end if;
    return old;
  end if;

  new.title := btrim(new.title);
  if public.scripts_journal_off() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.position := coalesce((select max(position) + 1 from public.scripts_sections), 0);
    if new.kind = 'call' then
      new.flow_updated_at := now();
      new.flow_updated_by := public.scripts_author_name();
      new.flow_change_note := coalesce(nullif(btrim(new.flow_change_note), ''), 'Новый сценарий звонка');
    end if;
    return new;
  end if;

  if new.kind <> old.kind then
    raise exception 'Тип раздела не меняется: создайте новый раздел';
  end if;
  if new.flow is distinct from old.flow then
    if btrim(new.flow_change_note) = '' then
      raise exception 'Опишите, что изменили в сценарии — это увидят в хронологии';
    end if;
    new.flow_updated_at := now();
    new.flow_updated_by := public.scripts_author_name();
  end if;
  return new;
end;
$$;

create or replace function public.scripts_sections_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.scripts_journal_off() or new.flow is not distinct from old.flow then
    return null;
  end if;
  insert into public.scripts_changes (item_id, item_title, action, before, after, change_note, author)
  values (
    new.id, new.title, 'updated',
    jsonb_build_object('title', old.title, 'kind', 'call', 'section', old.title, 'flow', old.flow),
    jsonb_build_object('title', new.title, 'kind', 'call', 'section', new.title, 'flow', new.flow),
    new.flow_change_note, public.scripts_author_name()
  );
  return null;
end;
$$;

drop trigger if exists scripts_sections_before on public.scripts_sections;
create trigger scripts_sections_before
  before insert or update or delete on public.scripts_sections
  for each row execute function public.scripts_sections_before();

drop trigger if exists scripts_sections_after on public.scripts_sections;
create trigger scripts_sections_after
  after update on public.scripts_sections
  for each row execute function public.scripts_sections_after();

-- Подписи и названия в предложениях, копированиях, настройках — с сервера.
create or replace function public.scripts_suggestions_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.author_name := public.scripts_author_name();
    new.text := btrim(new.text);
    new.status := 'open';
    new.created_at := now();
    new.item_title := coalesce(
      (select title from public.scripts_items where id = new.item_id), new.item_title, '');
    return new;
  end if;
  -- Правится только отметка «Сделано».
  new.author_id := old.author_id;
  new.author_name := old.author_name;
  new.item_id := old.item_id;
  new.item_title := old.item_title;
  new.text := old.text;
  new.created_at := old.created_at;
  if new.status is distinct from old.status then
    new.resolved_at := case when new.status = 'done' then now() end;
    new.resolved_by := case when new.status = 'done' then public.scripts_author_name() else '' end;
  else
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  end if;
  return new;
end;
$$;

drop trigger if exists scripts_suggestions_before on public.scripts_suggestions;
create trigger scripts_suggestions_before
  before insert or update on public.scripts_suggestions
  for each row execute function public.scripts_suggestions_before();

create or replace function public.scripts_copies_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.user_name := public.scripts_author_name();
  new.created_at := now();
  new.item_title := coalesce(
    (select title from public.scripts_items where id = new.item_id), new.item_title, '');
  return new;
end;
$$;

drop trigger if exists scripts_copies_before on public.scripts_copies;
create trigger scripts_copies_before
  before insert on public.scripts_copies
  for each row execute function public.scripts_copies_before();

create or replace function public.scripts_settings_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.scripts_journal_off() then
    new.updated_at := now();
    new.updated_by := public.scripts_author_name();
  end if;
  return new;
end;
$$;

drop trigger if exists scripts_settings_before on public.scripts_settings;
create trigger scripts_settings_before
  before insert or update on public.scripts_settings
  for each row execute function public.scripts_settings_before();

-- 4) RLS --------------------------------------------------------------------------
revoke all on public.scripts_sections, public.scripts_items, public.scripts_changes,
  public.scripts_suggestions, public.scripts_seen, public.scripts_copies,
  public.scripts_call_runs, public.scripts_settings from anon, authenticated;

grant select, insert, update, delete on public.scripts_sections, public.scripts_items to authenticated;
grant select on public.scripts_changes to authenticated;
grant select, insert, update on public.scripts_suggestions, public.scripts_seen to authenticated;
grant select, insert on public.scripts_copies to authenticated;
grant select, insert, update on public.scripts_call_runs to authenticated;
grant select, insert, update on public.scripts_settings to authenticated;
grant all on public.scripts_sections, public.scripts_items, public.scripts_changes,
  public.scripts_suggestions, public.scripts_seen, public.scripts_copies,
  public.scripts_call_runs, public.scripts_settings to service_role;

alter table public.scripts_sections enable row level security;
alter table public.scripts_items enable row level security;
alter table public.scripts_changes enable row level security;
alter table public.scripts_suggestions enable row level security;
alter table public.scripts_seen enable row level security;
alter table public.scripts_copies enable row level security;
alter table public.scripts_call_runs enable row level security;
alter table public.scripts_settings enable row level security;

do $$
declare
  t text;
begin
  -- Читают все с разделом, правят — с правкой.
  foreach t in array array['scripts_sections', 'scripts_items', 'scripts_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || ' read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.scripts_can_read(auth.uid()))',
      t || ' read', t);
    execute format('drop policy if exists %I on public.%I', t || ' edit', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.scripts_can_edit(auth.uid())) with check (public.scripts_can_edit(auth.uid()))',
      t || ' edit', t);
  end loop;
end;
$$;

-- Хронологию видят все: «почему текст стал другим» — вопрос и того, кто читает.
drop policy if exists "scripts_changes read" on public.scripts_changes;
create policy "scripts_changes read" on public.scripts_changes
  for select to authenticated using (public.scripts_can_read(auth.uid()));

-- Предложить может любой, кто видит скрипты; отмечает сделанным — правка.
drop policy if exists "scripts_suggestions read" on public.scripts_suggestions;
create policy "scripts_suggestions read" on public.scripts_suggestions
  for select to authenticated using (public.scripts_can_read(auth.uid()));
drop policy if exists "scripts_suggestions insert" on public.scripts_suggestions;
create policy "scripts_suggestions insert" on public.scripts_suggestions
  for insert to authenticated with check (public.scripts_can_read(auth.uid()));
drop policy if exists "scripts_suggestions resolve" on public.scripts_suggestions;
create policy "scripts_suggestions resolve" on public.scripts_suggestions
  for update to authenticated
  using (public.scripts_can_edit(auth.uid())) with check (public.scripts_can_edit(auth.uid()));

drop policy if exists "scripts_seen own" on public.scripts_seen;
create policy "scripts_seen own" on public.scripts_seen
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.scripts_can_read(auth.uid()));

-- Статистику копирований видят все с разделом.
drop policy if exists "scripts_copies read" on public.scripts_copies;
create policy "scripts_copies read" on public.scripts_copies
  for select to authenticated using (public.scripts_can_read(auth.uid()));
drop policy if exists "scripts_copies insert" on public.scripts_copies;
create policy "scripts_copies insert" on public.scripts_copies
  for insert to authenticated with check (public.scripts_can_read(auth.uid()));

-- Звонки: свои — все, чужие — с правкой (она же видит статистику всех).
drop policy if exists "scripts_call_runs read" on public.scripts_call_runs;
create policy "scripts_call_runs read" on public.scripts_call_runs
  for select to authenticated
  using (user_id = auth.uid() or public.scripts_can_edit(auth.uid()));
drop policy if exists "scripts_call_runs insert" on public.scripts_call_runs;
create policy "scripts_call_runs insert" on public.scripts_call_runs
  for insert to authenticated
  with check (user_id = auth.uid() and public.scripts_can_read(auth.uid()));
drop policy if exists "scripts_call_runs update own" on public.scripts_call_runs;
create policy "scripts_call_runs update own" on public.scripts_call_runs
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5) RPC -------------------------------------------------------------------------
-- Порядок разделов или скриптов раздела — целиком и атомарно. Расхождение
-- значит, что список поменяли в соседней вкладке: вслепую не переставляем.
create or replace function public.scripts_reorder(_section_id uuid, _ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.scripts_can_edit(auth.uid()) then
    raise exception 'Нет права правки скриптов';
  end if;
  if _section_id is null then
    if (select count(*) from public.scripts_sections) <> cardinality(_ids)
       or exists (select 1 from public.scripts_sections where id <> all (_ids)) then
      raise exception 'Список разделов изменился — обновите страницу';
    end if;
    update public.scripts_sections s set position = t.ord - 1
      from unnest(_ids) with ordinality as t(id, ord)
     where s.id = t.id and s.position <> t.ord - 1;
  else
    if (select count(*) from public.scripts_items where section_id = _section_id) <> cardinality(_ids)
       or exists (select 1 from public.scripts_items
                   where section_id = _section_id and id <> all (_ids)) then
      raise exception 'Список скриптов изменился — обновите страницу';
    end if;
    update public.scripts_items i set position = t.ord - 1
      from unnest(_ids) with ordinality as t(id, ord)
     where i.id = t.id and i.position <> t.ord - 1;
  end if;
end;
$$;

-- Путь звонка целиком, после каждого шага. Повторная отправка того же id —
-- обновление (шаг назад убирает шаг и в статистике); чужой звонок не
-- перезаписать даже по id.
create or replace function public.scripts_save_call_run(
  _id uuid,
  _section_id uuid,
  _path jsonb,
  _finished boolean,
  _studio text default '',
  _lang text default 'ru'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  _title text;
  _version timestamptz;
  _last jsonb;
  _now timestamptz := now();
begin
  if jsonb_typeof(_path) <> 'array' or jsonb_array_length(_path) not between 1 and 300 then
    raise exception 'Путь звонка: от 1 до 300 шагов';
  end if;
  _last := _path -> -1;
  select title, flow_updated_at into _title, _version
    from public.scripts_sections where id = _section_id;
  insert into public.scripts_call_runs as r (
    id, section_id, section_title, user_id, user_name, studio, lang, flow_version,
    path, steps, last_node_id, last_node_title, started_at, updated_at, ended_at
  ) values (
    _id, _section_id, coalesce(_title, ''), auth.uid(), public.scripts_author_name(),
    left(coalesce(_studio, ''), 120), case when _lang in ('ru', 'en', 'ka') then _lang else 'ru' end,
    _version, _path, jsonb_array_length(_path), left(coalesce(_last ->> 'id', ''), 40),
    left(coalesce(_last ->> 'title', ''), 120), _now, _now, case when _finished then _now end
  )
  on conflict (id) do update set
    section_title = coalesce(_title, r.section_title),
    user_name = excluded.user_name,
    path = excluded.path,
    steps = excluded.steps,
    last_node_id = excluded.last_node_id,
    last_node_title = excluded.last_node_title,
    updated_at = _now,
    ended_at = case when _finished then coalesce(r.ended_at, _now) end
  where r.user_id = auth.uid();
end;
$$;

-- Статистика копирований за период: итог по языкам, рейтинг скриптов (у
-- всех или у одного сотрудника) и список сотрудников (без фильтра по
-- сотруднику — из него выбирают). Названия — текущие; удалённый скрипт —
-- под последним названием.
create or replace function public.scripts_copy_stats(
  _from timestamptz default null,
  _to timestamptz default null,
  _user uuid default null,
  _lang text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select * from public.scripts_copies
     where (_from is null or created_at >= _from)
       and (_to is null or created_at < _to)
       and (_lang is null or lang = _lang)
  ),
  mine as (
    select * from base where _user is null or user_id = _user
  ),
  items as (
    select m.item_id,
           coalesce(max(i.title), max(m.item_title)) as title,
           coalesce(max(s.title), '') as section,
           bool_and(i.id is null) as deleted,
           count(*) as total,
           count(*) filter (where m.lang = 'ru') as ru,
           count(*) filter (where m.lang = 'en') as en,
           count(*) filter (where m.lang = 'ka') as ka
      from mine m
      left join public.scripts_items i on i.id = m.item_id
      left join public.scripts_sections s on s.id = i.section_id
     group by m.item_id
  ),
  users as (
    select user_id, max(user_name) as name,
           count(*) as total,
           count(*) filter (where lang = 'ru') as ru,
           count(*) filter (where lang = 'en') as en,
           count(*) filter (where lang = 'ka') as ka
      from base
     group by user_id
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'total', count(*),
        'ru', count(*) filter (where lang = 'ru'),
        'en', count(*) filter (where lang = 'en'),
        'ka', count(*) filter (where lang = 'ka'))
        from mine),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', item_id, 'title', title, 'section', section, 'deleted', deleted,
        'total', total, 'ru', ru, 'en', en, 'ka', ka) order by total desc, title)
        from items), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'name', name, 'total', total, 'ru', ru, 'en', en, 'ka', ka)
        order by total desc, name)
        from users), '[]'::jsonb)
  )
$$;

-- Статистика звонков за период: сценарии (живые и удалённые, по которым
-- звонили), выбранный (по умолчанию — где больше всего звонков), кто звонил,
-- и по завершённым звонкам выбранного: сколько, сколько шагов в среднем, до
-- каких блоков доходили, на каких заканчивали. Идущие сейчас (не закончены и
-- трогали меньше получаса назад) не считаются. Воронку по этапам сценария
-- складывает админка (lib/scripts/call-stats.ts). Без правки RLS отдаёт
-- только свои звонки.
create or replace function public.scripts_call_stats(
  _section uuid default null,
  _from timestamptz default null,
  _to timestamptz default null,
  _user uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  _sections jsonb;
  _chosen uuid;
  _out jsonb;
begin
  with per as (
    select section_id, max(section_title) as title, count(*) as runs
      from public.scripts_call_runs
     where (_from is null or started_at >= _from) and (_to is null or started_at < _to)
     group by section_id
  ),
  secs as (
    select s.id, s.title, coalesce(p.runs, 0) as runs, false as deleted, s.position as ord
      from public.scripts_sections s
      left join per p on p.section_id = s.id
     where s.kind = 'call'
    union all
    select p.section_id, coalesce(nullif(p.title, ''), 'Удалённый звонок'), p.runs, true, 2147483647
      from per p
     where not exists (select 1 from public.scripts_sections s where s.id = p.section_id and s.kind = 'call')
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'runs', runs, 'deleted', deleted)
                            order by ord, title), '[]'::jsonb)
    into _sections from secs;

  if jsonb_array_length(_sections) = 0 then
    return jsonb_build_object('sections', _sections, 'section_id', null);
  end if;

  select (e ->> 'id')::uuid into _chosen
    from jsonb_array_elements(_sections) e
   where _section is not null and (e ->> 'id')::uuid = _section;
  if _chosen is null then
    select (e ->> 'id')::uuid into _chosen
      from jsonb_array_elements(_sections) with ordinality as t(e, ord)
     order by (e ->> 'runs')::int desc, (e ->> 'deleted')::boolean, ord
     limit 1;
  end if;

  with in_section as (
    select * from public.scripts_call_runs
     where section_id = _chosen
       and (_from is null or started_at >= _from) and (_to is null or started_at < _to)
  ),
  runs as (
    select * from in_section where _user is null or user_id = _user
  ),
  done as (
    select * from runs
     where jsonb_array_length(path) > 0
       and (ended_at is not null or updated_at < now() - interval '30 minutes')
  ),
  steps as (
    select r.id as run_id, r.started_at, t.ord, t.e ->> 'id' as node_id,
           coalesce(t.e ->> 'title', '') as title, coalesce(t.e ->> 'group', 'main') as grp
      from runs r, jsonb_array_elements(r.path) with ordinality as t(e, ord)
  ),
  first_seen as (
    select distinct on (node_id) node_id, title, grp, started_at, ord
      from steps
     order by node_id, started_at, ord
  )
  select jsonb_build_object(
    'sections', _sections,
    'section_id', _chosen,
    'users', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', user_id, 'name', name, 'runs', runs) order by runs desc, name)
        from (select user_id, max(user_name) as name, count(*) as runs from in_section group by user_id) u
    ), '[]'::jsonb),
    'runs', (select count(*) from done),
    'avg_steps', (select round(avg(jsonb_array_length(path)), 2) from done),
    'reached', coalesce((
      select jsonb_object_agg(node_id, n)
        from (select s.node_id, count(distinct s.run_id) as n
                from steps s join done d on d.id = s.run_id group by s.node_id) x
    ), '{}'::jsonb),
    'ended', coalesce((
      select jsonb_agg(jsonb_build_object('node_id', node_id, 'title', title, 'group', grp, 'count', n)
                       order by n desc, title)
        from (select path -> -1 ->> 'id' as node_id,
                     coalesce(max(path -> -1 ->> 'title'), '') as title,
                     coalesce(max(path -> -1 ->> 'group'), 'main') as grp,
                     count(*) as n
                from done group by 1) x
    ), '[]'::jsonb),
    'seen', coalesce((
      select jsonb_agg(jsonb_build_object('id', node_id, 'title', title, 'group', grp) order by started_at, ord)
        from first_seen
    ), '[]'::jsonb)
  ) into _out;
  return _out;
end;
$$;

-- Сотрудники с разделом «Скрипты LS» — для имён {админ} в настройках.
-- Профили других сотрудников RLS не отдаёт, поэтому через definer.
create or replace function public.scripts_staff()
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.full_name, ''), coalesce(p.email, '')
    from public.profiles p
   where public.scripts_can_read(auth.uid())
     and exists (select 1 from public.user_roles r
                  where r.user_id = p.id and r.role in ('owner', 'admin', 'trainer'))
     and public.scripts_can_read(p.id)
   order by p.full_name nulls last, p.email
$$;

-- Загрузка набора скриптов целиком (стартовый набор, импорт из
-- «Аудиоаналитики»): все разделы и скрипты заменяются. Формат — экспорт
-- «Аудиоаналитики»: {sections: [{title, icon, kind, items, flow, …}]}.
-- Подписи и даты правок переносятся как были; хронология не пишется.
create or replace function public.scripts_load(_data jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _s jsonb;
  _s_ord bigint;
  _i jsonb;
  _i_ord bigint;
  _section_id uuid;
  _kind text;
  _icon text;
  _count integer := 0;
begin
  if jsonb_typeof(_data -> 'sections') <> 'array' or jsonb_array_length(_data -> 'sections') = 0 then
    raise exception 'В файле нет разделов скриптов';
  end if;
  perform set_config('scripts.skip_journal', 'on', true);
  delete from public.scripts_items where true;
  delete from public.scripts_sections where true;

  for _s, _s_ord in select e, ord from jsonb_array_elements(_data -> 'sections') with ordinality as t(e, ord) loop
    _kind := case when _s ->> 'kind' = 'call' or jsonb_typeof(_s -> 'flow') = 'object' then 'call' else 'text' end;
    _icon := coalesce(_s ->> 'icon', '');
    if _icon !~ '^[a-z0-9-]{0,40}$' then
      _icon := '';
    end if;
    insert into public.scripts_sections (
      title, icon, position, kind, flow, flow_updated_at, flow_updated_by, flow_change_note
    ) values (
      left(coalesce(nullif(btrim(_s ->> 'title'), ''), 'Без названия'), 255), _icon, _s_ord - 1, _kind,
      case when _kind = 'call' then _s -> 'flow' end,
      case when _kind = 'call' then coalesce((_s ->> 'flow_updated_at')::timestamptz, now()) end,
      case when _kind = 'call' then coalesce(_s ->> 'flow_updated_by', '') else '' end,
      case when _kind = 'call' then coalesce(_s ->> 'flow_change_note', '') else '' end
    ) returning id into _section_id;

    if _kind = 'text' and jsonb_typeof(_s -> 'items') = 'array' then
      for _i, _i_ord in select e, ord from jsonb_array_elements(_s -> 'items') with ordinality as t(e, ord) loop
        insert into public.scripts_items (
          section_id, title, kind, keywords, note, follow_up, variants, position,
          updated_at, updated_by, change_note
        ) values (
          _section_id,
          left(coalesce(nullif(btrim(_i ->> 'title'), ''), 'Без названия'), 255),
          case when _i ->> 'kind' in ('chat', 'call', 'task', 'info') then _i ->> 'kind' else 'chat' end,
          coalesce(_i ->> 'keywords', ''),
          coalesce(_i ->> 'note', ''),
          coalesce(_i ->> 'follow_up', ''),
          case when jsonb_typeof(_i -> 'variants') = 'array' then _i -> 'variants' else '[]'::jsonb end,
          _i_ord - 1,
          coalesce((_i ->> 'updated_at')::timestamptz, now()),
          coalesce(_i ->> 'updated_by', ''),
          coalesce(_i ->> 'change_note', '')
        );
        _count := _count + 1;
      end loop;
    end if;
  end loop;

  perform set_config('scripts.skip_journal', 'off', true);
  return _count;
end;
$$;

revoke all on function public.scripts_load(jsonb) from public, anon, authenticated;

-- Импорт из «Аудиоаналитики» («Настройки скриптов» → «Импорт»): скрипты
-- заменяются целиком; из настроек — названия студий и свои переменные
-- (имена администраторов там — другие учётные записи, их не переносим).
create or replace function public.scripts_import(_data jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _count integer;
  _settings jsonb := _data -> 'settings';
  _patch jsonb := '{}'::jsonb;
begin
  if not public.scripts_can_edit(auth.uid()) then
    raise exception 'Нет права правки скриптов';
  end if;
  _count := public.scripts_load(_data);

  if jsonb_typeof(_settings -> 'variables') = 'array' then
    _patch := _patch || jsonb_build_object('variables', _settings -> 'variables');
  end if;
  if jsonb_typeof(_settings -> 'studios') = 'array' then
    _patch := _patch || jsonb_build_object('studios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(nullif(e ->> 'name', ''), e ->> 'location_name', e ->> 'ru', ''),
        'ru', coalesce(e ->> 'ru', ''), 'en', coalesce(e ->> 'en', ''), 'ka', coalesce(e ->> 'ka', '')))
        from jsonb_array_elements(_settings -> 'studios') e
       where coalesce((e ->> 'active')::boolean, true)
    ), '[]'::jsonb));
  end if;
  insert into public.scripts_settings (id, data) values (true, _patch)
  on conflict (id) do update set data = public.scripts_settings.data || excluded.data;

  -- Импорт — одной записью в хронологии: что было до него, видно по старым.
  insert into public.scripts_changes (item_id, item_title, action, before, after, change_note, author)
  values (null, 'Импорт из «Аудиоаналитики»', 'updated', null, null,
          format('Скрипты заменены: %s шт.', _count), public.scripts_author_name());
  return _count;
end;
$$;

revoke all on function public.scripts_reorder(uuid, uuid[]) from public, anon;
revoke all on function public.scripts_save_call_run(uuid, uuid, jsonb, boolean, text, text) from public, anon;
revoke all on function public.scripts_copy_stats(timestamptz, timestamptz, uuid, text) from public, anon;
revoke all on function public.scripts_call_stats(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.scripts_staff() from public, anon;
revoke all on function public.scripts_import(jsonb) from public, anon;
grant execute on function public.scripts_reorder(uuid, uuid[]) to authenticated;
grant execute on function public.scripts_save_call_run(uuid, uuid, jsonb, boolean, text, text) to authenticated;
grant execute on function public.scripts_copy_stats(timestamptz, timestamptz, uuid, text) to authenticated;
grant execute on function public.scripts_call_stats(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.scripts_staff() to authenticated;
grant execute on function public.scripts_import(jsonb) to authenticated;

-- 6) Стартовый набор ----------------------------------------------------------------
do $seed$
begin
  if exists (select 1 from public.scripts_sections) then
    raise notice 'Скрипты уже есть — стартовый набор не загружаю';
    return;
  end if;
  perform public.scripts_load($json${"sections": [{"title": "Запись на пробное", "icon": "calendar-add", "kind": "text", "items": [{"title": "Первое сообщение", "kind": "chat", "keywords": "привет приветствие пробное запись цель гибкость стресс фигура", "note": "Первое сообщение новому клиенту в чате. Когда клиент выбирает цель — отправить соответствующее сообщение ниже.", "follow_up": "После отправки: поставить задачу на отправку сообщения «Какие вопросы» на следующий день, если конец рабочего дня.", "variants": [{"label": "", "messages": [{"label": "", "ru": "Здравствуйте!\nМеня зовут {админ}, я менеджер Lady Stretch 🌸\n\nРада, что вы заинтересовались нашей студией! Первое занятие у нас пробное и подойдет для любого уровня подготовки.\n\nСкажите, какая цель вам ближе?\n1️⃣ Стать гибче\n2️⃣ Снять напряжение и стресс\n3️⃣ Подтянуть фигуру\n\nЯ посмотрю расписание и подберу удобное время на ближайшие дни 🌿", "en": "Hello!\nMy name is {админ}, I am the manager of Lady Stretch 🌸\n\nI am glad that you are interested in our studio! Our first lesson is a trial and is suitable for any level of training.\n\nTell me, which goal is closer to you?\n1️⃣ Become more flexible\n2️⃣ Relieve tension and stress\n3️⃣ Lose weight\n\nI will look at the schedule and choose a convenient time for the next few days 🌿", "ka": "გამარჯობა!\nმე {админ} მქვია, Lady Stretch-ის მენეჯერი ვარ 🌸\n\nმიხარია, რომ ჩვენი სტუდიით დაინტერესდით! ჩვენი პირველი გაკვეთილი საცდელია და ნებისმიერი დონის ვარჯიშისთვისაა შესაფერისი.\n\nრომელი მიზანია თქვენთან უფრო ახლოს?\n1️⃣ გახდეთ უფრო მოქნილი\n2️⃣ მოიხსნათ დაძაბულობა და სტრესი\n3️⃣ გაიმკვრივოთ ფიგურა\n\nმე გადავხედავ გრაფიკს და მომდევნო რამდენიმე დღისთვის მოსახერხებელ დროს შევარჩევ 🌿"}, {"label": "Если выбирают 1️⃣ Стать гибче", "ru": "отлично, тогда рекомендую вам начать с классической растяжки, здоровой спины или йоги  - направления, которые подходят для вашей цели. На этих тренировках вы можете расслабиться с пользой для здоровья, а после занятий заметите улучшение эластичности мышц и связок.", "en": "Great, then I recommend starting with classic stretching, healthy back or yoga - these are classes that suit your goal. In these sessions, you can relax while benefiting your health, and after training you will notice improved flexibility in your muscles and ligaments.", "ka": ""}, {"label": "Если выбирают 2️⃣ Снять напряжение и стресс", "ru": "отлично, тогда рекомендую вам начать с классической растяжки, здоровой спины или йоги  - направления, которые подходят для вашей цели. На этих тренировках вы можете расслабиться с пользой для здоровья, а после занятий заметите, что тело стало свободнее и легче.", "en": "Great, then I recommend starting with classic stretching, healthy back or yoga - these are classes that suit your goal. In these sessions, you can relax while benefiting your health, and after the workouts you will notice that your body feels freer and lighter.", "ka": ""}, {"label": "Если выбирают 3️⃣ Подтянуть фигуру", "ru": "отлично, тогда рекомендую вам начать с пилатеса и подкачки с растяжкой - это силовые направления, которые подходят для вашей цели. На этих тренировках вы будете работать с глубокими мышцами, а после занятий заметите, что тело подтянуто и в тонусе.", "en": "Great, then I recommend starting with Pilates and muscle pumping with stretching - these are classes that suit your goal. In these sessions, you will work your deep muscles, and after the workouts you will notice that your body feels more toned and firm.", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Предоплата за пробное", "kind": "chat", "keywords": "предоплата оплата реквизиты пробное 14 лари чек", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Запись на пробное занятие производится по предоплате. Это позволяет нам заранее забронировать для вас место в группе😊\n\nСтоимость пробного занятия 14 лари. Оплатить можно по реквизитам:\n\nGE10CD0360000043702858\nShirshikova Milana\n\nПосле оплаты, пожалуйста, отправьте нам чек и запись будет подтверждена✨", "en": "Enrollment for a trial session is by prepayment. This allows us to reserve a place for you in the group in advance😊\n\nThe cost of the trial class is 14 GEL. You can pay by payment details:\n\nGE10CD0360000043702858\nShirshikova Milana\n\nAfter payment, please send us a check and the registration will be confirmed✨", "ka": "საცდელ ვარჯიშზე ჩაწერა ხდება წინასწარი გადახდით. ეს გვაძლევს საშუალებას წინასწარ დაგიჯავშნოთ ადგილი ჯგუფში😊\n\nსაცდელი ვარჯიშის ღირებულებაა 14 ლარი. შეგიძლიათ გადაიხადოთ გადმორიცხვით მითითებულ ანგარიშზე:\n\nGE10CD0360000043702858\nShirshikova Milana\n\nგადახდის შემდეგ გთხოვთ გამოგვიგზავნოთ ქვითარი და რეგისტრაცია დადასტურდება✨"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Подтверждение пробного", "kind": "chat", "keywords": "подтверждение запись адрес как добраться код домофона опоздание", "note": "", "follow_up": "", "variants": [{"label": "Ваке", "messages": [{"label": "", "ru": "Записала Вас на [день] в [время]\n\nПрийти необходимо за 10 минут до начала занятия, чтобы успеть переодеться. С собой нужно взять одежду из тянущейся ткани и носочки. Обувь не нужна. Вода, коврики и все необходимое у нас есть 😊\n\nМы находимся напротив (на другой стороне дороги) Посольства Ирана. Вам нужно ориентироваться на желтый шлагбаум, пройти в арку за ним. Сразу справа на углу здания Вы увидите дверь и лестницу вниз\n\nПожалуйста, приходите вовремя 🙏 Если вы опоздаете более чем на 10 минут, запись будет отменена, так как пропуск разминки может привести к травмам\n\n📍Чавчавадзе 51-2\nLady Stretch https://maps.app.goo.gl/RmkuYmpaUQSz9xKdA", "en": "I signed you up for [day] at [time]\n\nIt is better to come 10 minutes before the start of the class in order to have time to change clothes. You need to take clothes made of stretch fabric and socks with you. Shoes are not needed. We have water, mats and everything you need 😊\n\nPlease arrive on time 🙏 If you are more than 10 minutes late, your appointment will be canceled, as missing the warm-up may lead to injuries.\n\nWe are located directly across the street from the Iranian Embassy. Look for the yellow barrier gate and walk through the archway behind it. Immediately on your right, at the corner of the building, you'll see a door and a staircase leading downstairs.\n\n📍Chavchavadze 51-2\nLady Stretch https://maps.app.goo.gl/RmkuYmpaUQSz9xKdA", "ka": "ჩაგწერეთ [დღე] [დრო]-ზე. 😊\n\nთქვენ უნდა მოხვიდეთ გაკვეთილის დაწყებამდე 10 წუთით ადრე, რომ დრო გქონდეთ ტანსაცმლის გამოსაცვლელად. ასევე უნდა წამოიღოთ  თქვენთვის კომფორტული ელასტიური ტანსაცმელი . ფეხსაცმელი არ არის საჭირო. გვაქვს წყალი, ხალიჩები და ყველაფერი რაც თქვენ ვარჯიშისთვის გჭირდებათ 😊\n\nგთხოვთ, დროულად მობრძანდეთ 🙏 თუ 10 წუთზე მეტით დაგაგვიანდებათ, თქვენი ჯავშანი გაუქმდება, რადგან გახურების გამოტოვებამ შეიძლება ტრავმები გამოიწვიოს.\n\n📍ჭავჭავაძის 51-2\nLady Stretch https://maps.app.goo.gl/RmkuYmpaUQSz9xKdA"}]}, {"label": "Сабуртало", "messages": [{"label": "", "ru": "Записала Вас на [день] в [время]\n\nПрийти необходимо за 10 минут до начала занятия, чтобы успеть переодеться. С собой нужно взять одежду из тянущейся ткани и носочки. Обувь не нужна. Вода, коврики и все необходимое у нас есть 😊\n\nЧтобы открыть дверь подъезда, на сером домофоне слева наберите код 123456\n\nСправа от лифтов будет проход к лестнице, нужно подняться на второй этаж, наша дверь слева с табличкой Lady Stretch\n\nПожалуйста, приходите вовремя 🙏 Если вы опоздаете более чем на 10 минут, запись будет отменена, так как пропуск разминки может привести к травмам\n\n📍Нуцубидзе 125\nLady Stretch https://maps.app.goo.gl/vXexv2M1NTjrwqeA6", "en": "I signed you up for [day] at [time]\n\nIt is better to come 10 minutes before the start of the class in order to have time to change clothes. You need to take clothes made of stretch fabric and socks with you. Shoes are not needed. We have water, mats and everything you need 😊\n\nTo open the building entrance door, enter the code 123456 on the gray intercom on the left.\n\nTo the right of the elevators there will be a passage to the stairs. Go up to the second floor; our door is on the left with a “Lady Stretch” sign.\n\nPlease arrive on time 🙏 If you are more than 10 minutes late, your appointment will be canceled, as missing the warm-up may lead to injuries.\n\n📍Nutsubidze 125\nLady Stretch https://maps.app.goo.gl/vXexv2M1NTjrwqeA6", "ka": "ჩაგწერეთ [დღე] [დრო]-ზე. 😊\n\nთქვენ უნდა მოხვიდეთ გაკვეთილის დაწყებამდე 10 წუთით ადრე, რომ დრო გქონდეთ ტანსაცმლის გამოსაცვლელად. ასევე უნდა წამოიღოთ  თქვენთვის კომფორტული ელასტიური ტანსაცმელი . ფეხსაცმელი არ არის საჭირო. გვაქვს წყალი, ხალიჩები და ყველაფერი რაც თქვენ ვარჯიშისთვის გჭირდებათ 😊\n\nსადარბაზოს კარის გასაღებად აკრიფეთ 123456\n\nლიფტების მარჯვნივ იქნება გასასვლელი კიბისკენ, უნდა ახვიდეთ მეორე სართულზე, ჩვენი კარი მარცხნივაა წარწერით „Lady Stretch“.\n\nგთხოვთ, დროულად მობრძანდეთ 🙏 თუ 10 წუთზე მეტით დაგაგვიანდებათ, თქვენი ჯავშანი გაუქმდება, რადგან გახურების გამოტოვებამ შეიძლება ტრავმები გამოიწვიოს.\n\n📍ნუცუბიძის 125\nLady Stretch https://maps.app.goo.gl/vXexv2M1NTjrwqeA6"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Подтверждение АЭРО", "kind": "chat", "keywords": "аэро аэростретчинг гамак подтверждение запись адрес одежда", "note": "", "follow_up": "", "variants": [{"label": "Ваке", "messages": [{"label": "", "ru": "Записала Вас на [день] в [время]\n\nПрийти необходимо за 10 минут до начала занятия, чтобы успеть переодеться. Лучше заниматься в лосинах и футболке с закрытым рукавом, чтобы вам было комфортнее 😊\n\nПожалуйста, приходите вовремя 🙏 Если вы опоздаете более чем на 10 минут, запись будет отменена, так как пропуск разминки может привести к травмам\n\nМы находимся напротив (на другой стороне дороги) Посольства Ирана. Вам нужно ориентироваться на желтый шлагбаум, пройти в арку за ним. Сразу справа на углу здания Вы увидите дверь и лестницу вниз\n\n📍Чавчавадзе 51-2\nLady Stretch https://maps.app.goo.gl/RmkuYmpaUQSz9xKdA", "en": "I've made an appointment for [day] at [time].\n\nYou need to arrive 10 minutes before the class starts so you have time to change. It’s better to wear leggings and a T-shirt with sleeves so you feel more comfortable 😊\n\nPlease arrive on time 🙏 If you are more than 10 minutes late, your appointment will be canceled, as missing the warm-up may lead to injuries\n\nWe are located directly across the street from the Iranian Embassy. Look for the yellow barrier gate and walk through the archway behind it. Immediately on your right, at the corner of the building, you'll see a door and a staircase leading downstairs.\n\n📍Chavchavadze 51-2\nLady Stretch https://maps.app.goo.gl/RmkuYmpaUQSz9xKdA", "ka": "ჩაგწერეთ [დღე] [დრო]-ზე. 😊\n\nგთხოვთ, მობრძანდეთ გაკვეთილის დაწყებამდე 10 წუთით ადრე, რათა მშვიდად მოასწროთ გადაცმა. ვარჯიშისთვის უმჯობესია ჩაიცვათ ლეგინსები და დახურულმკლავიანი მაისური, რათა უფრო კომფორტულად იგრძნოთ თავი. 😊\n\nგთხოვთ, აუცილებლად მოხვიდეთ დროულად. 🙏 თუ 10 წუთზე მეტით დაგაგვიანდებათ, თქვენი ჯავშანი გაუქმდება, რადგან გახურების გამოტოვებამ შესაძლოა ტრავმა გამოიწვიოს.\n\nჩვენ ვიმყოფებით ირანის საელჩოს პირდაპირ, ქუჩის მეორე მხარეს. ორიენტირდით ყვითელ შლაგბაუმზე, გაიარეთ მის უკან მდებარე თაღში. შენობის კუთხეში, მარჯვენა მხარეს, მაშინვე დაინახავთ კარს და კიბეს, რომელიც ქვემოთ ჩადის.\n\n📍ჭავჭავაძის 51-2\nLady Stretch https://maps.app.goo.gl/RmkuYmpaUQSz9xKdA"}]}, {"label": "Сабуртало", "messages": [{"label": "", "ru": "Записала Вас на [день] в [время]\n\nПрийти необходимо за 10 минут до начала занятия, чтобы успеть переодеться. Лучше заниматься в лосинах и футболке с закрытым рукавом, чтобы вам было комфортнее 😊\n\nЧтобы открыть дверь подъезда, на сером домофоне слева наберите код 123456\n\nСправа от лифтов будет проход к лестнице, нужно подняться на второй этаж, наша дверь слева с табличкой Lady Stretch\n\nПожалуйста, приходите вовремя 🙏 Если вы опоздаете более чем на 10 минут, запись будет отменена, так как пропуск разминки может привести к травмам\n\n📍Нуцубидзе 125\nLady Stretch https://maps.app.goo.gl/vXexv2M1NTjrwqeA6", "en": "I've made an appointment for [day] at [time].\n\nYou need to arrive 10 minutes before the class starts so you have time to change.  It’s better to wear leggings and a T-shirt with sleeves so you feel more comfortable 😊\nTo open the building entrance door, enter the code 123456 on the gray intercom on the left.\n\nTo the right of the elevators there will be a passage to the stairs. Go up to the second floor; our door is on the left with a “Lady Stretch” sign.\n\nPlease arrive on time 🙏 If you are more than 10 minutes late, your appointment will be canceled, as missing the warm-up may lead to injuries.\n\n📍Nutsubidze 125\nLady Stretch https://maps.app.goo.gl/vXexv2M1NTjrwqeA6", "ka": "ჩაგწერეთ [დღე] [დრო]-ზე. 😊\n\nგთხოვთ, მობრძანდეთ გაკვეთილის დაწყებამდე 10 წუთით ადრე, რათა მოასწროთ გადაცმა. ვარჯიშისთვის უმჯობესია ჩაიცვათ ლეგინსები და დახურულმკლავიანი მაისური, რათა უფრო კომფორტულად იგრძნოთ თავი. 😊\n\nშესასვლელი კარის გასაღებად, მარცხენა მხარეს მდებარე ნაცრისფერ დომოფონზე აკრიფეთ კოდი 123456.\n\nლიფტების მარჯვენა მხარეს დაინახავთ გასასვლელს კიბეებისკენ. აიარეთ მეორე სართულზე — ჩვენი კარი მარცხენა მხარესაა, წარწერით Lady Stretch.\n\nგთხოვთ, აუცილებლად მოხვიდეთ დროულად. 🙏 თუ 10 წუთზე მეტით დაგაგვიანდებათ, თქვენი ჯავშანი გაუქმდება, რადგან გახურების გამოტოვებამ შესაძლოა ტრავმა გამოიწვიოს.\n\n📍ნუცუბიძის 125\nLady Stretch https://maps.app.goo.gl/vXexv2M1NTjrwqeA6"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "Возврат не отвечающих", "icon": "chat-round-dots", "kind": "text", "items": [{"title": "Какие вопросы", "kind": "chat", "keywords": "возврат вопросы не отвечает дожим", "note": "", "follow_up": "После отправки: поставить задачу через 2 дня отправить «Заканчиваем запись».", "variants": [{"label": "", "messages": [{"label": "", "ru": "Здравствуйте! Если у вас остались вопросы по тренировкам, я с удовольствием отвечу на них 🙋‍♀️\n\nДавайте подберем удобное время, чтобы мы могли забронировать за вами место в группе и записать к нашему топ-тренеру? ☺️", "en": "Hello! If you have any questions about classes, I will be happy to answer them 🙋‍♀️\n\nLet's find a convenient time so we can book a place for you in the group and sign you up to our top- trainer? ☺️", "ka": "გამარჯობა! თუ ვარჯიშთან დაკავშირებით რაიმე შეკითხვა გაგიჩნდებათ, სიამოვნებით გიპასუხებთ 🙋‍♀️\n\nმოდით, ამოვირჩიოთ თქვენთვის მოსახერხებელი დრო, რათა ჯგუფში ადგილი დაგიჯავშნოთ და ჩვენს საუკეთესო მწვრთნელთან ჩაგწეროთ? ☺️"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Заканчиваем запись", "kind": "chat", "keywords": "возврат осталось мест неделя дожим", "note": "", "follow_up": "После отправки: поставить задачу через 7 дней отправить «Актуальность».", "variants": [{"label": "", "messages": [{"label": "", "ru": "Добрый день! У нас осталось всего несколько мест на пробное занятие на эту неделю! Давайте подберем для вас время, в какой день вам было бы удобно записаться? 💜", "en": "Hello! We have only a few spots left for the trial lesson this week! Let's find a time for you, what day would be convenient for you to sign up? 💜", "ka": "გამარჯობა! ამ კვირაში საცდელი გაკვეთილისთვის მხოლოდ რამდენიმე ადგილი დაგვრჩა! მოდით, გამოვნახოთ თქვენთვის დრო, რომელ დღეს იქნება თქვენთვის მოსახერხებელი რეგისტრაციისთვის? 💜"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Актуальность", "kind": "chat", "keywords": "возврат скидка сгорает дожим", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Добрый день 💜\n\nХотели сообщить, что скидка на первое посещение сгорит через несколько дней 🥺\nПланируете ли вы начать занятия в нашей студии?", "en": "Hello 💜\n\nWe wanted to inform you that the discount on your first visit will expire in a few days 🥺\nAre you going to start classes at our studio?", "ka": "გამარჯობა💜\n\nგვინდა გაცნობოთ, რომ პირველ ვიზიტზე ფასდაკლება რამდენიმე დღეში იწურება 🥺\nგეგმავთ ჩვენს სტუდიაში გაკვეთილების დაწყებას?"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "Перед пробным — напоминание", "icon": "alarm", "kind": "text", "items": [{"title": "Напоминание о пробном", "kind": "chat", "keywords": "напоминание подтверждение завтра пробное звонок", "note": "Если не отвечает на звонок — дублируем в чат (ОБЯЗАТЕЛЬНО сначала пробуем дозвониться).", "follow_up": "После отправки: поставить задачу «Абонемент со скидкой» через 3 дня.", "variants": [{"label": "", "messages": [{"label": "", "ru": "Добрый день, напоминаем, что вы завтра записаны на [направление] в [время]\nХотим подтвердить вашу запись, тренер будет вас ждать💜\n\nВ день пробного занятия будет действовать скидка на наши абонементы, вы сможете максимально выгодно воспользоваться нашими услугами 😊", "en": "Hello, just a reminder that you are signed up for [class] tomorrow at [time]\n\nWe would like to confirm your appointment, the trainer will be waiting for you💜\n\nOn the day of the trial class there will be discount on our passes, you will be able to maximize the benefits of our services 😊", "ka": "შუადღე მშვიდობისა, შეგახსენებთ, რომ თქვენ დარეგისტრირებული ხართ ხვალ [დრო]\n\nგვსურს დავადასტუროთ თქვენთან შეხვედრა, ტრენერი გელოდებათ 💜\n\nსაცდელი გაკვეთილის დღეს გექნებათ 30%მდე  ფასდაკლება ყველა აბონიმენტზე!თქვენ შეძლებთ მაქსიმალურად გამოიყენოთ ჩვენი სერვისების უპირატესობები 😊"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Не может прийти", "kind": "chat", "keywords": "перенос отмена другой день не придет", "note": "", "follow_up": "После отправки: поставить задачу повторно записать на пробное через 3 дня.", "variants": [{"label": "", "messages": [{"label": "", "ru": "Спасибо, что сообщили нам! Возможно вам будет удобно прийти в другой день?\n\nНа этой неделе у нас есть несколько свободных вариантов. В какой день вы можете записаться, чтобы сохранить за собой скидку на пробное занятие? 😌", "en": "Thank you for letting us know! Perhaps it would be convenient for you to come back another day?\n\nThis week we have several available slots. Which day can you book to save your discount for the trial session? 😌", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "После пробного", "icon": "hand-heart", "kind": "text", "items": [{"title": "Мобильное приложение", "kind": "chat", "keywords": "приложение запись онлайн setapp отмена записи", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Здравствуйте, напоминаю, что у нас есть мобильное приложение https://setapp.ru/ladystretch , можете его скачать и самостоятельно записываться на тренировки в удобное для вас время ❤️\n\nКогда вы скачаете приложение, вам нужно будет войти в личный кабинет, используя грузинский номер телефона, и пройти авторизацию через звонок (это звонок-сброс на российский номер). Если всё пройдет успешно, в приложении вы увидите своё имя и абонемент.\nЧтобы записаться на занятие, перейдите во вкладку «Расписание» и выберите подходящий класс.\nОбращаем ваше внимание, что отменить запись можно только если до начала занятия осталось 5 и более часов. Если вы напишете нам сюда, мы сможем отменить запись за 3 часа до начала тренировки.", "en": "Hello, I remind you that we have a mobile application https://setapp.ru/ladystretch , you can download it and sign up for training at your convenience ❤️\nWhen you download the app, you’ll need to log into your personal account using your Georgian phone number and complete authorization via a call (it’s a callback to a Russian number). If everything goes successfully, you will see your name and membership in the app.\nTo book a class, go to the “Schedule” tab and choose a suitable class.\nPlease note that you can cancel a booking only if there are 5 or more hours left before the class starts. If you message us here, we can cancel your booking up to 3 hours before the workout", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Сердечная забота", "kind": "task", "keywords": "отзыв отзывы карты правила студии", "note": "", "follow_up": "", "variants": [{"label": "Ваке", "messages": [{"label": "", "ru": "Добрый день!\n\nМы будем признательны, если вы оставите отзыв о нас на картах.Просто перейдите по ссылке: https://g.page/r/CV2O5Snq4Te1EBM/review и поделитесь вашим впечатлением от посещения студии 💜\n\nЕсли не знаете, о чем написать, вот несколько вопросов, которые помогут вам:\n- Расскажите, когда вы у нас были?\n- На какую тренировку ходили и какой абонемент купили?\n- Что вам больше всего понравилось?\nСпасибо! 🙏\n\nТакже просим ознакомиться с правилами студии по ссылке: https://lady-stretch.one/rules#!/tab/873111208-3", "en": "Hello!\n\nWe will be grateful if you leave a review about us on the maps. This will help us become better. Just follow the link: https://g.page/r/CV2O5Snq4Te1EBM/review and share your impressions of visiting the studio 💜\n\nIf you don't know what to write about, here are some questions to help you:\n- Tell me, when did you visit us?\n- What training did you go to and what membership did you buy?\n- What did you like most?\nThank you! 🙏\n\nPlease also read the studio rules at the link: https://lady-stretch.one/rules#!/tab/873111208-1", "ka": ""}]}, {"label": "Сабуртало", "messages": [{"label": "", "ru": "Мы будем признательны, если вы оставите отзыв о нас на картах. Это поможет нам стать лучше. Просто перейдите по ссылке: https://g.page/r/CVMSGWWTvpM8EBM/review и поделитесь вашим впечатлением от посещения студии 💜\n\nЕсли не знаете, о чем написать, вот несколько вопросов, которые помогут вам:\n- Расскажите, когда вы у нас были?\n- На какую тренировку ходили и какой абонемент купили?\n- Что вам больше всего понравилось?\nСпасибо! 🙏\n\nТакже просим ознакомиться с правилами студии по ссылке: https://lady-stretch.one/rules#!/tab/873111208-3", "en": "We will be grateful if you leave a review about us on the maps. This will help us become better. Just follow the link: https://g.page/r/CVMSGWWTvpM8EBM/review and share your impressions of visiting the studio 💜\n\nIf you don't know what to write about, here are some questions to help you:\n- Tell me, when did you visit us?\n- What training did you go to and what membership did you buy?\n- What did you like most?\nThank you! 🙏\n\nPlease also read the studio rules at the link: https://lady-stretch.one/rules#!/tab/873111208-1", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Неделька", "kind": "task", "keywords": "посещаемость не ходит давно не видели", "note": "- Проверяем ходит ли клиент после покупки, если ходит, то закрываем задачу\n- Если не ходит, то звоним и говорим, что давно не видели в студии, предлагаем записаться на тренировку\n- При недозвоне — отправляем сообщение ниже (СКРИПТ).", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "При недозвоне", "ru": "Здравствуйте! 💜\nДавно не видели вас на тренировках!)\nХотела уточнить, когда вы планируете возвращаться к занятиям? Чтобы сохранить результаты, очень важно не делать долгих перерывов! 🙌🏻💗", "en": "Hello! 💜\nWe haven’t seen you at training sessions for a while! 😊\nI wanted to check when you’re planning to return to your workouts. To maintain your results, it’s very important not to take long breaks! 🙌🏻💗", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Месяцок", "kind": "task", "keywords": "обратная связь план тренировок посещаемость месяц", "note": "- Проверяем, как часто ходит клиент после покупки, если ходит регулярно (2-3 раза в неделю), то звоним и спрашиваем обратную связь по тренировкам:\n  - все ли нравится\n  - к каким тренерам ходит и на какие направления\n  - есть ли какие-то предложения по улучшению\n- Если ходит редко, то звоним и предлагаем составить план тренировок и собираем обратную связь", "follow_up": "После выполнения поставить задачу еще через 3 недели “Проверить посещаемость” (если ходит редко, звоним и записываем на ближайшие занятия).", "variants": [{"label": "", "messages": [{"label": "Скрипт звонка — если ходит редко", "ru": "[имя], Добрый день!\nЭто {админ}, студия Леди Стрейч.\n\nВы не так давно покупали у нас абонемент. Видим, что у вас не так часто получается посещать нашу студию. Предлагаем вам составить тренировочный план для того, чтобы вы действительно получили тот результат, который хотите!\n\nМы советуем клиентам записаться на 3 занятия, чтобы вам комфортно было втянуться в тренировочный процесс. Давайте подберем для вас удобные дни и время для записи?)", "en": "", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "Частые вопросы", "icon": "question-circle", "kind": "text", "items": [{"title": "О студии", "kind": "chat", "keywords": "студия группы пробное цена направления абонемент", "note": "", "follow_up": "После отправки: поставить задачу на отправку сообщения возврата «Какие вопросы» через 4 часа или на следующий день, если конец рабочего дня.", "variants": [{"label": "", "messages": [{"label": "", "ru": "Здравствуйте💜\nЗанятия проходят у нас каждый день в мини группах 5-8 человек, поэтому тренер занимается ИНДИВИДУАЛЬНО с каждым👍🏽\nУ нас есть пробное занятие, стоимость со скидкой всего 14 лари🥰\nДалее вы можете приобрести абонемент со скидкой до 30%🎁\n🤍абонемент на любые направления\n✅Стретчинг\n✅Аэростретчинг\n✅Растяжка с подкачкой\n✅Здоровая спина\n✅Пилатес\n✅Йога\n💁🏼‍♀️Стоимость абонементного занятия начинается от 18 лари в зависимости от выбранного абонемента\n📲Оставьте, пожалуйста, ваш контактный номер телефона. С вами свяжется администратор, расскажет подробно про нашу студию и запишет на пробное занятие в удобное для Вас время🌼", "en": "Hello💜\nWe have classes every day in mini groups of 5-8 people, so the trainer works INDIVIDUALLY with everyone👍🏽\nWe have a trial lesson, the discounted price is only 14 GEL🥰\nNext, you can buy a membership with a discount for any classes🎁\n✅Stretching\n✅Aerostretching\n✅Stretching with pumping\n✅Pilates\n✅Healthy back\n✅Yoga\n💁🏼‍♀️The price of a membership lesson starts from 18 GEL depending on the subscription chosen\n📲Please leave your contact phone number. The administrator will contact you, tell you in detail about our studio, the schedule and sign up for a trial lesson at a time convenient for you🌼", "ka": "გამარჯობა💜\nვარჯიშები ტარდება ყოველ დღე.\nდილას,შუადღეს და საღამოს საათებში 9:00 - 21:00 საათამდე. ყოველ ერთ საათში, ვარჯიშები ტარდება მინი-ჯგუფებში 5-8 ადამიანი, ამიტომაც ტრენერი მუშაობს ინდივიდუალურად ყველასთან👍🏽\nსაცდელი ვარჯიში ფასდაკლებით ღირს სულ 14 ლარი 🥰\nშემდეგ თქვენ შეძლებთ შეიძინოთ აბონიმენტი ფასდაკლებით🎁\n🤍 აბონიმენტი ნებისმიერი მიმართულებით:\n✅ სტრეტჩინგი\n✅აეროსტრეიჩინგი\n✅ წონის ვარჯიში\n✅ჯანმრთელი წელი\n✅პილატესი\n✅იოგა\n💁🏼‍♀️ აბონიმენტის ღირებულება იწყება 18 ლარიდან  გააჩნია, რომელ აბონიმენტს აირჩევთ\n📲გთხოვთ, დაგვიტოვოთ თქვენი ტელეფონის ნომერი. ადმინისტრატორი დაგიკავშირდებათ და ჩაგწერთ თქვენთვის მოსახერხებელ დღე და დროს,  საცდელ ვარჯიშზე, გაეცანით განრიგს, ფასებს და მოგიყვებით დაწვრილებით სტუდიის შესახებ"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Сколько стоит абонемент?", "kind": "chat", "keywords": "цена прайс стоимость оплата рассрочка абонемент", "note": "Если клиент спрашивает конкретно прайс — следующим сообщением отправить актуальный прайс (картинку) вместе со вторым сообщением.", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "У нас разные абонементы на разное количество занятий: от 16 до 50. Стоимость одного занятия зависит от срока абонемента: от 20 до 25 лари за занятие. По одному абонементу вы можете посещать обе студии и все классы. Средняя стоимость абонемента в месяц 200 лари.\n\nПосле пробного занятия администратор поможет подобрать вам оптимальный вариант в зависимости от ваших предпочтений и целей, а также подарит скидку на любой абонемент.\nКогда вы планируете пробное посещение?", "en": "We have different subscriptions for different numbers of classes: from 16 to 50. The cost of one class depends on the subscription period: from 20 to 25 GEL per class. With one membership, you can attend both studios and all classes. The average cost of a monthly subscription is 200 GEL.\n\nAfter the trial class the administrator will help you choose the best option depending on your preferences and goals and will also give a discount on any subscription.\nWhen are you planning a trial visit?", "ka": "ჩვენ გვაქვს სხვადასხვა აბონიმენტები გაკვეთილების სხვადასხვა რაოდენობისთვის: 16-დან 50-მდე. ერთი გაკვეთილის ღირებულება დამოკიდებულია აბონიმენტის პერიოდზე: 20-დან 25 ლარამდე თითო გაკვეთილზე.\n\nსაცდელი გაკვეთილის შემდეგ, ადმინისტრატორი დაგეხმარებათ საუკეთესო ვარიანტის არჩევაში თქვენი პრეფერენციებისა და მიზნების გათვალისწინებით.\nროდის გეგმავთ საცდელ ვიზიტს?"}, {"label": "Следующим сообщением — если спрашивают прайс", "ru": "Вот наш актуальный прайс☺️\nТакже у нас есть возможность разделить сумму на несколько платежей чтобы вам было комфортнее💜", "en": "Here is our current price☺️\nWe also have the opportunity to divide the amount into several payments to make it more comfortable for you.", "ka": "ეს არის ჩვენი მიმდინარე ფასები.\nასევე, გვაქვს შესაძლებლობა, თანხა რამდენიმე გადახდად გავყოთ, რათა თქვენთვის უფრო მოსახერხებელი იყოს."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Где мы?", "kind": "chat", "keywords": "адрес локация студии карта Ваке Сабуртало как добраться", "note": "", "follow_up": "После отправки: поставить задачу на отправку сообщения возврата «Какие вопросы» через 4 часа или на следующий день, если конец рабочего дня.", "variants": [{"label": "", "messages": [{"label": "", "ru": "Здравствуйте!🥰\nУ нас 2 студии по адресам:\n- Чавчавадзе 51, около парка Ваке  https://maps.app.goo.gl/E3Hr7wMSM3Sam5gv6\n- Нуцубидзе 125, около метро Важа-Пшавела  https://maps.app.goo.gl/LC86i38ASkMTyQB2A\n\nКакая локация для вас удобнее?", "en": "Hello! 🥰\nWe have 2 studios at the addresses:\n- Chavchavadze 51, near Vake Park  https://maps.app.goo.gl/E3Hr7wMSM3Sam5gv6\n- Nutsubidze 125, near Vazha-Pshavela metro station https://maps.app.goo.gl/LC86i38ASkMTyQB2A\n\nWhich location is more convenient for you?", "ka": "გამარჯობა! 🥰\nჩვენ გვაქვს 2 სტუდია შემდეგ მისამართებზე:\nჭავჭავაძის 51, ვაკის პარკთან ახლოს\nhttps://maps.app.goo.gl/E3Hr7wMSM3Sam5gv6\nნუცუბიძის 125, ვაჟა-ფშაველას მეტროსთან ახლოს\nhttps://maps.app.goo.gl/LC86i38ASkMTyQB2A\n\nრომელი ლოკაციაა თქვენთვის უფრო მოსახერხებელი? 😊"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Русский админ", "kind": "chat", "keywords": "грузинский язык администратор русский английский", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Добрый день, к сожалению, сегодня нет администратора, который говорит на грузинском, удобно ли вам будет продолжить диалог на русском или английском?😊\nПриносим свои извинения за неудобства🙏🏼", "en": "Hello, unfortunately today there is no administrator who speaks Georgian, would it be convenient for you to continue the dialog in Russian or English? 😊\nWe apologize for the inconvenience 🙏🏼", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Как проходит занятие", "kind": "chat", "keywords": "занятие структура разминка тренировка", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "В начале проходит разминка для разогрева мышц, далее основная тренировка (растяжка или силовые), при этом в течении занятия тренер подходит к каждой ученице, она отвечает на вопросы и поможет выполнить упражнения качественно, в конце 5 минут расслабления для восстановления дыхания, пульса.\n\nБлагодаря такой структуре занятия, помимо растяжки вы получите подтянутое тело, гибкую спину и заряд бодрости  на весь оставшийся день 🧡\n\nДавайте запишем Вас на пробное занятие и вы сами всё увидите?)", "en": "", "ka": "დასაწყისში ხდება ვარჯიშები კუნთების გახურებისთვის, შემდეგ ძირითადი ვარჯიში ( გაწელვა ან წონის ვარჯიში), (და ეხმარება სავარჯიშოების ეფექტურად შესრულებაში) ბოლოს არის 5 წუთი დასვენება სუნთქვისა და პულსის აღსადგენად.\n\nდასაწყისში ვაკეთებთ ვარჯიშებს კუნთების გასახურებლად.შემდეგ დანარჩენი ვარჯიში. გაკვეთილის  დროს  ტრენერი მიდის ყველა მოსწავლესთან ეხმარება და ასევე პასუხს სცემს ყველა კითხვას. დასასრულისას 5 წუთი მოდუნება, პულსისა და სუთქვის აღსადგენად."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Что взять на занятие", "kind": "chat", "keywords": "одежда форма носки что взять обувь", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "С собой нужно будет взять удобную одежду из тянущейся ткани, кроссовки не нужны - занимаетесь в носочках. Вода,коврик и все необходимое у нас есть 😍\nХотите записаться на пробное?", "en": "", "ka": "თან მიგვაქვს კომფორტული ტანსაცმელი, წინდები, თმის სამაგრი,ფეხსაცმელი არ არის საჭირო.\nწყალი, ხალიჩები ჩვენ გვაქვს ყველაფერი რაც თქვენ გჭირდებათ.\nᲒსურთ ჩაგწეროთ საცდელ ვარჯიშზე?) 😍"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "9 направлений", "kind": "chat", "keywords": "направления виды занятий растяжка пилатес йога аэро", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Классическая растяжка — комплекс упражнений для развития гибкости, улучшения подвижности суставов и снятия мышечного напряжения. Подходит для любого уровня подготовки.\n\nПилатес — система тренировок, направленная на укрепление глубоких мышц, улучшение осанки, координации, баланса и контроля над телом.\n\nЗдоровая спина — мягкая тренировка для укрепления мышц спины и корпуса, улучшения осанки, снятия напряжения и профилактики болей в спине.\n\nЙога — сочетание физических упражнений, дыхательных техник и расслабления, которое помогает развить гибкость, силу, баланс и внутреннее спокойствие.\n\nАэростретчинг — растяжка в специальных гамаках. Улучшает гибкость, снимает нагрузку с позвоночника, развивает координацию и дарит ощущение легкости.\n\nПодкачка + растяжка — комбинированная тренировка, включающая силовые упражнения для укрепления мышц и завершающую растяжку для восстановления и гибкости.\n\nЯгодицы + пресс — интенсивная тренировка, направленная на укрепление ягодичных мышц, пресса и мышц кора, улучшение тонуса и рельефа тела.\n\nФункциональный тренинг — комплекс упражнений, развивающий силу, выносливость, координацию и подвижность, улучшая физическую форму для повседневной активности.", "en": "Classic Stretching — A series of exercises designed to improve flexibility, increase joint mobility, and relieve muscle tension. Suitable for all fitness levels.\n\nPilates — A low-impact workout focused on strengthening the core muscles, improving posture, balance, coordination, and body control.\n\nHealthy Back — A gentle class designed to strengthen the back and core muscles, improve posture, relieve tension, and help prevent back pain.\n\nYoga — A combination of physical postures, breathing techniques, and relaxation practices that enhance flexibility, strength, balance, and overall well-being.\n\nAerostretching — Stretching exercises performed in a hammock to improve flexibility, decompress the spine, enhance coordination, and create a feeling of lightness.\n\nStretching + muscle pumping — A combination workout that includes strength exercises to tone the body, followed by stretching to improve flexibility and aid recovery.\n\nGlutes + Abs — A focused workout designed to strengthen and tone the glutes, abdominal muscles, and core for improved stability and body shape.\n\nFunctional Training — A full-body workout that develops strength, endurance, coordination, mobility, and functional fitness for everyday movements.", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Подробно о направлениях", "kind": "chat", "keywords": "направления описание растяжка пилатес йога аэро функциональный", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Классическая растяжка\nКлассическая растяжка — это комплекс упражнений, направленный на развитие гибкости, увеличение подвижности суставов и снятие мышечного напряжения. Регулярные занятия помогают улучшить осанку, уменьшить скованность, повысить эластичность мышц и связок, а также снизить риск травм. Подходит как новичкам, так и тем, кто уже занимается спортом и хочет поддерживать тело в форме.\n\nПилатес\nПилатес — это система тренировок, направленная на укрепление глубоких мышц корпуса, улучшение осанки, координации и баланса. Все упражнения выполняются плавно и осознанно, с акцентом на правильное дыхание и контроль движений. Регулярные занятия помогают укрепить мышцы, сделать тело более подтянутым, улучшить гибкость и повысить качество движений в повседневной жизни.\n\nЗдоровая спина\n«Здоровая спина» — это мягкая оздоровительная тренировка, направленная на укрепление мышц спины и кора, улучшение осанки и профилактику болей в позвоночнике. Комплекс упражнений помогает снять напряжение после длительного сидения, повысить подвижность позвоночника и укрепить мышцы, поддерживающие правильное положение тела. Подходит людям любого возраста и уровня подготовки.\n\nЙога\nЙога сочетает физические упражнения, дыхательные практики и техники расслабления, помогая достичь гармонии между телом и разумом. Занятия развивают гибкость, силу, баланс и выносливость, способствуют снятию стресса, улучшению концентрации и общего самочувствия. Подходит как начинающим, так и опытным практикующим.\n\nАэростретчинг\nАэростретчинг — это современное направление растяжки с использованием специальных гамаков. Благодаря поддержке полотна упражнения выполняются комфортнее, позволяя глубже растянуть мышцы без лишней нагрузки на суставы. Занятия способствуют декомпрессии позвоночника, развитию гибкости, улучшению координации, осанки и ощущения легкости во всем теле.\n\nПодкачка + растяжка\n«Подкачка + растяжка» — это эффективная комбинированная тренировка, объединяющая силовые упражнения и упражнения на гибкость. Первая часть занятия направлена на укрепление и тонус основных групп мышц, а вторая — на восстановление, растяжку и расслабление. Такой формат помогает одновременно развивать силу, улучшать гибкость и ускорять восстановление после физических нагрузок.\n\nЯгодицы + пресс\n«Ягодицы + пресс» — это интенсивная тренировка, направленная на укрепление ягодичных мышц, мышц живота и кора. Комплекс упражнений помогает сформировать красивый силуэт, повысить мышечный тонус, улучшить осанку и стабильность корпуса. Занятие подходит для любого уровня подготовки благодаря возможности регулировать нагрузку.\n\nФункциональный тренинг\nФункциональный тренинг — это динамичная тренировка всего тела, основанная на естественных движениях человека. Упражнения одновременно развивают силу, выносливость, координацию, баланс и подвижность, делая тело более сильным и подготовленным к повседневным нагрузкам. Такие занятия помогают улучшить физическую форму, укрепить мышцы и снизить риск травм.", "en": "Classic Stretching\nClassic Stretching is designed to improve flexibility, increase joint mobility, and release muscle tension through a series of controlled stretching exercises. Regular practice helps improve posture, reduce stiffness, enhance circulation, and support overall body mobility. This class is suitable for beginners as well as experienced participants looking to maintain flexibility and prevent injuries.\n\nPilates\nPilates is a low-impact training method focused on strengthening the deep core muscles while improving posture, balance, coordination, and body awareness. Every movement is performed with precision and control, promoting better spinal alignment and overall muscle tone. Suitable for all fitness levels, Pilates helps build a strong, stable, and balanced body.\n\nHealthy Back\nHealthy Back is a gentle, therapeutic-style class designed to strengthen the muscles supporting the spine, improve posture, and reduce everyday tension. The exercises focus on increasing mobility, correcting muscular imbalances, and relieving discomfort caused by prolonged sitting or poor posture. This class is ideal for anyone looking to maintain a healthy, pain-free back.\n\nYoga\nYoga combines physical postures, breathing techniques, and mindfulness to create harmony between body and mind. Classes improve flexibility, strength, balance, concentration, and stress management while encouraging relaxation and mental clarity. Suitable for practitioners of all levels, yoga promotes both physical health and emotional well-being.\n\nAerostretching\nAerial Stretching combines traditional stretching techniques with the support of a suspended hammock. The hammock allows for deeper stretches with less pressure on the joints while gently decompressing the spine. This class improves flexibility, balance, coordination, and posture, while creating a unique feeling of lightness and relaxation.\n\nStretching + muscle pumping\nThis balanced workout combines strength training with flexibility exercises. The first part of the class focuses on toning and strengthening the major muscle groups using bodyweight or light equipment, while the second part emphasizes stretching and recovery. The combination improves muscle tone, flexibility, posture, and overall physical performance.\n\nGlutes + Abs\nGlutes + Abs is a targeted workout designed to strengthen and sculpt the glutes, abdominal muscles, and core. The class combines effective strength and endurance exercises that improve stability, posture, and functional movement while helping tone the lower body and midsection. Suitable for all fitness levels, with modifications available.\n\nFunctional Training\nFunctional Training is a dynamic full-body workout that develops strength, endurance, balance, coordination, and mobility through natural movement patterns. Exercises mimic everyday activities, improving overall fitness, athletic performance, and injury prevention. Every session challenges multiple muscle groups while enhancing cardiovascular endurance and core stability.", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Что входит в абонемент?", "kind": "chat", "keywords": "абонемент сертификат подруга обе студии", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "По одному абонементу вы можете ходить на все направления в обе  студии, также вы получаете подарочные сертификаты на бесплатную тренировку для ваших подруг, коллег или родственников", "en": "With one subscription you can go to all directions in both studios, you also receive gift certificates for a free training session for your friends, colleagues or relatives", "ka": "ერთი აბონიმენტის საშუალებით თქვენ შეგიძლიათ ჩვენს სტუდიაში წასვლა ყველა მიმართულებით, ასევე  გჩუქნით სასაჩუქრე სერთიფიკატებს თქვენს მეგობრებს, კოლეგებს, ან ნათესავებს უფასო ტრენინგზე."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Когда сяду на шпагат?", "kind": "chat", "keywords": "шпагат сколько занятий результат гибкость", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Есть несколько факторов, которые влияют на эластичность мышц и связок:\n- возраст;\n- строение суставов\n- пол\n- психологическое состояние\n- температура среды и тела\n- уровень силовой подготовки\n- предварительное напряжение мышц\nАбсолютно любого можно посадить на шпагат. В среднем новичкам требуется от 16 занятий регулярных занятий.\nПопробуйте посетить пробное занятие со скидкой  и тренер подробнее проконсультирует по этому вопросу.\nВ какой день Вам удобнее прийти?)", "en": "", "ka": ".არსებობს რამდენიმე ფაქტორი, რომლებმაც ზეგავლენას ახდენენ კუნთების ელასტიურობას\n*ასაკი\n*სახსრების აგებულობა\n*სქესი\n*ფსიქოლოგიური მდგომარეობა\n*გარემოსა და სხეულის ტემპერატურა\n*სიძლიერის დონე\n*კუნთების წინასწარი დაძაბულობა\nაბსოლუტურად ყველას შეუძლია შპაგატში ჩაჯდომა.საშუალოდ ახალ დაწყებულებს სჭირდებათ ხოლმე 8 მეცადინეობა. თქვენ შეგიძლიად საცდელ გაკვეთილზე იაროთ ტრენერთან და ტრენერი დეტალურად ჩაგიტარებთ კონსულტაციას კი ამ  საკითხთან დაკავშირებით.\nსაცდელ გაკვეთილზე სასიარულოდ თქვენ რომელი დღე გაწყობთ?"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "С какого направления начать?", "kind": "chat", "keywords": "новичок начать выбрать направление", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Вы можете выбрать любое из направлений, даже если вы новичок. У нас разработан индивидуальный подход к каждой ученице.\n\nЧтобы помочь определиться с направлением, скажите, что бы вы хотели получить от занятий?)", "en": "", "ka": "თქვენ შეგიძლიათ აირჩიოთ ნებისმიერი მიმართულება იმ შემთხვევაშიც კი თუ ახალ დამწყები ხართ.ჩვენ შევიმუშავეთ ინდივიდუალური მიდგომა თითოეული მოსწავლისთვის.\n\nიმისთვის რომ დაგეხმაროთ მიმართულების არჩევაში, შეგიძლიათ მითხრათ რა გსურთ რომ მიიღოთ მეცადინეობისგან."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Сесть на шпагат за 2 месяца?", "kind": "chat", "keywords": "шпагат два месяца результат", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Безусловно есть индивидуальные особенности, но согласно нашей статистике по студии большинство девушек садятся на шпагат за 2 месяца при регулярном посещении 3 раза в неделю\n\nЗаписать вас на первую пробную тренировку?)", "en": "", "ka": "რა თქმა უნდა ყველას გააჩნია ინდივიდუალური შესაძლებლობები.მაგრამ ჩვენი სტატისტიკის მაჩვენებლობით გოგოების უმრავლესობა ვინც დადის ჩვენთან სტუდიაში შპაგატში ჩაჯდება ორ თვეში რეგულარული სიარულისას კვირაში სამჯერ.\n\nჩაგწეროთ პირველ საცდელ გაკვეთილზე?"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "В чём заключается тренировка по стретчингу?", "kind": "chat", "keywords": "стретчинг растяжка тренировка структура", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "В нашей студии занятие по растяжке включает в себя: дыхательную практику, разминку всех групп мышц, растяжку (шпагаты, спина) , подкачку (буквально несколько упражнений)  и заминку. Основной акцент делается на растяжку💫\n\nБлагодаря такой структуре занятия, помимо растяжки вы получите подтянутое тело, гибкую спину и заряд бодрости  на весь оставшийся день 🧡", "en": "", "ka": "ჩვენთან სტუდიაში გაჭიმვაზე მეცადინეობა იგულისხმება:\nსუნთქვითი პრაქტიკა\nკუნთების ყველა ჯგუფის დათბობა\nგაჭიმვა ზურგისა და შპაგატის.\nძირითადი აქცენტი გაკეთებულია გაწელვაზე."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Растяжка — это больно?", "kind": "chat", "keywords": "больно болезненно боль страшно", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Тренер не только объясняет как правильно  выполнять упражнения, но и показывает. К тому же наши тренировки проходят в мини группах, что позволяет тренеру с каждым заниматься индивидуально)\n\nПри правильном подходе к занятиям растяжение происходит плавное и безболезненно под наблюдением тренера", "en": "", "ka": "ტრენერი არა მხოლოდ ხსნის თუ როგორ უნდა გააკეთოთ სავარჯიშო სწორად არამედ თვითონ აჩვენებს.\n\nტრენერის ხელმძღვანელობით გაჭიმვა ხდება ტკივილის გარეშე და საფრთხეს არ წარმოადგენს."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Какие есть противопоказания?", "kind": "chat", "keywords": "противопоказания здоровье беременность грыжа давление", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Противопоказания для занятий стретчингом\n\nИх очень немного, ведь растяжка - один из самых щадящих видов физической активности. Но кое-какие всё-таки есть:\n- остеохондроз в острой стадии;\n- гипертония;\n- недавно перенесённые вывихи и переломы;\n- грыжи;\n- обострённые и хронические заболевания суставов;\n- первый триместр беременности.\n\nЕсли ты наблюдаешь у себя хоть что-то из вышеперечисленному, лучше проконсультироваться с врачом  и узнать, какие нагрузки тебе подойдут", "en": "", "ka": "უკუჩვენებები გაწელვისას\n\nძალიან ცოტაა უკუჩვენებები რადგან გაწელვა ეს ყველზე აქტუალურია ფიზიკური აქტივობისას.\nოსტეროხონდროზი ბოლო სტადიაზე\nჰიპერტონია\nბოლო დროს მიღებული ტრავმები და მოტეხილობა\nთიაქარი\nქრონიკული დაავადებები\nორსულობის პირველი ტრიმესტრი\n\nთუ ზემოაღნიშნულებიდან ერთ ერთან დაკავშირებით პრობლემა გაქვთ ჯობია მიმართოთ ექიმს რათა გაიგოთ როგორი ტიპის სიმძიმის აწევაა თქვენთვის მიღებული."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Занятия для мужчин", "kind": "chat", "keywords": "мужчины мужчина парень персональные тренировки", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Добрый день!\n\nК сожалению, в наших студиях занимаются только девушки, у нас нет смешанных групп ☺️\nНо вы можете посещать наши персональные тренировки, желаете ознакомиться более подробно?)", "en": "", "ka": "სამწუხაროდ, ჩვენს სტუდიებში მხოლოდ გოგონები ვარჯიშობენ. Შერეული ჯგუფები არ გვყავს  ☺️\nმაგრამ თქვენ შეგიძლიათ ისარგებლოთ პერსონალური ტრენერით. გსურთ გაიგოთ მეტი დეტალურად?)"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Кто тренеры?", "kind": "chat", "keywords": "тренеры тренер опыт квалификация", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Все наши тренеры мастера спорта по художественной гимнастике/фигурному катанию с опытом проведение тренировок более 3 лет. Также они проходили обучение и сертификацию по всем направлениям, которые ведутся у нас в студии.", "en": "", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "Возражения", "icon": "shield-check", "kind": "text", "items": [{"title": "Мне далеко", "kind": "chat", "keywords": "далеко расстояние неудобно добираться", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "В любом случае ждём вашего визита\nПробная тренировка вас не к чему не обязывает, просто сходите на нее и увидите все сами😍\nПосетив нас, вы поймете, что расстояние не помеха💫", "en": "", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Выбрала других", "kind": "chat", "keywords": "другая студия конкуренты выбрала", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "За Вами также остается возможность прийти к нам на пробное занятие и мы будем очень рады видеть Вас в нашей студии и сравнить цены и качество, так как мы специализированная студия растяжки и у нас работают профессиональные тренеры и очень удобное расписание, благодаря чему вы сможете достичь нужного результата💜", "en": "You also have the opportunity to come to us for a trial session and we will be very happy to see you in our studio and compare prices and quality, as we are a specialized studio stretching and we have professional trainers and a very convenient schedule, so you can achieve the desired result💜", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Пока не в городе / плотный график", "kind": "chat", "keywords": "уехала не в городе занята позже потом график", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Время скидки на пробное занятие ограничено, поэтому сейчас можете оставить ваш номер телефона, чтобы мы закрепили за вами скидку на пробную тренировку 🌸\nИ вы сможете воспользоваться им в любое удобное для вас время ❤️", "en": "The time for the trial session discount is limited, so you can leave your phone number now so we can secure your trial session discount 🌸\nAnd you can use it anytime you want ❤️", "ka": "კარგით) აქციის დრო შეზღუდულია, ამიტომ გირჩევთ დატოვოთ თქვენი ტელეფონის ნომერი და ჩვენ დაგიკავშირდებით.\nდა თქვენ შეძლებთ გამოიყენოთ იგი თქვენთვის მოსახერხებელ ნებისმიერ დროს. რას ფიქრობთ?)❤️"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Нет свободного времени", "kind": "chat", "keywords": "нет времени занята график расписание", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "У нас удобный график, работаем каждый день  с 9:00 до 21:00, тренировки проходят почти каждый час, вы не привязаны к группе, ходите в удобное для Вас время 🤗\nДлительность занятия 50-55 минут)\nДавайте подберем для вас удобный день для посещения нашей студии?🥰", "en": "We have a convenient schedule, we work every day from 9:00 to 21:00, training is every hour, you are not tied to a group, go at a convenient time for you 🤗\nThe duration of the class is 50-55 minutes)\nLet's find a convenient day for you to visit our studio? 🥰", "ka": "ჩვენ ვმუშაობთ ყოველდღე და ძალიან კომფორტული გრაფიკი გვაქვს თქვენ სულ ერთ ჯგუფთან არ იქნებით ისე რომ შეგიძლიათ იაროთ თქვენთვის მისაღებ დროს.\nხანგრძლივობა 50-55 წუთი.\nშემიძლია შემოგთავაზოთ ვოტსაპით დახედოთ გრაფიკს.და ეს მოგცემთ შესაძლებლობას აირჩიოთ თქვენთვის მისაღები დრო."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Напишите номер, я сама позвоню", "kind": "chat", "keywords": "номер телефон сама позвоню контакт", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Администратор студии звонит клиентам и поэтому  очень часто номер бывает занят, чтобы оперативно с вами связались, я напрямую могу передать номер телефона, также мы можем поставить отметку когда вам удобно принять звонок)\n\nОставьте, пожалуйста, ваш контакт для связи❤️", "en": "", "ka": "სტუდიის ადმინისტრატორი ყოველთვის უკავშირდება კლიენტებს ამიტომ ხშირ შემთხვევაში შეიძლება დაკავებული იყოს ამიტომ ხარისხიანად და დროულად რომ მოხდეს თქვენთან კონტაქტი,გთხოვთ) დაგვიტოვოთ თქვენი ტელეფონის ნომერი,რომ დაგიკავშირდეთ💜🤍"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Не могу сейчас разговаривать", "kind": "chat", "keywords": "занята не могу говорить перезвонить звонок", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Администратор может позвонить, когда вам будет удобно, вам остается только выбрать день и время для звонка 📲", "en": "", "ka": "ადმინისტრატორს შეუძლია თქვენთან დაკავშირება ვოტსაპითაც თქვენ უბრალოდ მიუთითეთ თქვენთვის მისაღები დღე და დრო."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Дорого", "kind": "chat", "keywords": "дорого цена стоимость деньги скидка рассрочка", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "При личном общении", "ru": "Подскажите, пожалуйста, низкая цена это единственное, что вы ищете в услуге?)", "en": "", "ka": ""}, {"label": "В чате", "ru": "Наше пробное занятие и скидка специально созданы, чтобы быть доступными для всех. Это отличный шанс попробовать что-то новое без больших затрат. Кроме того, мы можем обсудить гибкие варианты оплаты или персонализированный план, чтобы сделать это более доступным для вас.\nДавайте подберем для вас удобный день и время для записи?❤️", "en": "Our trial class and discount are specifically designed to be accessible to everyone. This is a great chance to try something new without breaking the bank. Additionally, we can discuss flexible payment options or a personalized plan to make this more affordable for you.\nLet's find a convenient day and time for you to sign up?❤️", "ka": "მე მესმის თქვენი შეშფოთება ჩვენი მომსახურების ღირებულებასთან დაკავშირებით. თუმცა, მნიშვნელოვანია გვახსოვდეს, რომ ჩვენი ფასი ასახავს ჩვენს მიერ მოწოდებულ მაღალ ხარისხს და გამოცდილებას. თუ ამას განიხილავთ როგორც გრძელვადიან ინვესტიციას, თქვენ მიიღებთ მნიშვნელოვან სარგებელს ტრენერისგან პერსონალიზებული მიდგომის სახით, შესანიშნავი ფიგურისა და შესანიშნავი განწყობის სახით🌺 გარდა ამისა, ჩვენ შეგვიძლია განვიხილოთ გადახდის მოქნილი ვარიანტები ან პერსონალიზებული გეგმა. ეს თქვენთვის უფრო ხელმისაწვდომია."}, {"label": "Следующим сообщением", "ru": "Нам важно, чтобы вы не купили абонемент, а именно получали результат, вы сами от этого будете счастливы и поделитесь этим с другими ❤️", "en": "It’s important to us that you don’t buy a subscription, but get results, you yourself will be happy about it and share it with others ❤️", "ka": "ჩვენთვის მნიშვნელოვანია, რომ არ იყიდოთ აბონიმენტი, არამედ მიიღოთ შედეგი, თქვენ თვითონ გაგიხარდებათ და გაუზიარეთ სხვებს ❤️"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "У меня травма", "kind": "chat", "keywords": "травма врач здоровье болит", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Если вы наблюдаетесь у врача – проконсультируйтесь с доктором.\nЕсли доктор разрешил - перед занятием предупредите тренера.", "en": "", "ka": "თუ თქვენ დადიხართ ექიმთან, კონსულტაცია გაიარეთ. გააფრთხილეთ მწვრთნელი გაკვეთილის დაწყებამდე."}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Не пластичная / не занималась", "kind": "chat", "keywords": "не гибкая новичок не занималась с нуля", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Конечно🤗\nМногие девушки к нам приходят и начинают с \"нуля\", при этом делают хорошие результаты и садятся на шпагаты даже начинающие😍\nНе переживайте, все к нам приходят научиться.\nДавайте запишем вас на пробное занятие?)", "en": "", "ka": "რა თქმა უნდა,🤗\nბევრი გოგონა მოდის ჩვენთან და იწყებს ნულიდან, ამავე დროს იღებენ კარგ შედეგს ჯდებიან შპაგატში,\nარ ინერვიულოთ, ყველა მოდის ჩვენთან იმისასთვის, რომ  ვისწავლოთ.\nᲒსურთ ჩაგწეროთ საცდელ ვარჯიშზე?) 😍"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Я стесняюсь", "kind": "chat", "keywords": "стесняюсь возраст вес полная неловко", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "У нас нет ограничений по возрасту и по весу, большинство девушек к нам приходят с нулевой подготовки, тренировки проходят в мини группах что позволяет тренеру с каждым заниматься индивидуально ❤️\n\nНе переживайте у вас всё получится, пробная тренировка вас  ни к чему не обязывает, приходите на неё и вы всё увидите своими глазами)\n\nКогда вам было бы удобно записаться на пробное занятие?)", "en": "", "ka": ".ჩვენთან შეზღუდვები არ არის ასაკსა და წონასთან დაკავშირებით.ზოგი დადის ჩვენთან ნულოვანი მომზადებით. მევადინეობები ტარდება მცირე ჯგუფებად იმისთვის რომ ტრენერს ჰქონდეს შესაძლებლობა იმუშაოს ინდივიდუალურად.\n\nარ ინერვიულოთ თქვენ შეძლებთ,მობრძანდით და თქვენ თვითონ დარწმუნდებით ამაში.❤️\n\nრომელი დღე და დრო იქნება თქვენტვის მოსახერხებელი?"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "Подписка на Instagram", "icon": "hashtag-circle", "kind": "text", "items": [{"title": "Когда подписались", "kind": "chat", "keywords": "инстаграм подписка сертификат директ", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Добрый день 🤗\nСпасибо, что интересуетесь нашей студией💜\nДарим вам сертификат на скидку для посещения пробного занятия❤️\n\nДля активации сертификата напишите свой номер телефона 📲 и имя 👍\nНаш администратор свяжется для закрепления сертификата за вами 💜", "en": "Good afternoon 🤗\nThank you for your interest in our studio💜\nWe are giving you a certificate for a discount for attending a trial lesson❤️\n\nTo activate the certificate, write your phone number 📲 and name 👍\nOur administrator will contact you to assign the certificate to you 💜", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "Звонок: абонемент со скидкой", "icon": "phone-calling-rounded", "kind": "text", "items": [{"title": "Абонемент со скидкой", "kind": "call", "keywords": "скидка 30 абонемент розыгрыш звонок после пробного", "note": "Звонок клиенту, который был на пробном, но не купил абонемент. Текст можно также отправить сообщением.", "follow_up": "После звонка или отправки сообщения поставить задачу «Актуальность» через 3 недели.", "variants": [{"label": "", "messages": [{"label": "", "ru": "Добрый день!\nУ нас проходил розыгрыш среди всех клиентов нашей студии, девушка выиграла скидку 30% на абонемент, но к сожалению, не воспользовалась ей 😊\nА скидка сегодня сгорает, абонемент будет стоить на четверть дешевле🔥\n\nЯ посмотрела, Вы у нас были недавно на пробном занятии, но не приобрели абонемент мы решили предложить скидку Вам, хотели бы воспользоваться?)\nА также, Какое количество занятий рассматриваете?💫", "en": "Good afternoon, it's Lady Stretch studio🌸\nWe had a drawing among all the clients of our studio, the girl won a 30% discount on a subscription, but unfortunately, she did not take advantage of it😊\nAnd the discount expires today, the subscription will cost a quarter cheaper🔥\n\nI saw that you recently attended a trial lesson with us, but did not purchase a subscription, we decided to offer you a discount, would you like to take advantage of it?)\nAnd also, How many classes are you considering?💫", "ka": "შუადღე მშვიდობისა\nჩვენი სტუდიის ყველა მომხმარებელს შორის გვქონდა გათამაშება, ერთ-ერთმა გოგონამ მოიგო 30% ფასდაკლება, მაგრამ სამწუხაროდ, მან არ ისარგებლა ამით 😊\nფასდაკლების ვადა კი დღეს იწურება, აბონიმენტი ეღირება მეოთხედით იაფი🔥\n\nდავინახე, რომ ახლახანს დაესწარით ჩვენთან საცდელ გაკვეთილს, მაგრამ არ იყიდეთ აბონიმენტი, გადავწყვიტეთ შემოგთავაზოთ ფასდაკლება, გსურთ ისარგებლოთ ამით?)\nდა ასევე, რამდენ გაკვეთილს განიხილავთ?💫"}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "Доплата за абонемент", "icon": "wallet-money", "kind": "text", "items": [{"title": "Напоминание о доплате", "kind": "chat", "keywords": "доплата остаток долг оплата абонемента реквизиты", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "", "ru": "Добрый день! ☀️\n\nХотим напомнить Вам о небольшом остатке по оплате вашего абонемента в размере [сумма]. Будем благодарны, если вы сможете завершить оплату оставшейся суммы до конца этого месяца💜\n\nОплату можно произвести переводом на карту по реквизитам:\n\nGE02TB7296845064400012\nVladimir Borin\n\nПожалуйста, пришлите чек\nЖдём встречи в Lady Stretch! 😊", "en": "Good afternoon ☀️\n\nWe would like to remind you that there is a small balance remaining on your subscription payment in the amount of [amount] lari. We will be grateful if you could complete payment of the remaining amount before the end of this month💜\n\nPayment can be made in any way convenient for you when visiting the studio or by transfer to a card using the details:\n\nGE02TB7296845064400012\nVladimir Borin\n\nLooking forward to seeing you at Lady Stretch!😊", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}, {"title": "Реквизиты для оплаты", "kind": "info", "keywords": "реквизиты счет iban оплата перевод карта", "note": "", "follow_up": "", "variants": [{"label": "", "messages": [{"label": "Предоплата за пробное", "ru": "GE10CD0360000043702858\nShirshikova Milana", "en": "", "ka": ""}, {"label": "Доплата или продление — TBC Bank", "ru": "GE02TB7296845064400012\nVladimir Borin", "en": "", "ka": ""}]}], "updated_by": "перенесено из документа", "change_note": "Перенесено из документа «Скрипты LS Tbilisi»"}]}, {"title": "Звонок: запись на пробное", "icon": "phone-calling-rounded", "kind": "call", "flow": {"start": "greet", "nodes": [{"id": "greet", "title": "Приветствие", "group": "main", "text": {"ru": "{имя}, добрый день!", "en": "", "ka": ""}, "hint": "Имени нет — просто «Добрый день!». Имя впишите в поле сверху, когда клиент назовёт.", "client": "Здравствуйте", "answers": [{"label": "Здравствуйте", "to": "intro"}]}, {"id": "intro", "title": "Представление", "group": "main", "text": {"ru": "Студия растяжки **Lady Stretch**. Меня зовут {админ}.\n\nЗвоню активировать ваш **сертификат на скидку** и записать на **пробное занятие** на ближайший удобный день и время.", "en": "", "ka": ""}, "hint": "Если нет имени — «Как я могу к вам обращаться?» и впишите имя в поле сверху.", "client": "отвечает", "answers": [{"label": "Отвечает", "to": "experience"}, {"label": "Не оставлял(а) заявку", "to": "obj_no_request"}, {"label": "Неудобно говорить / перезвонить", "to": "obj_callback"}]}, {"id": "experience", "title": "Опыт", "group": "main", "text": {"ru": "{имя}, вы раньше занимались растяжкой?", "en": "", "ka": ""}, "hint": "", "client": "да или любой ответ", "answers": [{"label": "Да", "to": "goal"}, {"label": "Нет", "to": "goal"}]}, {"id": "goal", "title": "Что хотите сейчас?", "group": "main", "text": {"ru": "А сейчас хотите просто **потянуться**, **сесть на шпагат**, **расслабиться** или, может, **похудеть**?", "en": "", "ka": ""}, "hint": "Ответ — потребность клиента: к ней вернёмся, когда будем советовать направление. Выбранный вариант останется в пути слева.", "client": "ответ", "answers": [{"label": "Потянуться / шпагат", "to": "about"}, {"label": "Расслабиться", "to": "about"}, {"label": "Похудеть", "to": "about"}, {"label": "Другое", "to": "about"}]}, {"id": "about", "title": "Расскажу о нас", "group": "main", "text": {"ru": "Очень хорошо, {имя}. Расскажу о нас.\n\nУ нас **специализированная женская фитнес-студия** для девушек любого возраста и уровня подготовки. Тренировки проходят в **мини-группах**, тренер помогает и следит за техникой в каждом упражнении — это позволит вам достичь видимых результатов в короткие сроки.\n\nУ нас открыто **4 направления**. Какие тренировки предпочитаете — **активные** или **спокойные**?", "en": "", "ka": ""}, "hint": "", "client": "ответ", "answers": [{"label": "Активные", "to": "directions"}, {"label": "Спокойные", "to": "directions"}]}, {"id": "directions", "title": "О направлениях", "group": "main", "text": {"ru": "Тогда рекомендую вам начать с направления:\n\n• **Стретчинг** — классическая растяжка, комплекс упражнений на интенсивную растяжку связок и всех групп мышц.\n• **Растяжка с подкачкой** — первые полчаса занимаетесь с небольшими утяжелителями и прокачиваете всё тело, следующие полчаса — растяжка. Она даётся значительно проще, потому что был хороший разогрев.\n• **Здоровая спина** — особенно для тех, у кого сидячая работа или болит спина: укрепляет мышечный корсет, оздоравливает позвоночник и снимает вред малоподвижного образа жизни.\n• **Ролл-стретчинг** — как массаж прямо на тренировке: ролл снимает напряжение в мышцах, даёт лимфодренажный эффект, и при этом вы хорошо потянетесь.\n\nНа пробной тренировке тренер оценит вашу физическую подготовку и составит **персональный план тренировок** под ваши цели. Вам такая тренировка подходит?", "en": "", "ka": ""}, "hint": "Советуйте направление под то, что клиент сказал в начале, — его потребность (смотрите путь слева).", "client": "говорит", "answers": [{"label": "Подходит", "to": "address"}, {"label": "Сомневается", "to": "obj_not_sure"}, {"label": "Сколько стоит?", "to": "obj_price"}]}, {"id": "address", "title": "Наш адрес", "group": "main", "text": {"ru": "У нас 2 студии:\n• **Чавчавадзе 51**, около парка Ваке\n• **Нуцубидзе 125**, около метро Важа-Пшавела\n\nКуда вам было бы удобно записаться?", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Ваке", "to": "day"}, {"label": "Сабуртало", "to": "day"}, {"label": "Далеко", "to": "obj_far"}]}, {"id": "day", "title": "Какой день?", "group": "main", "text": {"ru": "У нас открыта запись на **сегодня и ближайшие два дня**. Когда вам удобно записаться?", "en": "", "ka": ""}, "hint": "", "client": "говорит день", "answers": [{"label": "Назвал(а) день", "to": "time"}]}, {"id": "time", "title": "Когда удобно прийти", "group": "main", "text": {"ru": "Вам удобно в **утреннее** время или в **вечернее**?", "en": "", "ka": ""}, "hint": "", "client": "половину дня", "answers": [{"label": "Утро", "to": "schedule"}, {"label": "Вечер", "to": "schedule"}]}, {"id": "schedule", "title": "Проверяю расписание", "group": "main", "text": {"ru": "Отлично, {имя}, сейчас я проверю расписание.\n\nЕсть время на [время 1] и [время 2].", "en": "", "ka": ""}, "hint": "Предлагайте два времени — выбрать из двух проще, чем назвать своё.", "client": "говорит время", "answers": [{"label": "Выбрал(а) время", "to": "booked"}, {"label": "Не подходит", "to": "day"}]}, {"id": "booked", "title": "Запись", "group": "main", "text": {"ru": "{имя}, записала вас на [день, дата, время], направление [направление].", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Дальше", "to": "whatsapp"}]}, {"id": "whatsapp", "title": "WhatsApp", "group": "main", "text": {"ru": "{имя}, скажите, к этому номеру подключён **WhatsApp**?\n\nОтлично, дополнительно я вышлю вам информацию о записи сообщением в WhatsApp и видео, как нас легко найти.", "en": "", "ka": ""}, "hint": "", "client": "отвечает", "answers": [{"label": "Да", "to": "bye"}, {"label": "Нет", "to": "bye"}]}, {"id": "bye", "title": "Прощание", "group": "main", "text": {"ru": "{имя}, ждём скорой встречи с вами. Хорошего вам дня!", "en": "", "ka": ""}, "hint": "", "client": "", "answers": []}, {"id": "obj_price", "title": "Сколько стоит", "group": "objection", "text": {"ru": "Стоимость пробного занятия — всего **14 ₾**.\n\nТакже в день пробного занятия для вас будут подарки при покупке абонемента — это **скидка на абонемент до 30%** и **подарочные сертификаты**, которые вы можете подарить близким.\n\n1) Давайте расскажу о студии?\nили\n2) Давайте расскажу вам о направлениях?\nили\n3) Давайте подберём удобное время для записи на пробное занятие?", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Рассказать о студии", "to": "about"}, {"label": "Рассказать о направлениях", "to": "directions"}, {"label": "Подобрать время", "to": "day"}, {"label": "А сколько стоит абонемент?", "to": "obj_sub_price"}]}, {"id": "obj_sub_price", "title": "Сколько стоит абонемент", "group": "objection", "text": {"ru": "Стоимость абонементного занятия — **от 17 лари**, в зависимости от абонемента. Абонементы есть на разное количество занятий: минимальный — на **12 занятий**, действует 3 месяца, но, как правило, клиентам его хватает на месяц, стоимость — **289 лари**.\n\nЕсть более выгодные абонементы на 24, 48 и 96 занятий — на них после пробного действует **скидка 10%**: на 24 — **494 лари**, на 48 — **890 лари**, на 96 — **1691 лари**. Это длительные абонементы — от 6 месяцев до года.\n\nКроме того, мы можем обсудить гибкие варианты оплаты или персонализированный план, чтобы сделать это доступнее для вас.\n\nДавайте подберём для вас удобный день и время для записи? ❤️", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Подобрать время", "to": "day"}, {"label": "Рассказать о направлениях", "to": "directions"}]}, {"id": "obj_callback", "title": "Отказ / когда перезвонить", "group": "objection", "text": {"ru": "Хорошо, я вас поняла. Подскажите, пожалуйста, в какое время я могу вам перезвонить?", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Договорились о времени", "to": "callback_end"}]}, {"id": "callback_end", "title": "Перезвоню", "group": "objection", "text": {"ru": "Спасибо, {имя}! Перезвоню вам [время]. Хорошего дня!", "en": "", "ka": ""}, "hint": "Поставьте задачу на перезвон в CRM.", "client": "", "answers": []}, {"id": "obj_no_time", "title": "Нет времени на тренировки", "group": "objection", "text": {"ru": "Понимаю, что у вас может быть загруженный график. Мы работаем **каждый день и каждый час**, вы не привязаны к группе — ходите в удобное для вас время 🤗 Длительность занятия всего **50 минут**.\n\nДавайте подберём для вас удобный день и время для записи!\n\n1) Давайте расскажу о студии?\nили\n2) Давайте расскажу вам о направлениях?\nили\n3) Давайте подберём удобное время для записи на пробное занятие?", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Рассказать о студии", "to": "about"}, {"label": "Рассказать о направлениях", "to": "directions"}, {"label": "Подобрать время", "to": "day"}]}, {"id": "obj_no_money", "title": "Нет денег", "group": "objection", "text": {"ru": "Наше пробное занятие и скидка специально созданы, чтобы быть доступными для всех. Это отличный шанс попробовать что-то новое **без больших затрат**. Кроме того, мы можем обсудить гибкие варианты оплаты или персонализированный план.\n\nВозможно, вы поймёте, что это стоит своих денег и может стать важной частью вашей жизни.\n\n1) Давайте расскажу о студии?\nили\n2) Давайте расскажу вам о направлениях?\nили\n3) Давайте подберём удобное время для записи на пробное занятие?", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Рассказать о студии", "to": "about"}, {"label": "Рассказать о направлениях", "to": "directions"}, {"label": "Подобрать время", "to": "day"}]}, {"id": "obj_not_sure", "title": "Не уверена, что это моё", "group": "objection", "text": {"ru": "Пробное занятие — это отличная возможность **попробовать и оценить**, подходит ли вам студия растяжки. У нас профессиональные тренеры, которые помогут достичь ваших целей и составят программу тренировок специально для вас.\n\n1) Давайте расскажу о студии?\nили\n2) Давайте расскажу вам о направлениях?\nили\n3) Давайте подберём удобное время для записи на пробное занятие?", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Рассказать о студии", "to": "about"}, {"label": "Рассказать о направлениях", "to": "directions"}, {"label": "Подобрать время", "to": "day"}]}, {"id": "obj_no_request", "title": "Не оставлял(а) заявку", "group": "objection", "text": {"ru": "Давайте я вам расскажу про нашу студию:\n\nУ нас специализированная женская фитнес-студия для девушек любого возраста и уровня подготовки. Тренировки проходят в мини-группах, тренер помогает и следит за техникой в каждом упражнении — это позволяет достичь видимых результатов в короткие сроки.\n\n1) Давайте расскажу о студии?\nили\n2) Давайте расскажу вам о направлениях?\nили\n3) Давайте подберём удобное время для записи на пробное занятие?", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Рассказать о студии", "to": "about"}, {"label": "Рассказать о направлениях", "to": "directions"}, {"label": "Подобрать время", "to": "day"}]}, {"id": "obj_far", "title": "Далеко", "group": "objection", "text": {"ru": "Мы через несколько месяцев будем открывать ещё одну студию — может, вам будет удобнее ездить до неё. А сейчас можете прийти к нам, познакомиться с тренерами, почувствовать атмосферу и решить, подходят ли вам наши тренировки.\n\nДалее по одному абонементу можно будет ходить во **все наши студии** на любое направление.\n\n1) Давайте расскажу о студии?\nили\n2) Давайте расскажу вам о направлениях?\nили\n3) Давайте подберём удобное время для записи на пробное занятие?", "en": "", "ka": ""}, "hint": "", "client": "", "answers": [{"label": "Рассказать о студии", "to": "about"}, {"label": "Рассказать о направлениях", "to": "directions"}, {"label": "Подобрать время", "to": "day"}]}]}, "flow_updated_by": "перенесено из документа", "flow_change_note": "Перенесено из документа «Скрипт — ЗВОНОК»"}]}$json$::jsonb);
end;
$seed$;

-- Названия студий по умолчанию; подпись «кто сохранил» не ставим.
select set_config('scripts.skip_journal', 'on', true);
insert into public.scripts_settings (id, data)
values (true, $json${"studios": [{"name": "Ваке", "ru": "Ваке", "en": "Vake", "ka": "ვაკე"}, {"name": "Сабуртало", "ru": "Сабуртало", "en": "Saburtalo", "ka": "საბურთალო"}], "admins": {}, "variables": []}$json$::jsonb)
on conflict (id) do nothing;
select set_config('scripts.skip_journal', 'off', true);

notify pgrst, 'reload schema';
