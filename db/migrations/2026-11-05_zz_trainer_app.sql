-- ============================================================================
-- Тренер в мобильном приложении (решение владельца 2026-11-05; пакетное
-- приложение Lady Stretch).
--
-- 1) app_trainer_links — «этот пользователь приложения — тренер»: карточка
--    клиента (client_id, по ней учётная запись приложения clients.user_id)
--    ↔ тренер справочника (trainers.id). Ставят сотрудники клубов, которым
--    видна карточка (админка: карточка клиента → вкладка «Приложение» →
--    «Тренер»). Одна карточка — один тренер, один тренер — одна карточка.
--    Всё тренерское в приложении — только тем, у кого есть такая строка:
--    RPC ниже сами проверяют вызывающего (security definer), без строки —
--    пусто или ошибка trainer_only.
-- 2) RPC приложения (только своё): trainer_app_me (я тренер?),
--    trainer_my_entries (мои ближайшие групповые занятия — «Моё
--    расписание»), trainer_entry_clients (кто записан: пробные первыми,
--    главная цель, есть ли ограничения по здоровью, сводка комментариев
--    тренеров), trainer_client_profile (анкета клиента — только если он
--    записан на занятие этого тренера), trainer_client_comments /
--    trainer_add_comment (комментарии тренеров).
-- 3) trainer_comments — комментарии тренеров о клиенте: лента с автором
--    (тренер, имя — снимок) и временем. Пишет только trainer_add_comment;
--    сотрудники клубов карточки читают (админка: вкладка «Анкета» →
--    «Комментарии тренеров»), в таблицы админки не выводятся.
-- 4) Пуши тренерам (push_triggers, только пакетное приложение): занятие
--    отменено (trainer_class_cancelled), вас заменили (trainer_replaced),
--    вы на замене (trainer_substitute). Срабатывают сразу — триггеры на
--    отмену занятия (schedule_entries.cancelled_at) и на замену
--    (schedule_entry_substitutions), только у будущих занятий; уходят через
--    ту же очередь, что и остальные (push_trigger_send) — пуш на телефон и
--    строка в ленте «Уведомления». Тексты правятся в админке («Триггеры»).
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

-- 1. Связь «пользователь приложения — тренер» ---------------------------------------

create table if not exists public.app_trainer_links (
  client_id uuid primary key references public.clients(id) on delete cascade,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists app_trainer_links_trainer_key
  on public.app_trainer_links (trainer_id);

comment on table public.app_trainer_links is
  'Пользователь мобильного приложения — тренер: карточка клиента ↔ тренер справочника (2026-11-05_zz_trainer_app.sql).';

alter table public.app_trainer_links enable row level security;
revoke all on public.app_trainer_links from public, anon, authenticated;
grant select, insert, update, delete on public.app_trainer_links to authenticated;
grant all on public.app_trainer_links to service_role;

-- Сотрудники клубов, которым видна карточка (у пакетных — вся сеть).
drop policy if exists "app_trainer_links staff" on public.app_trainer_links;
create policy "app_trainer_links staff" on public.app_trainer_links
  for all to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = app_trainer_links.client_id
       and c.studio_id = any ((select public.auth_network_studio_ids())::uuid[])))
  with check (exists (
    select 1 from public.clients c
     where c.id = app_trainer_links.client_id
       and c.studio_id = any ((select public.auth_network_studio_ids())::uuid[])));

create or replace function public.app_trainer_links_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists app_trainer_links_biu on public.app_trainer_links;
create trigger app_trainer_links_biu
  before insert or update on public.app_trainer_links
  for each row execute function public.app_trainer_links_biu();

-- Тренер вызывающего (учётная запись приложения → карточка → тренер); нет — null.
create or replace function public.app_trainer_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.trainer_id
    from public.app_trainer_links l
    join public.clients c on c.id = l.client_id
   where p_user is not null and c.user_id = p_user
   order by l.created_at
   limit 1
$$;

revoke all on function public.app_trainer_of(uuid) from public, anon, authenticated;
grant execute on function public.app_trainer_of(uuid) to service_role;

