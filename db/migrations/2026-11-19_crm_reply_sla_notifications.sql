-- CRM: скорость ответа, уведомления менеджерам и отчёт по сотрудникам
-- (решение владельца 2026-11-19; CRM.md, «Скорость ответа и уведомления»).
--
-- 1) crm_settings (одна строка) — норматив ответа клиенту reply_sla_minutes,
--    через сколько звать руководителя escalate_minutes (null — не звать),
--    рабочие часы work_from–work_to (часы по Тбилиси). Время ожидания
--    считается в рабочее время: сообщение, пришедшее ночью, «начинает ждать»
--    с открытия (crm_work_start). Правит crm.manage.
-- 2) crm_conversations.waiting_since — с какого сообщения клиент ждёт ответа
--    (первое входящее после последнего ответа сотрудника; автоматическое
--    сообщение ответом не считается). Актуальное определение crm_messages_ai —
--    здесь.
-- 3) Уведомления менеджерам — пуш в браузер (Web Push теми же ключами VAPID,
--    что у клиентского приложения): crm_staff_push_subscriptions — браузеры
--    сотрудника (пишут RPC crm_push_subscribe / crm_push_unsubscribe),
--    crm_notifications — очередь. Что уведомлять, решает база
--    (crm_notifications_collect, service_role, раз в минуту):
--      task_due         — наступил срок задачи → исполнителю;
--      reply_wait       — клиент ждёт дольше норматива → ответственному сделки;
--      reply_escalation — ждёт дольше escalate_minutes → людям с crm.manage;
--      deal_assigned    — сделку назначили (не сам себе) → ответственному
--                         (триггер crm_deals_notify_aiu).
--    Уведомление заводится только тому, у кого есть подписка. Отправляет
--    сервер админки: crm_notifications_claim → пуш → crm_push_gone.
-- 4) crm_people_report(p_from, p_to, p_pipeline) — отчёт по сотрудникам:
--    сделки (в работе, получено, успешно, отказ), ответы клиентам (сколько,
--    медиана, доля в норматив), задачи (выполнено, из них с опозданием,
--    просрочено сейчас). security invoker — считает видимое вызывающему.

-- 1) Настройки ---------------------------------------------------------------------
create table if not exists public.crm_settings (
  id boolean primary key default true check (id),
  reply_sla_minutes integer not null default 15 check (reply_sla_minutes between 1 and 1440),
  escalate_minutes integer default 60 check (escalate_minutes is null or escalate_minutes between 1 and 10080),
  work_from smallint not null default 9 check (work_from between 0 and 23),
  work_to smallint not null default 21 check (work_to between 1 and 24),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint crm_settings_hours_check check (work_from < work_to)
);
insert into public.crm_settings (id) values (true) on conflict do nothing;

alter table public.crm_settings enable row level security;
grant select, update on public.crm_settings to authenticated;
grant all on public.crm_settings to service_role;
drop policy if exists "crm_settings read" on public.crm_settings;
create policy "crm_settings read" on public.crm_settings for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_settings manage" on public.crm_settings;
create policy "crm_settings manage" on public.crm_settings for update to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

create or replace function public.crm_settings_bu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists crm_settings_bu on public.crm_settings;
create trigger crm_settings_bu before update on public.crm_settings
  for each row execute function public.crm_settings_bu();

-- С какого момента сообщение «ждёт»: в рабочие часы — сразу, иначе с
-- ближайшего открытия (часы по Тбилиси).
create or replace function public.crm_work_start(_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from integer;
  v_to integer;
  v_local timestamp := _at at time zone 'Asia/Tbilisi';
  v_hour integer := extract(hour from v_local);
begin
  select work_from, work_to into v_from, v_to from public.crm_settings where id;
  v_from := coalesce(v_from, 9);
  v_to := coalesce(v_to, 21);
  if v_hour < v_from then
    return (date_trunc('day', v_local) + make_interval(hours => v_from)) at time zone 'Asia/Tbilisi';
  elsif v_hour >= v_to then
    return (date_trunc('day', v_local) + interval '1 day' + make_interval(hours => v_from))
           at time zone 'Asia/Tbilisi';
  end if;
  return _at;
end;
$$;
revoke all on function public.crm_work_start(timestamptz) from public, anon;
grant execute on function public.crm_work_start(timestamptz) to authenticated, service_role;

-- 2) С какого момента клиент ждёт ответа ---------------------------------------------
alter table public.crm_conversations add column if not exists waiting_since timestamptz;
create index if not exists crm_conversations_waiting_idx
  on public.crm_conversations (waiting_since) where waiting_since is not null;

