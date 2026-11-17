-- CRM, этап 1 — ядро (решение владельца 2026-11-17: своя CRM вместо amoCRM;
-- план и решения — CRM.md). Воронки и этапы общие на всю сеть, сделка —
-- клуба (или без клуба, пока не выбрали). Каналов (мессенджеров) и
-- автоматизаций здесь ещё нет — этапы 2+.
--
-- Права (каталог «Пользователей и ролей», сеть):
--   crm.view   — раздел CRM: сделки своих клубов и сделки без клуба
--                (администратор видит все сделки клуба, не только свои);
--   crm.manage — воронки, этапы, причины отказа; видит сделки всех клубов.
-- Вне модели прав (нет строки access_user_rights) — владелец клуба.
--
-- Таблицы:
--   crm_pipelines     — воронки (порядок, архив);
--   crm_stages        — этапы: open / won / lost; у воронки ровно один won
--                       и один lost (заводит триггер, удалить нельзя);
--   crm_loss_reasons  — причины отказа;
--   crm_contacts      — человек в CRM; client_id — карточка клиента портала
--                       (ставится сама по телефону или почте, если совпала
--                       ровно одна карточка);
--   crm_deals         — сделки;
--   crm_deal_events   — лента сделки: комментарии сотрудников (note) и
--                       события (создана, этап, ответственный, воронка,
--                       задача) — события пишут только триггеры;
--   crm_tasks         — задачи по сделке (вручную; auto — этап 3).
-- RPC: crm_people (кого можно назначить ответственным),
--      crm_pipelines_reorder, crm_stages_reorder, crm_stage_delete
--      (удалить этап с переносом его сделок).

-- 1) Права ------------------------------------------------------------------------
insert into public.access_permissions (key, block, label, hint, scope, levels, target, sort_order) values
  ('crm.view', 'sections', 'CRM: сделки',
   'Раздел CRM: воронки, сделки своих клубов и сделки без клуба, комментарии и задачи.',
   'network', '{on}', null, 140),
  ('crm.manage', 'sections', 'CRM: настройка',
   'Воронки, этапы и причины отказа; видит сделки всех клубов.',
   'network', '{on}', null, 141)
on conflict (key) do update
  set block = excluded.block, label = excluded.label, hint = excluded.hint, scope = excluded.scope,
      levels = excluded.levels, target = excluded.target, sort_order = excluded.sort_order;

create or replace function public.crm_has(_user_id uuid, _right text)
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
revoke all on function public.crm_has(uuid, text) from public, anon;
grant execute on function public.crm_has(uuid, text) to authenticated, service_role;

-- Для политик — один раз на запрос: `(select auth_crm_can_view())`.
create or replace function public.auth_crm_can_manage()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.crm_has(auth.uid(), 'crm.manage');
end;
$$;

create or replace function public.auth_crm_can_view()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.crm_has(auth.uid(), 'crm.view') or public.crm_has(auth.uid(), 'crm.manage');
end;
$$;

-- Клубы, сделки которых видит вызывающий: свои; с crm.manage — все.
create or replace function public.auth_crm_studio_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.crm_has(auth.uid(), 'crm.manage') then
    return (select coalesce(array_agg(id), '{}'::uuid[]) from public.studios);
  end if;
  if not public.crm_has(auth.uid(), 'crm.view') then
    return '{}'::uuid[];
  end if;
  return public.auth_staff_studio_ids();
end;
$$;

revoke all on function public.auth_crm_can_manage(), public.auth_crm_can_view(),
  public.auth_crm_studio_ids() from public, anon;
grant execute on function public.auth_crm_can_manage(), public.auth_crm_can_view(),
  public.auth_crm_studio_ids() to authenticated, service_role;

-- 2) Таблицы ----------------------------------------------------------------------
create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  color text not null default '#94a3b8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists crm_stages_pipeline_idx on public.crm_stages (pipeline_id, sort_order);
create unique index if not exists crm_stages_closing_uidx
  on public.crm_stages (pipeline_id, kind) where kind <> 'open';

create table if not exists public.crm_loss_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 200),
  client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists crm_contacts_client_idx on public.crm_contacts (client_id);