-- Учётная запись приложения тренера (для пушей); нет — null.
create or replace function public.app_trainer_user(p_trainer uuid)
returns table (user_id uuid, client_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select c.user_id, c.id
    from public.app_trainer_links l
    join public.clients c on c.id = l.client_id
   where l.trainer_id = p_trainer and c.user_id is not null
   limit 1
$$;

revoke all on function public.app_trainer_user(uuid) from public, anon, authenticated;
grant execute on function public.app_trainer_user(uuid) to service_role;

-- 2. Комментарии тренеров ---------------------------------------------------------------

create table if not exists public.trainer_comments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  trainer_id uuid references public.trainers(id) on delete set null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trainer_comments_body_check') then
    alter table public.trainer_comments
      add constraint trainer_comments_body_check check (length(btrim(body)) between 1 and 4000);
  end if;
end $$;

create index if not exists trainer_comments_client_idx
  on public.trainer_comments (client_id, created_at desc);

comment on table public.trainer_comments is
  'Комментарии тренеров о клиенте из мобильного приложения (2026-11-05_zz_trainer_app.sql). Пишет только RPC trainer_add_comment.';

alter table public.trainer_comments enable row level security;
revoke all on public.trainer_comments from public, anon, authenticated;
grant select on public.trainer_comments to authenticated;
grant all on public.trainer_comments to service_role;

drop policy if exists "trainer_comments staff read" on public.trainer_comments;
create policy "trainer_comments staff read" on public.trainer_comments
  for select to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = trainer_comments.client_id
       and c.studio_id = any ((select public.auth_network_studio_ids())::uuid[])));

-- 3. RPC приложения ---------------------------------------------------------------------

-- Я тренер? Тренер справочника или null.
create or replace function public.trainer_app_me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'trainer_id', t.id,
           'full_name', t.full_name,
           'photo_url', t.photo_url,
           'translations', t.translations)
    from public.trainers t
   where t.id = public.app_trainer_of(auth.uid())
$$;

-- Мои ближайшие групповые занятия (ещё не закончились, не отменены), по
-- времени. Сами занятия приложение читает обычным запросом (RLS клиента
-- открывает групповые занятия студий сети).
create or replace function public.trainer_my_entries(p_offset integer default 0, p_limit integer default 6)
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
     and e.kind = 'group'
     and e.cancelled_at is null
     and e.ends_at > now()
   order by e.starts_at, e.id
  offset greatest(coalesce(p_offset, 0), 0)
   limit least(greatest(coalesce(p_limit, 6), 1), 50)
$$;