create or replace function public.crm_messages_ai()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_conversations c
     set last_message_at = new.created_at,
         last_message_text = left(coalesce(nullif(btrim(new.body), ''),
           case when jsonb_array_length(new.attachments) > 0 then '📎 Вложение' else '' end), 300),
         last_direction = new.direction,
         last_inbound_at = case when new.direction = 'in' then new.created_at else c.last_inbound_at end,
         unread_count = case when new.direction = 'in' then c.unread_count + 1
                             when new.auto then c.unread_count
                             else 0 end
   where c.id = new.conversation_id
     and (c.last_message_at is null or c.last_message_at <= new.created_at);
  -- Сообщение пришло раньше последнего (повтор, история) — только счётчик.
  if not found and new.direction = 'in' then
    update public.crm_conversations set unread_count = unread_count + 1 where id = new.conversation_id;
  end if;
  -- Ожидание ответа: начинается с первого входящего, кончается ответом
  -- сотрудника (не автоматическим и не упавшим).
  if new.direction = 'in' then
    update public.crm_conversations set waiting_since = new.created_at
     where id = new.conversation_id and (waiting_since is null or waiting_since > new.created_at);
  elsif not new.auto and new.status <> 'failed' then
    update public.crm_conversations set waiting_since = null
     where id = new.conversation_id and waiting_since is not null and waiting_since <= new.created_at;
  end if;
  return null;
end;
$$;

-- Уже идущие диалоги: ждёт с первого входящего после последнего ответа.
update public.crm_conversations c
   set waiting_since = w.since
  from (select m.conversation_id, min(m.created_at) as since
          from public.crm_messages m
         where m.direction = 'in'
           and m.created_at > coalesce((
                 select max(o.created_at) from public.crm_messages o
                  where o.conversation_id = m.conversation_id and o.direction = 'out'
                    and not o.auto and o.status <> 'failed'), '-infinity'::timestamptz)
         group by m.conversation_id) w
 where w.conversation_id = c.id and c.waiting_since is null;

-- 3) Уведомления ---------------------------------------------------------------------
create table if not exists public.crm_staff_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 2000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_staff_push_subscriptions_user_idx
  on public.crm_staff_push_subscriptions (user_id);

create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('task_due', 'reply_wait', 'reply_escalation', 'deal_assigned')),
  title text not null,
  body text,
  url text,
  -- Одно событие — одно уведомление человеку.
  dedupe text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, dedupe)
);
create index if not exists crm_notifications_unsent_idx
  on public.crm_notifications (created_at) where sent_at is null;

-- Обе таблицы — только через RPC и сервер.
alter table public.crm_staff_push_subscriptions enable row level security;
alter table public.crm_notifications enable row level security;
revoke all on public.crm_staff_push_subscriptions, public.crm_notifications from public, anon, authenticated;
grant all on public.crm_staff_push_subscriptions, public.crm_notifications to service_role;