create index if not exists crm_contacts_phone_idx
  on public.crm_contacts (public.client_phone_key(phone));

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  pipeline_id uuid not null references public.crm_pipelines(id) on delete restrict,
  stage_id uuid not null references public.crm_stages(id) on delete restrict,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  studio_id uuid references public.studios(id) on delete set null,
  responsible_id uuid references auth.users(id) on delete set null,
  budget numeric(12, 2) check (budget is null or budget >= 0),
  source text check (source is null or char_length(source) <= 120),
  tags text[] not null default '{}',
  loss_reason_id uuid references public.crm_loss_reasons(id) on delete set null,
  stage_entered_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists crm_deals_pipeline_idx on public.crm_deals (pipeline_id, stage_id);
create index if not exists crm_deals_contact_idx on public.crm_deals (contact_id);
create index if not exists crm_deals_studio_idx on public.crm_deals (studio_id);
create index if not exists crm_deals_responsible_idx on public.crm_deals (responsible_id);

create table if not exists public.crm_deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  -- note — комментарий сотрудника; остальное пишут триггеры.
  kind text not null default 'note'
    check (kind in ('note', 'created', 'stage', 'pipeline', 'responsible', 'task_done')),
  body text check (body is null or char_length(body) <= 10000),
  meta jsonb not null default '{}',
  author_id uuid references auth.users(id) on delete set null,
  -- Снимок имени: профили сотрудников других клубов RLS не отдаёт.
  author_name text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists crm_deal_events_deal_idx on public.crm_deal_events (deal_id, created_at);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  due_at timestamptz not null,
  assignee_id uuid references auth.users(id) on delete set null,
  -- Поставлена автоматизацией этапа (этап 3), а не вручную.
  auto boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists crm_tasks_deal_idx on public.crm_tasks (deal_id);
create index if not exists crm_tasks_open_idx on public.crm_tasks (assignee_id, due_at) where done_at is null;

-- 3) Триггеры ---------------------------------------------------------------------
-- Имя сотрудника для подписей ленты: своё — любому, чужое — разделу CRM.
create or replace function public.crm_profile_name(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(full_name), '') from public.profiles
   where id = _user_id
     and (current_user not in ('authenticated', 'anon')
          or _user_id = auth.uid() or public.auth_crm_can_view())
$$;
revoke all on function public.crm_profile_name(uuid) from public, anon;
grant execute on function public.crm_profile_name(uuid) to authenticated, service_role;

-- Воронка: имя, автор; новой — закрывающие этапы.
create or replace function public.crm_pipelines_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.sort_order = 0 then
      new.sort_order := coalesce((select max(sort_order) from public.crm_pipelines), 0) + 1;
    end if;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_pipelines_biu on public.crm_pipelines;
create trigger crm_pipelines_biu before insert or update on public.crm_pipelines
  for each row execute function public.crm_pipelines_biu();

create or replace function public.crm_pipelines_ai()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_stages (pipeline_id, name, color, kind, sort_order) values
    (new.id, 'Успешно реализовано', '#16a34a', 'won', 10000),
    (new.id, 'Закрыто и не реализовано', '#64748b', 'lost', 10001)
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists crm_pipelines_ai on public.crm_pipelines;
create trigger crm_pipelines_ai after insert on public.crm_pipelines
  for each row execute function public.crm_pipelines_ai();

-- Этап: вид и воронка не меняются; закрывающий не удаляется (кроме удаления
-- воронки целиком — тогда её строки уже нет).
create or replace function public.crm_stages_biud()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind <> 'open' and exists (select 1 from public.crm_pipelines where id = old.pipeline_id) then
      raise exception using errcode = '23514',
        message = 'Этапы «Успешно» и «Не реализовано» удалить нельзя';
    end if;
    return old;
  end if;
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    if new.kind <> old.kind or new.pipeline_id <> old.pipeline_id then
      raise exception using errcode = '23514',
        message = 'Вид этапа и его воронку изменить нельзя';
    end if;
    new.created_at := old.created_at;
  elsif new.kind = 'open' and new.sort_order = 0 then
    new.sort_order := coalesce((select max(sort_order) from public.crm_stages
                                 where pipeline_id = new.pipeline_id and kind = 'open'), 0) + 1;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_stages_biud on public.crm_stages;
create trigger crm_stages_biud before insert or update or delete on public.crm_stages
  for each row execute function public.crm_stages_biud();