-- Занятие ведёт вызывающий тренер (бросает trainer_only).
create or replace function public.trainer_check_entry(p_entry uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trainer uuid := public.app_trainer_of(auth.uid());
begin
  if v_trainer is null or not exists (
    select 1 from public.schedule_entry_trainers et
     where et.entry_id = p_entry and et.trainer_id = v_trainer
  ) then
    raise exception 'trainer_only' using errcode = '42501';
  end if;
  return v_trainer;
end;
$$;

revoke all on function public.trainer_check_entry(uuid) from public, anon, authenticated;

-- Клиент записан на занятие вызывающего тренера (любое, кроме отменённой записи).
create or replace function public.trainer_check_client(p_client uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trainer uuid := public.app_trainer_of(auth.uid());
begin
  if v_trainer is null or not exists (
    select 1
      from public.schedule_bookings b
      join public.schedule_entry_trainers et on et.entry_id = b.entry_id
     where b.client_id = p_client
       and et.trainer_id = v_trainer
       and b.status <> 'cancelled'
  ) then
    raise exception 'trainer_only' using errcode = '42501';
  end if;
  return v_trainer;
end;
$$;

revoke all on function public.trainer_check_client(uuid) from public, anon, authenticated;

-- Есть ограничения по здоровью: отмечено что-то, кроме «Ничего из
-- перечисленного», или написан комментарий.
create or replace function public.trainer_has_restrictions(p_flags text[], p_notes text)
returns boolean
language sql
immutable
as $$
  select exists (select 1 from unnest(coalesce(p_flags, '{}'::text[])) f where f <> 'none')
      or coalesce(btrim(p_notes), '') <> ''
$$;

-- Кто записан на занятие: пробные первыми, потом по имени.
create or replace function public.trainer_entry_clients(p_entry uuid)
returns table (
  client_id uuid,
  first_name text,
  last_name text,
  full_name text,
  photo_url text,
  status text,
  is_trial boolean,
  primary_goal text,
  goal_other text,
  has_restrictions boolean,
  comments_count integer,
  last_comment_at timestamptz,
  last_comment_author text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.trainer_check_entry(p_entry);
  return query
  with rows as (
    select c.id, c.first_name, c.last_name, c.full_name, c.photo_url, b.status::text as status,
           (coalesce(
              (select m.kind from public.client_memberships cm
                 join public.memberships m on m.id = cm.membership_id
                where cm.id = b.charged_membership_id),
              (select m.kind from public.client_memberships cm
                 join public.memberships m on m.id = cm.membership_id
                where cm.client_id = c.id
                  and cm.status in ('active', 'frozen')
                  and coalesce(cm.balance_kind, 'group') = 'group'
                order by cm.started_at nulls last, cm.created_at
                limit 1)
            ) = 'trial') as trial,
           p.primary_goal::text as goal, p.goal_other,
           public.trainer_has_restrictions(p.health_flags, p.health_notes) as restr
      from public.schedule_bookings b
      join public.clients c on c.id = b.client_id
      left join public.member_profiles p on p.user_id = c.user_id
     where b.entry_id = p_entry
       and b.status in ('booked', 'attended', 'no_show')
  )
  select r.id, r.first_name, r.last_name, r.full_name, r.photo_url, r.status,
         coalesce(r.trial, false), r.goal, r.goal_other, coalesce(r.restr, false),
         (select count(*)::int from public.trainer_comments tc where tc.client_id = r.id),
         lc.created_at, lc.author_name
    from rows r
    left join lateral (
      select tc.created_at, tc.author_name from public.trainer_comments tc
       where tc.client_id = r.id order by tc.created_at desc limit 1
    ) lc on true
   order by coalesce(r.trial, false) desc,
            coalesce(r.last_name, r.full_name, ''), coalesce(r.first_name, '');
end;
$$;

-- Анкета клиента — только записанного на занятие этого тренера. Медицинское
-- (ограничения) — здесь же: тренеру оно и нужно.
create or replace function public.trainer_client_profile(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.trainer_check_client(p_client);
  select jsonb_build_object(
           'client_id', c.id,
           'first_name', c.first_name,
           'last_name', c.last_name,
           'full_name', c.full_name,
           'photo_url', c.photo_url,
           'profile', case when p.user_id is null then null else jsonb_build_object(
             'primary_goal', p.primary_goal,
             'goal_other', p.goal_other,
             'goal_motivation', p.goal_motivation,
             'target_timeframe', p.target_timeframe,
             'desired_frequency', p.desired_frequency,
             'experience_level', p.experience_level,
             'current_weekly_activity', p.current_weekly_activity,
             'health_flags', p.health_flags,
             'health_notes', p.health_notes,
             'preferred_times', p.preferred_times,
             'weight_kg', p.weight_kg,
             'birth_date', p.birth_date,
             'birth_year', p.birth_year,
             'onboarding_completed_at', p.onboarding_completed_at) end)
    into v
    from public.clients c
    left join public.member_profiles p on p.user_id = c.user_id
   where c.id = p_client;
  return v;
end;
$$;

create or replace function public.trainer_client_comments(p_client uuid)
returns table (id uuid, body text, author_name text, trainer_id uuid, created_at timestamptz, mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trainer uuid;
begin
  v_trainer := public.trainer_check_client(p_client);
  return query
  select tc.id, tc.body, tc.author_name, tc.trainer_id, tc.created_at, tc.trainer_id = v_trainer
    from public.trainer_comments tc
   where tc.client_id = p_client
   order by tc.created_at desc
   limit 200;
end;
$$;

create or replace function public.trainer_add_comment(p_client uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trainer uuid;
  v_id uuid;
begin
  v_trainer := public.trainer_check_client(p_client);
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    raise exception 'comment_length' using errcode = '22023';
  end if;
  insert into public.trainer_comments (client_id, trainer_id, author_id, author_name, body)
  select p_client, v_trainer, auth.uid(), t.full_name, btrim(p_body)
    from public.trainers t where t.id = v_trainer
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.trainer_has_restrictions(text[], text) from public, anon;
revoke all on function public.trainer_app_me(), public.trainer_my_entries(integer, integer),
  public.trainer_entry_clients(uuid), public.trainer_client_profile(uuid),
  public.trainer_client_comments(uuid), public.trainer_add_comment(uuid, text)
  from public, anon;
grant execute on function public.trainer_app_me(), public.trainer_my_entries(integer, integer),
  public.trainer_entry_clients(uuid), public.trainer_client_profile(uuid),
  public.trainer_client_comments(uuid), public.trainer_add_comment(uuid, text)
  to authenticated, service_role;

-- 4. Пуши тренерам ----------------------------------------------------------------------

insert into public.push_triggers (format, key, title, message, translations, action_url, params)
select f.format, t.key, t.title, t.message, t.translations::jsonb, t.action_url, t.params::jsonb
  from (values ('packages')) as f(format)
  join (values
    ('trainer_class_cancelled', null,
     'Ваша тренировка отменена',
     '{name}, тренировка «{class}» {date} в {time} отменена.',
     '{"en": {"title": "Your class is cancelled", "message": "{name}, {class} on {date} at {time} has been cancelled."},
       "ka": {"title": "თქვენი ვარჯიში გაუქმდა", "message": "{name}, ვარჯიში „{class}“ {date}, {time} გაუქმდა."}}',
     '/', '{}'),
    ('trainer_replaced', null,
     'Вас заменили',
     '{name}, на тренировке «{class}» {date} в {time} вас заменит {substitute}.',
     '{"en": {"title": "You have been replaced", "message": "{name}, {substitute} will lead {class} on {date} at {time} instead of you."},
       "ka": {"title": "თქვენ შეგცვალეს", "message": "{name}, ვარჯიშს „{class}“ {date}, {time} თქვენ ნაცვლად ჩაატარებს {substitute}."}}',
     '/', '{}'),
    ('trainer_substitute', null,
     'Вы на замене',
     '{name}, вы проводите тренировку «{class}» {date} в {time} вместо {replaced}.',
     '{"en": {"title": "You are substituting", "message": "{name}, you are leading {class} on {date} at {time} instead of {replaced}."},
       "ka": {"title": "თქვენ ჩანაცვლებაზე ხართ", "message": "{name}, თქვენ ატარებთ ვარჯიშს „{class}“ {date}, {time} {replaced}-ის ნაცვლად."}}',
     '/', '{}')
  ) as t(key, _f, title, message, translations, action_url, params)
    on true
on conflict (format, key) do nothing;

-- Пуш тренеру о занятии: включён ли триггер, есть ли учётная запись
-- приложения, и сама отправка (повтор события — push_trigger_log).
create or replace function public.trainer_push(
  p_key text,
  p_trainer uuid,
  p_entry uuid,
  p_ref text,
  p_extra jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trigger public.push_triggers;
  v_user uuid;
  v_client uuid;
  v_studio uuid;
  v_vars jsonb;
  l text;
begin
  select * into v_trigger from public.push_triggers
   where format = 'packages' and key = p_key and enabled;
  if not found then
    return false;
  end if;
  select u.user_id, u.client_id into v_user, v_client from public.app_trainer_user(p_trainer) u;
  if v_user is null then
    return false;
  end if;
  select e.studio_id into v_studio from public.schedule_entries e where e.id = p_entry;
  v_vars := public.push_trigger_vars(v_client, v_studio, p_entry, null, null, '{}'::jsonb, now());
  -- Имена тренеров — на языке приложения (переводы справочника).
  foreach l in array array['ru', 'en', 'ka'] loop
    v_vars := jsonb_set(v_vars, array[l], (v_vars -> l) || coalesce(p_extra -> l, '{}'::jsonb));
  end loop;
  return public.push_trigger_send(v_trigger, v_user, v_studio, p_ref, v_vars);
end;
$$;

revoke all on function public.trainer_push(text, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Имя тренера на трёх языках: {"ru": {"<var>": …}, "en": …, "ka": …}.
create or replace function public.trainer_name_vars(p_trainer uuid, p_var text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'ru', jsonb_build_object(p_var, coalesce(t.full_name, '')),
           'en', jsonb_build_object(p_var, public.push_tr(t.translations, 'full_name', 'en', coalesce(t.full_name, ''))),
           'ka', jsonb_build_object(p_var, public.push_tr(t.translations, 'full_name', 'ka', coalesce(t.full_name, ''))))
    from public.trainers t where t.id = p_trainer
$$;

revoke all on function public.trainer_name_vars(uuid, text) from public, anon, authenticated;

-- Отмена будущего занятия → пуш каждому его тренеру с приложением.
create or replace function public.schedule_entries_trainer_cancel_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.cancelled_at is not null and old.cancelled_at is null and new.starts_at > now() then
    for r in select et.trainer_id from public.schedule_entry_trainers et where et.entry_id = new.id loop
      perform public.trainer_push('trainer_class_cancelled', r.trainer_id, new.id,
                                  new.id::text || ':' || new.cancelled_at::text);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists schedule_entries_trainer_cancel_push_au on public.schedule_entries;
create trigger schedule_entries_trainer_cancel_push_au
  after update of cancelled_at on public.schedule_entries
  for each row execute function public.schedule_entries_trainer_cancel_push();

-- Замена на будущем занятии → пуш заменённому и заменяющему.
create or replace function public.schedule_entry_substitutions_trainer_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := new.entry_id::text || ':' || new.replaced_trainer_id::text || ':' || new.trainer_id::text;
begin
  if not exists (
    select 1 from public.schedule_entries e
     where e.id = new.entry_id and e.starts_at > now() and e.cancelled_at is null
  ) then
    return null;
  end if;
  perform public.trainer_push('trainer_replaced', new.replaced_trainer_id, new.entry_id, v_ref,
                              public.trainer_name_vars(new.trainer_id, 'substitute'));
  perform public.trainer_push('trainer_substitute', new.trainer_id, new.entry_id, v_ref,
                              public.trainer_name_vars(new.replaced_trainer_id, 'replaced'));
  return null;
end;
$$;

drop trigger if exists schedule_entry_substitutions_trainer_push_ai on public.schedule_entry_substitutions;
create trigger schedule_entry_substitutions_trainer_push_ai
  after insert on public.schedule_entry_substitutions
  for each row execute function public.schedule_entry_substitutions_trainer_push();