create or replace function public.crm_push_subscribe(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.auth_crm_can_view() then
    raise exception 'crm_forbidden' using errcode = '42501';
  end if;
  if not public.push_endpoint_allowed(p_endpoint) then
    raise exception 'bad_endpoint' using errcode = '22023';
  end if;
  -- До 10 браузеров на человека: лишние — самые старые.
  delete from public.crm_staff_push_subscriptions s
   where s.user_id = auth.uid() and s.endpoint <> p_endpoint
     and s.id not in (select x.id from public.crm_staff_push_subscriptions x
                       where x.user_id = auth.uid() and x.endpoint <> p_endpoint
                       order by x.updated_at desc limit 9);
  insert into public.crm_staff_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, updated_at = now();
end;
$$;
revoke all on function public.crm_push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.crm_push_subscribe(text, text, text, text) to authenticated;

create or replace function public.crm_push_unsubscribe(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.crm_staff_push_subscriptions
   where endpoint = p_endpoint and user_id = auth.uid()
$$;
revoke all on function public.crm_push_unsubscribe(text) from public, anon;
grant execute on function public.crm_push_unsubscribe(text) to authenticated;

-- Уведомление — только тому, у кого включены уведомления в браузере.
create or replace function public.crm_notify(
  _user uuid, _kind text, _title text, _body text, _url text, _dedupe text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.crm_notifications (user_id, kind, title, body, url, dedupe)
  select _user, _kind, left(_title, 200), left(_body, 500), _url, _dedupe
   where _user is not null
     and exists (select 1 from public.crm_staff_push_subscriptions s where s.user_id = _user)
  on conflict (user_id, dedupe) do nothing
$$;
revoke all on function public.crm_notify(uuid, text, text, text, text, text) from public, anon, authenticated;

-- Сделку назначили другому человеку (или распределение) — ему уведомление.
create or replace function public.crm_deals_notify_aiu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.responsible_id is null or new.closed_at is not null
     or new.responsible_id is not distinct from auth.uid() then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.responsible_id is not distinct from old.responsible_id then
    return null;
  end if;
  perform public.crm_notify(
    new.responsible_id, 'deal_assigned',
    case when tg_op = 'INSERT' then 'Новая сделка: ' else 'Вам передали сделку: ' end || new.title,
    nullif(concat_ws(' · ', new.source, (select name from public.studios where id = new.studio_id)), ''),
    '/crm?pipeline=' || new.pipeline_id::text || '&deal=' || new.id::text,
    'deal:' || new.id::text || ':' || extract(epoch from now())::bigint::text);
  return null;
end;
$$;
drop trigger if exists crm_deals_notify_aiu on public.crm_deals;
create trigger crm_deals_notify_aiu after insert or update of responsible_id on public.crm_deals
  for each row execute function public.crm_deals_notify_aiu();

-- Люди с правом «CRM: настройка» — руководители для эскалации.
create or replace function public.crm_manager_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id from public.access_user_rights r
   where r.portal and r.rights && array['crm.manage']
  union
  select ur.user_id from public.user_roles ur
   where ur.role = 'owner'
     and not exists (select 1 from public.access_user_rights r where r.user_id = ur.user_id)
$$;
revoke all on function public.crm_manager_ids() from public, anon, authenticated;

-- Что пора уведомить: сроки задач и ожидание ответа. Возвращает, сколько
-- уведомлений заведено.
create or replace function public.crm_notifications_collect(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.crm_settings;
  v_before bigint;
  v_working boolean;
begin
  select * into v_set from public.crm_settings where id;
  select count(*) into v_before from public.crm_notifications;
  delete from public.crm_notifications where created_at < p_now - interval '30 days';
  select count(*) into v_before from public.crm_notifications;

  -- Срок задачи наступил (перенесли срок — напомним заново).
  perform public.crm_notify(
            t.assignee_id, 'task_due', 'Задача: ' || t.title,
            nullif(concat_ws(' · ', d.title, t.note), ''),
            '/crm?pipeline=' || d.pipeline_id::text || '&deal=' || d.id::text,
            'task:' || t.id::text || ':' || extract(epoch from t.due_at)::bigint::text)
     from public.crm_tasks t
     join public.crm_deals d on d.id = t.deal_id
    where t.done_at is null and t.assignee_id is not null and d.closed_at is null
      and t.due_at <= p_now and t.due_at > p_now - interval '1 day';

  -- Ожидание ответа — только в рабочие часы.
  v_working := public.crm_work_start(p_now) = p_now;
  if v_working and v_set.id is not null then
    perform public.crm_notify(
              w.responsible_id, 'reply_wait', 'Клиент ждёт ответа: ' || w.contact_name,
              w.last_text, '/crm/inbox?c=' || w.id::text,
              'wait:' || w.id::text || ':' || extract(epoch from w.waiting_since)::bigint::text)
       from (select c.id, c.waiting_since, left(c.last_message_text, 200) as last_text, ct.name as contact_name,
                    (select dl.responsible_id from public.crm_deals dl
                      where dl.contact_id = c.contact_id and dl.closed_at is null
                      order by dl.created_at desc limit 1) as responsible_id
               from public.crm_conversations c
               join public.crm_contacts ct on ct.id = c.contact_id
              where c.waiting_since is not null
                and c.waiting_since > p_now - interval '3 days'
                and public.crm_work_start(c.waiting_since)
                    + make_interval(mins => v_set.reply_sla_minutes) <= p_now) w
      where w.responsible_id is not null;

    if v_set.escalate_minutes is not null then
      perform public.crm_notify(
                m.user_id, 'reply_escalation',
                'Клиенту не отвечают: ' || w.contact_name,
                concat_ws(' · ', 'ждёт ' || w.waited || ' мин',
                          coalesce('ответственный — ' || public.crm_profile_name(w.responsible_id),
                                   'без ответственного')),
                '/crm/inbox?c=' || w.id::text,
                'esc:' || w.id::text || ':' || extract(epoch from w.waiting_since)::bigint::text)
         from (select c.id, c.waiting_since, ct.name as contact_name,
                      (extract(epoch from p_now - public.crm_work_start(c.waiting_since)) / 60)::int as waited,
                      (select dl.responsible_id from public.crm_deals dl
                        where dl.contact_id = c.contact_id and dl.closed_at is null
                        order by dl.created_at desc limit 1) as responsible_id
                 from public.crm_conversations c
                 join public.crm_contacts ct on ct.id = c.contact_id
                where c.waiting_since is not null
                  and c.waiting_since > p_now - interval '3 days'
                  and public.crm_work_start(c.waiting_since)
                      + make_interval(mins => v_set.escalate_minutes) <= p_now) w
        cross join (select public.crm_manager_ids() as user_id) m
        where m.user_id is distinct from w.responsible_id;
    end if;
  end if;

  return (select count(*) from public.crm_notifications) - v_before;
end;
$$;
revoke all on function public.crm_notifications_collect(timestamptz) from public, anon, authenticated;
grant execute on function public.crm_notifications_collect(timestamptz) to service_role;

-- Пачка неотправленных с браузерами получателя; помечаются отправленными
-- сразу (пуш — не чаще одного раза).
create or replace function public.crm_notifications_claim(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  with picked as (
    select n.id from public.crm_notifications n
     where n.sent_at is null
     order by n.created_at
     limit greatest(1, least(p_limit, 500))
     for update skip locked
  ), marked as (
    update public.crm_notifications n set sent_at = now()
      from picked p where n.id = p.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'title', m.title, 'body', m.body, 'url', m.url,
           'targets', (select coalesce(jsonb_agg(jsonb_build_object(
                         'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                         from public.crm_staff_push_subscriptions s where s.user_id = m.user_id))), '[]'::jsonb)
    into v_out
    from marked m
   -- Старше часа не шлём: напоминание уже не ко времени.
   where m.created_at > now() - interval '1 hour';
  return v_out;
end;
$$;
revoke all on function public.crm_notifications_claim(integer) from public, anon, authenticated;
grant execute on function public.crm_notifications_claim(integer) to service_role;

-- Браузера больше нет (подписка отозвана).
create or replace function public.crm_push_gone(p_endpoints text[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.crm_staff_push_subscriptions where endpoint = any (p_endpoints)
$$;
revoke all on function public.crm_push_gone(text[]) from public, anon, authenticated;
grant execute on function public.crm_push_gone(text[]) to service_role;

-- 4) Отчёт по сотрудникам ------------------------------------------------------------
-- Ответ: первое сообщение клиента после нашего ответа (или первое в диалоге)
-- → первый ответ сотрудника; время — рабочее (crm_work_start). Засчитывается
-- тому, кто ответил. Период — по времени сообщения клиента.
create or replace function public.crm_people_report(
  p_from date, p_to date, p_pipeline uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as (
    select coalesce((select reply_sla_minutes from public.crm_settings where id), 15) as sla
  ),
  d as (
    select dl.*, s.kind as stage_kind
      from public.crm_deals dl
      join public.crm_stages s on s.id = dl.stage_id
     where p_pipeline is null or dl.pipeline_id = p_pipeline
  ),
  deals as (
    select responsible_id as user_id,
           count(*) filter (where closed_at is null) as open,
           count(*) filter (where created_at >= p_from::timestamptz
                              and created_at < (p_to + 1)::timestamptz) as created,
           count(*) filter (where stage_kind = 'won' and closed_at >= p_from::timestamptz
                              and closed_at < (p_to + 1)::timestamptz) as won,
           coalesce(sum(budget) filter (where stage_kind = 'won' and closed_at >= p_from::timestamptz
                              and closed_at < (p_to + 1)::timestamptz), 0) as won_budget,
           count(*) filter (where stage_kind = 'lost' and closed_at >= p_from::timestamptz
                              and closed_at < (p_to + 1)::timestamptz) as lost
      from d group by responsible_id
  ),
  -- Сообщения без автоматических и упавших: «кто кому отвечает».
  seq as (
    select m.conversation_id, m.direction, m.created_at, m.sent_by,
           lag(m.direction) over (partition by m.conversation_id order by m.created_at, m.id) as prev
      from public.crm_messages m
     where m.direction = 'in' or (not m.auto and m.status <> 'failed')
  ),
  asks as (
    select s.conversation_id, s.created_at as asked_at
      from seq s
     where s.direction = 'in' and s.prev is distinct from 'in'
       and s.created_at >= p_from::timestamptz and s.created_at < (p_to + 1)::timestamptz
  ),
  answers as (
    select a.conversation_id, a.asked_at, r.sent_by as user_id,
           greatest(extract(epoch from r.created_at - public.crm_work_start(a.asked_at)) / 60, 0) as minutes
      from asks a
      cross join lateral (
        select s.created_at, s.sent_by from seq s
         where s.conversation_id = a.conversation_id and s.direction = 'out'
           and s.created_at >= a.asked_at
         order by s.created_at limit 1) r
  ),
  replies as (
    select user_id, count(*) as replies,
           round((percentile_cont(0.5) within group (order by minutes))::numeric, 1) as reply_median,
           count(*) filter (where minutes <= (select sla from cfg)) as reply_in_sla
      from answers group by user_id
  ),
  sent as (
    select m.sent_by as user_id, count(*) as messages
      from public.crm_messages m
     where m.direction = 'out' and not m.auto and m.status <> 'failed' and m.sent_by is not null
       and m.created_at >= p_from::timestamptz and m.created_at < (p_to + 1)::timestamptz
     group by m.sent_by
  ),
  tasks as (
    select t.assignee_id as user_id,
           count(*) filter (where t.done_at >= p_from::timestamptz and t.done_at < (p_to + 1)::timestamptz
                              and t.result is distinct from 'Сделка закрыта') as tasks_done,
           count(*) filter (where t.done_at >= p_from::timestamptz and t.done_at < (p_to + 1)::timestamptz
                              and t.result is distinct from 'Сделка закрыта'
                              and t.done_at > t.due_at + interval '1 hour') as tasks_late,
           count(*) filter (where t.done_at is null and t.due_at < now()) as tasks_overdue
      from public.crm_tasks t
      join d on d.id = t.deal_id
     group by t.assignee_id
  ),
  ids as (
    select user_id from deals union select user_id from replies
    union select user_id from sent union select user_id from tasks
  )
  select jsonb_build_object(
    'sla_minutes', (select sla from cfg),
    'unanswered', (select count(*) from public.crm_conversations c where c.waiting_since is not null),
    'asked', (select count(*) from asks),
    'answered', (select count(*) from answers),
    'reply_median', (select round((percentile_cont(0.5) within group (order by minutes))::numeric, 1) from answers),
    'reply_in_sla', (select count(*) from answers where minutes <= (select sla from cfg)),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', i.user_id,
        'open', coalesce(dl.open, 0), 'created', coalesce(dl.created, 0),
        'won', coalesce(dl.won, 0), 'won_budget', coalesce(dl.won_budget, 0),
        'lost', coalesce(dl.lost, 0),
        'replies', coalesce(r.replies, 0), 'reply_median', r.reply_median,
        'reply_in_sla', coalesce(r.reply_in_sla, 0),
        'messages', coalesce(s.messages, 0),
        'tasks_done', coalesce(t.tasks_done, 0), 'tasks_late', coalesce(t.tasks_late, 0),
        'tasks_overdue', coalesce(t.tasks_overdue, 0))
        order by coalesce(dl.won_budget, 0) desc, coalesce(dl.won, 0) desc, coalesce(dl.open, 0) desc)
      from ids i
      left join deals dl on dl.user_id is not distinct from i.user_id
      left join replies r on r.user_id is not distinct from i.user_id
      left join sent s on s.user_id is not distinct from i.user_id
      left join tasks t on t.user_id is not distinct from i.user_id
     where coalesce(dl.open, 0) + coalesce(dl.created, 0) + coalesce(dl.won, 0) + coalesce(dl.lost, 0)
           + coalesce(r.replies, 0) + coalesce(s.messages, 0) + coalesce(t.tasks_done, 0)
           + coalesce(t.tasks_overdue, 0) > 0), '[]'::jsonb)
  )
$$;
revoke all on function public.crm_people_report(date, date, uuid) from public, anon;
grant execute on function public.crm_people_report(date, date, uuid) to authenticated;