-- Контакт: чистка полей, связь с карточкой клиента по телефону или почте
-- (только если совпала ровно одна карточка). security definer — карточки
-- других клубов сотруднику не видны.
create or replace function public.crm_contacts_biu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_ids uuid[];
begin
  new.name := btrim(new.name);
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  if new.client_id is null
     and (tg_op = 'INSERT' or new.phone is distinct from old.phone or new.email is distinct from old.email) then
    v_key := public.client_phone_key(new.phone);
    select array_agg(id) into v_ids from (
      select c.id from public.clients c
       where (v_key is not null
              and (public.client_phone_key(c.phone) = v_key or public.client_phone_key(c.phone2) = v_key))
          or (new.email is not null and lower(btrim(c.email)) = new.email)
       limit 2) x;
    if array_length(v_ids, 1) = 1 then
      new.client_id := v_ids[1];
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_contacts_biu on public.crm_contacts;
create trigger crm_contacts_biu before insert or update on public.crm_contacts
  for each row execute function public.crm_contacts_biu();

-- Сделка: этап — своей воронки (сменили воронку без этапа — в её первый
-- этап), вход в этап и закрытие — по часам базы, причина отказа — только у
-- проигранной.
create or replace function public.crm_deals_biu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage public.crm_stages;
begin
  new.title := btrim(new.title);
  new.source := nullif(btrim(coalesce(new.source, '')), '');
  new.tags := coalesce((select array_agg(distinct t order by t)
                          from (select nullif(btrim(x), '') as t from unnest(new.tags) x) s
                         where t is not null), '{}');
  select * into v_stage from public.crm_stages where id = new.stage_id;
  if v_stage.id is null or v_stage.pipeline_id <> new.pipeline_id then
    select * into v_stage from public.crm_stages
     where pipeline_id = new.pipeline_id
     order by (kind = 'open') desc, sort_order, created_at limit 1;
    if v_stage.id is null then
      raise exception 'crm_pipeline_not_found' using errcode = '23503';
    end if;
    new.stage_id := v_stage.id;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.stage_entered_at := now();
    new.closed_at := case when v_stage.kind = 'open' then null else now() end;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if new.stage_id <> old.stage_id then
      new.stage_entered_at := now();
      new.closed_at := case when v_stage.kind = 'open' then null else now() end;
    else
      new.stage_entered_at := old.stage_entered_at;
      new.closed_at := old.closed_at;
    end if;
  end if;
  if v_stage.kind <> 'lost' then
    new.loss_reason_id := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists crm_deals_biu on public.crm_deals;
create trigger crm_deals_biu before insert or update on public.crm_deals
  for each row execute function public.crm_deals_biu();

-- События сделки в ленту.
create or replace function public.crm_deals_log_aiu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.crm_profile_name(auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.crm_deal_events (deal_id, kind, meta, author_id, author_name)
    values (new.id, 'created',
            jsonb_build_object('stage', (select name from public.crm_stages where id = new.stage_id)),
            auth.uid(), v_name);
    return null;
  end if;
  if new.pipeline_id <> old.pipeline_id then
    insert into public.crm_deal_events (deal_id, kind, meta, author_id, author_name)
    values (new.id, 'pipeline', jsonb_build_object(
              'from', (select name from public.crm_pipelines where id = old.pipeline_id),
              'to', (select name from public.crm_pipelines where id = new.pipeline_id),
              'stage', (select name from public.crm_stages where id = new.stage_id)),
            auth.uid(), v_name);
  elsif new.stage_id <> old.stage_id then
    insert into public.crm_deal_events (deal_id, kind, meta, author_id, author_name)
    values (new.id, 'stage', jsonb_build_object(
              'from', (select name from public.crm_stages where id = old.stage_id),
              'to', (select name from public.crm_stages where id = new.stage_id),
              'to_kind', (select kind from public.crm_stages where id = new.stage_id),
              'reason', (select name from public.crm_loss_reasons where id = new.loss_reason_id)),
            auth.uid(), v_name);
  end if;
  if new.responsible_id is distinct from old.responsible_id then
    insert into public.crm_deal_events (deal_id, kind, meta, author_id, author_name)
    values (new.id, 'responsible', jsonb_build_object(
              'from', public.crm_profile_name(old.responsible_id),
              'to', public.crm_profile_name(new.responsible_id)),
            auth.uid(), v_name);
  end if;
  return null;
end;
$$;
drop trigger if exists crm_deals_log_aiu on public.crm_deals;
create trigger crm_deals_log_aiu after insert or update on public.crm_deals
  for each row execute function public.crm_deals_log_aiu();

-- Комментарий: автор и время — база; правится только текст. Без security
-- definer: current_user — роль вызывающего (сотрудник пишет только note,
-- события пишут триггеры владельца базы).
create or replace function public.crm_deal_events_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Сотрудник пишет только комментарии; события — триггеры (владелец базы).
    if current_user in ('authenticated', 'anon') then
      new.kind := 'note';
      new.meta := '{}';
      new.author_id := auth.uid();
      new.author_name := public.crm_profile_name(auth.uid());
    end if;
    new.created_at := now();
    new.edited_at := null;
    new.body := nullif(btrim(coalesce(new.body, '')), '');
    if new.kind = 'note' and new.body is null then
      raise exception using errcode = '23514', message = 'Комментарий пуст';
    end if;
    return new;
  end if;
  new.deal_id := old.deal_id;
  new.kind := old.kind;
  new.meta := old.meta;
  new.author_id := old.author_id;
  new.author_name := old.author_name;
  new.created_at := old.created_at;
  new.body := nullif(btrim(coalesce(new.body, '')), '');
  if new.body is null then
    raise exception using errcode = '23514', message = 'Комментарий пуст';
  end if;
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists crm_deal_events_biu on public.crm_deal_events;
create trigger crm_deal_events_biu before insert or update on public.crm_deal_events
  for each row execute function public.crm_deal_events_biu();

-- Задача: автор, кто и когда выполнил. Без security definer: auto ставит
-- только сервер (автоматизации этапа), сотрудник — нет.
create or replace function public.crm_tasks_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.title := btrim(new.title);
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if current_user in ('authenticated', 'anon') then
      new.auto := false;
    end if;
    if new.assignee_id is null then
      new.assignee_id := coalesce(
        (select responsible_id from public.crm_deals where id = new.deal_id), auth.uid());
    end if;
    if new.done_at is not null then
      new.done_at := now();
      new.done_by := auth.uid();
    end if;
    return new;
  end if;
  new.deal_id := old.deal_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.auto := old.auto;
  if new.done_at is not null and old.done_at is null then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.done_at is null then
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_tasks_biu on public.crm_tasks;
create trigger crm_tasks_biu before insert or update on public.crm_tasks
  for each row execute function public.crm_tasks_biu();

-- Выполненная задача — событием в ленту (пишет владелец базы).
create or replace function public.crm_tasks_done_au()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.done_at is not null and old.done_at is null then
    insert into public.crm_deal_events (deal_id, kind, body, author_id, author_name)
    values (new.deal_id, 'task_done', new.title, auth.uid(), public.crm_profile_name(auth.uid()));
  end if;
  return null;
end;
$$;
drop trigger if exists crm_tasks_done_au on public.crm_tasks;
create trigger crm_tasks_done_au after update on public.crm_tasks
  for each row execute function public.crm_tasks_done_au();

-- 4) RLS --------------------------------------------------------------------------
alter table public.crm_pipelines enable row level security;
alter table public.crm_stages enable row level security;
alter table public.crm_loss_reasons enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_deal_events enable row level security;
alter table public.crm_tasks enable row level security;

grant select, insert, update, delete on public.crm_pipelines, public.crm_stages,
  public.crm_loss_reasons, public.crm_contacts, public.crm_deals, public.crm_deal_events,
  public.crm_tasks to authenticated, service_role;

-- Справочники: читает раздел, правит настройка.
drop policy if exists "crm_pipelines read" on public.crm_pipelines;
create policy "crm_pipelines read" on public.crm_pipelines for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_pipelines manage" on public.crm_pipelines;
create policy "crm_pipelines manage" on public.crm_pipelines for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

drop policy if exists "crm_stages read" on public.crm_stages;
create policy "crm_stages read" on public.crm_stages for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_stages manage" on public.crm_stages;
create policy "crm_stages manage" on public.crm_stages for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

drop policy if exists "crm_loss_reasons read" on public.crm_loss_reasons;
create policy "crm_loss_reasons read" on public.crm_loss_reasons for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_loss_reasons manage" on public.crm_loss_reasons;
create policy "crm_loss_reasons manage" on public.crm_loss_reasons for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

-- Контакты — общие для раздела (человек может писать в любой клуб).
drop policy if exists "crm_contacts read" on public.crm_contacts;
create policy "crm_contacts read" on public.crm_contacts for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_contacts insert" on public.crm_contacts;
create policy "crm_contacts insert" on public.crm_contacts for insert to authenticated
  with check ((select public.auth_crm_can_view()));
drop policy if exists "crm_contacts update" on public.crm_contacts;
create policy "crm_contacts update" on public.crm_contacts for update to authenticated
  using ((select public.auth_crm_can_view())) with check ((select public.auth_crm_can_view()));
drop policy if exists "crm_contacts delete" on public.crm_contacts;
create policy "crm_contacts delete" on public.crm_contacts for delete to authenticated
  using ((select public.auth_crm_can_manage()));

-- Сделки: своих клубов и без клуба.
drop policy if exists "crm_deals read" on public.crm_deals;
create policy "crm_deals read" on public.crm_deals for select to authenticated
  using ((select public.auth_crm_can_view())
         and (studio_id is null or studio_id = any ((select public.auth_crm_studio_ids())::uuid[])));
drop policy if exists "crm_deals insert" on public.crm_deals;
create policy "crm_deals insert" on public.crm_deals for insert to authenticated
  with check ((select public.auth_crm_can_view())
              and (studio_id is null or studio_id = any ((select public.auth_crm_studio_ids())::uuid[])));
drop policy if exists "crm_deals update" on public.crm_deals;
create policy "crm_deals update" on public.crm_deals for update to authenticated
  using ((select public.auth_crm_can_view())
         and (studio_id is null or studio_id = any ((select public.auth_crm_studio_ids())::uuid[])))
  with check ((select public.auth_crm_can_view())
              and (studio_id is null or studio_id = any ((select public.auth_crm_studio_ids())::uuid[])));
drop policy if exists "crm_deals delete" on public.crm_deals;
create policy "crm_deals delete" on public.crm_deals for delete to authenticated
  using ((select public.auth_crm_can_manage()));

-- Лента и задачи — по видимости сделки (подзапрос идёт под RLS сделок).
drop policy if exists "crm_deal_events read" on public.crm_deal_events;
create policy "crm_deal_events read" on public.crm_deal_events for select to authenticated
  using (exists (select 1 from public.crm_deals d where d.id = deal_id));
drop policy if exists "crm_deal_events insert" on public.crm_deal_events;
create policy "crm_deal_events insert" on public.crm_deal_events for insert to authenticated
  with check (exists (select 1 from public.crm_deals d where d.id = deal_id));
-- Править и удалять — свой комментарий.
drop policy if exists "crm_deal_events update" on public.crm_deal_events;
create policy "crm_deal_events update" on public.crm_deal_events for update to authenticated
  using (kind = 'note' and author_id = (select auth.uid())
         and exists (select 1 from public.crm_deals d where d.id = deal_id));
drop policy if exists "crm_deal_events delete" on public.crm_deal_events;
create policy "crm_deal_events delete" on public.crm_deal_events for delete to authenticated
  using (kind = 'note' and author_id = (select auth.uid())
         and exists (select 1 from public.crm_deals d where d.id = deal_id));

drop policy if exists "crm_tasks all" on public.crm_tasks;
create policy "crm_tasks all" on public.crm_tasks for all to authenticated
  using (exists (select 1 from public.crm_deals d where d.id = deal_id))
  with check (exists (select 1 from public.crm_deals d where d.id = deal_id));

-- 5) RPC --------------------------------------------------------------------------
-- Кого можно назначить ответственным: люди с правами CRM.
create or replace function public.crm_people()
returns table (id uuid, full_name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.auth_crm_can_view() then
    return;
  end if;
  return query
  select p.id, nullif(btrim(p.full_name), ''), p.avatar_url
    from public.profiles p
   where p.id in (
           select r.user_id from public.access_user_rights r
            where r.portal and r.rights && array['crm.view', 'crm.manage']
           union
           select ur.user_id from public.user_roles ur
            where ur.role = 'owner'
              and not exists (select 1 from public.access_user_rights r where r.user_id = ur.user_id))
   order by 2 nulls last;
end;
$$;
revoke all on function public.crm_people() from public, anon;
grant execute on function public.crm_people() to authenticated;

create or replace function public.crm_pipelines_reorder(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.auth_crm_can_manage() then
    raise exception 'crm_forbidden' using errcode = '42501';
  end if;
  update public.crm_pipelines p set sort_order = x.ord
    from unnest(p_ids) with ordinality as x(id, ord)
   where p.id = x.id;
end;
$$;
revoke all on function public.crm_pipelines_reorder(uuid[]) from public, anon;
grant execute on function public.crm_pipelines_reorder(uuid[]) to authenticated;

-- Порядок обычных этапов воронки; закрывающие всегда в конце.
create or replace function public.crm_stages_reorder(p_pipeline uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.auth_crm_can_manage() then
    raise exception 'crm_forbidden' using errcode = '42501';
  end if;
  update public.crm_stages s set sort_order = x.ord
    from unnest(p_ids) with ordinality as x(id, ord)
   where s.id = x.id and s.pipeline_id = p_pipeline and s.kind = 'open';
end;
$$;
revoke all on function public.crm_stages_reorder(uuid, uuid[]) from public, anon;
grant execute on function public.crm_stages_reorder(uuid, uuid[]) to authenticated;

-- Удалить этап: его сделки переходят в p_move_to (этап той же воронки).
create or replace function public.crm_stage_delete(p_stage uuid, p_move_to uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage public.crm_stages;
  v_moved integer := 0;
begin
  if not public.auth_crm_can_manage() then
    raise exception 'crm_forbidden' using errcode = '42501';
  end if;
  select * into v_stage from public.crm_stages where id = p_stage;
  if v_stage.id is null then
    return 0;
  end if;
  if exists (select 1 from public.crm_deals where stage_id = p_stage) then
    if p_move_to is null or p_move_to = p_stage or not exists (
         select 1 from public.crm_stages where id = p_move_to and pipeline_id = v_stage.pipeline_id) then
      raise exception using errcode = '23503',
        message = 'В этапе есть сделки — выберите этап, куда их перенести';
    end if;
    update public.crm_deals set stage_id = p_move_to where stage_id = p_stage;
    get diagnostics v_moved = row_count;
  end if;
  delete from public.crm_stages where id = p_stage;
  return v_moved;
end;
$$;
revoke all on function public.crm_stage_delete(uuid, uuid) from public, anon;
grant execute on function public.crm_stage_delete(uuid, uuid) to authenticated;

-- 6) Стартовый набор --------------------------------------------------------------
-- Одна воронка, чтобы раздел не открывался пустым; названия и этапы правятся
-- в «Настройках» CRM.
do $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.crm_pipelines) then
    insert into public.crm_pipelines (name, sort_order) values ('Продажи', 1) returning id into v_id;
    insert into public.crm_stages (pipeline_id, name, color, sort_order) values
      (v_id, 'Новое обращение', '#38bdf8', 1),
      (v_id, 'В работе', '#818cf8', 2),
      (v_id, 'Записан на пробное', '#f59e0b', 3),
      (v_id, 'Был на пробном', '#f472b6', 4),
      (v_id, 'Думает', '#a3a3a3', 5);
  end if;
  if not exists (select 1 from public.crm_loss_reasons) then
    insert into public.crm_loss_reasons (name, sort_order) values
      ('Дорого', 1), ('Не подошло расписание', 2), ('Далеко', 3),
      ('Перестал отвечать', 4), ('Выбрал другую студию', 5), ('Другое', 6);
  end if;
end;
$$;

select public.access_seed_role('crm_manager', 'Менеджер CRM',
  'Раздел CRM: сделки своих клубов, комментарии и задачи.', '#0ea5e9', 97, false,
  array['crm.view']);

-- Суперадминистраторам новые сетевые права — сразу (portal.admin раскрыт во все).
do $$
declare
  v_uid uuid;
begin
  for v_uid in select user_id from public.access_user_rights where 'portal.admin' = any (rights) loop
    perform public.access_compile(v_uid);
  end loop;
end;
$$;
