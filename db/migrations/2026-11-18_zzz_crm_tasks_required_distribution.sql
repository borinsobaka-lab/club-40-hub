-- CRM (решения владельца 2026-11-18):
--
-- 1) У открытой сделки всегда есть задача. Новая сделка (вручную, из
--    карточки клиента, из входящего сообщения) сразу получает задачу
--    «Связаться с клиентом» на ответственного — триггер crm_deals_first_task_ai;
--    так же — сделка, которую вернули из закрытого этапа в открытый. Если у
--    этапа есть своё правило «вошла в этап → задача» без задержки, задачу
--    ставит оно. Закрыть карточку сделки без задачи и выполнить последнюю
--    задачу, не поставив следующую, не даёт интерфейс админки.
--
-- 2) Распределение новых заявок. crm_distribution (одна строка): mode —
--    off / order (по очереди) / random (случайно). crm_distribution_studios —
--    клубы, между которыми делятся новые заявки, у каждого — свои
--    ответственные (user_ids). Клиент пишет впервые (у контакта ещё не было
--    сделок) — crm_ingest_message берёт следующий клуб и следующего
--    ответственного этого клуба (crm_distribution_next), сделка и диалог —
--    этого клуба. Выключено или клубов нет — клуб аккаунта канала, как прежде.
--    Правит crm.manage, читают все с правом CRM.
--    Актуальное определение crm_ingest_message — здесь.

-- 1) Задача у каждой открытой сделки ---------------------------------------------

create or replace function public.crm_deals_first_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select s.kind from public.crm_stages s where s.id = new.stage_id) <> 'open' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.closed_at is null then
    return new;
  end if;
  if exists (select 1 from public.crm_tasks t where t.deal_id = new.id and t.done_at is null) then
    return new;
  end if;
  -- Задачу сразу поставит правило этапа.
  if exists (select 1 from public.crm_automations a
              where a.stage_id = new.stage_id and a.is_active
                and a.trigger = 'enter' and a.delay_minutes = 0 and a.action = 'task') then
    return new;
  end if;
  insert into public.crm_tasks (deal_id, title, due_at, assignee_id, type_id, auto)
  values (new.id, 'Связаться с клиентом', now(), new.responsible_id,
          (select t.id from public.crm_task_types t where t.name = 'Связаться' limit 1), true);
  return new;
end;
$$;

drop trigger if exists crm_deals_first_task_ai on public.crm_deals;
create trigger crm_deals_first_task_ai after insert on public.crm_deals
  for each row execute function public.crm_deals_first_task();
-- Имя «zz»: после crm_deals_tasks_au, который закрывает задачи закрытой сделки.
drop trigger if exists crm_deals_zz_first_task_au on public.crm_deals;
create trigger crm_deals_zz_first_task_au after update of stage_id on public.crm_deals
  for each row execute function public.crm_deals_first_task();

-- Открытые сделки, оставшиеся без задач до этого правила.
insert into public.crm_tasks (deal_id, title, due_at, assignee_id, type_id, auto)
select d.id, 'Связаться с клиентом', now(), d.responsible_id,
       (select t.id from public.crm_task_types t where t.name = 'Связаться' limit 1), true
  from public.crm_deals d
 where d.closed_at is null
   and not exists (select 1 from public.crm_tasks t where t.deal_id = d.id and t.done_at is null);

-- 2) Распределение новых заявок ---------------------------------------------------

create table if not exists public.crm_distribution (
  id boolean primary key default true check (id),
  mode text not null default 'off' check (mode in ('off', 'order', 'random')),
  -- Сколько заявок уже распределено (очередь клубов).
  studio_cursor integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.crm_distribution (id) values (true) on conflict do nothing;

create table if not exists public.crm_distribution_studios (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  -- Ответственные клуба; пусто — сделка без ответственного.
  user_ids uuid[] not null default '{}' check (cardinality(user_ids) <= 50),
  sort_order integer not null default 0,
  -- Сколько заявок уже досталось клубу (очередь ответственных).
  user_cursor integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.crm_distribution enable row level security;
alter table public.crm_distribution_studios enable row level security;
grant select, update on public.crm_distribution to authenticated;
grant select, insert, update, delete on public.crm_distribution_studios to authenticated;
grant all on public.crm_distribution, public.crm_distribution_studios to service_role;

drop policy if exists "crm_distribution read" on public.crm_distribution;
create policy "crm_distribution read" on public.crm_distribution for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_distribution manage" on public.crm_distribution;
create policy "crm_distribution manage" on public.crm_distribution for update to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));
drop policy if exists "crm_distribution_studios read" on public.crm_distribution_studios;
create policy "crm_distribution_studios read" on public.crm_distribution_studios for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_distribution_studios manage" on public.crm_distribution_studios;
create policy "crm_distribution_studios manage" on public.crm_distribution_studios for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

-- Следующий клуб и ответственный. distributed = false — распределение
-- выключено или клубов нет: вызывающий оставляет клуб аккаунта.
create or replace function public.crm_distribution_next()
returns table (studio_id uuid, responsible_id uuid, distributed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.crm_distribution;
  v_row public.crm_distribution_studios;
  v_n integer;
  v_users uuid[];
  v_user uuid;
begin
  select * into v_set from public.crm_distribution where id for update;
  select count(*) into v_n from public.crm_distribution_studios;
  if v_set.id is null or v_set.mode = 'off' or v_n = 0 then
    return query select null::uuid, null::uuid, false;
    return;
  end if;
  select s.* into v_row from public.crm_distribution_studios s
   order by s.sort_order, s.created_at, s.studio_id
   offset case when v_set.mode = 'random' then floor(random() * v_n)::int
               else v_set.studio_cursor % v_n end
   limit 1;
  -- Только существующие учётные записи.
  select array_agg(x.id order by x.ord) into v_users
    from unnest(v_row.user_ids) with ordinality as x(id, ord)
   where exists (select 1 from auth.users u where u.id = x.id);
  if coalesce(cardinality(v_users), 0) > 0 then
    v_user := v_users[1 + case when v_set.mode = 'random'
                               then floor(random() * cardinality(v_users))::int
                               else v_row.user_cursor % cardinality(v_users) end];
  end if;
  update public.crm_distribution set studio_cursor = studio_cursor + 1 where id;
  update public.crm_distribution_studios s set user_cursor = s.user_cursor + 1
   where s.studio_id = v_row.studio_id;
  return query select v_row.studio_id, v_user, true;
end;
$$;
revoke all on function public.crm_distribution_next() from public, anon, authenticated;
grant execute on function public.crm_distribution_next() to service_role;

-- Входящее сообщение канала (как в 2026-11-17_zzzz_crm_messaging.sql) +
-- распределение новых заявок.
create or replace function public.crm_ingest_message(
  p_account uuid, p_chat text, p_sender jsonb, p_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acc public.crm_channel_accounts;
  v_channel text;
  v_scope uuid;
  v_ext text := nullif(btrim(coalesce(p_sender->>'external_id', '')), '');
  v_username text := nullif(btrim(coalesce(p_sender->>'username', '')), '');
  v_name text := nullif(btrim(coalesce(p_sender->>'name', '')), '');
  v_phone text := nullif(btrim(coalesce(p_sender->>'phone', '')), '');
  v_identity public.crm_contact_identities;
  v_contact uuid;
  v_conv uuid;
  v_msg uuid;
  v_deal uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_at timestamptz := coalesce((p_message->>'sent_at')::timestamptz, now());
  v_studio uuid;
  v_dist_studio uuid;
  v_responsible uuid;
  v_distributed boolean := false;
begin
  select * into v_acc from public.crm_channel_accounts where id = p_account;
  if v_acc.id is null or v_acc.status = 'disabled' then
    raise exception 'crm_account_not_found' using errcode = '23503';
  end if;
  if v_ext is null or nullif(btrim(coalesce(p_chat, '')), '') is null then
    raise exception 'crm_bad_message' using errcode = '22023';
  end if;
  v_channel := public.crm_channel_of(v_acc.kind);
  v_scope := case when v_channel in ('instagram', 'facebook') then v_acc.id end;

  -- Один и тот же человек пишет впервые двумя сообщениями подряд — не два контакта.
  perform pg_advisory_xact_lock(hashtextextended(v_channel || ':' || v_ext, 0));

  select * into v_identity from public.crm_contact_identities i
   where i.channel = v_channel and i.external_id = v_ext
     and i.account_id is not distinct from v_scope;

  if v_identity.id is null then
    -- Instagram: тот же ник уже писал в другой наш аккаунт.
    if v_channel = 'instagram' and v_username is not null then
      select i.contact_id into v_contact from public.crm_contact_identities i
       where i.channel = 'instagram' and lower(i.username) = lower(v_username)
       order by i.created_at limit 1;
    end if;
    if v_contact is null and public.client_phone_key(v_phone) is not null then
      select c.id into v_contact from public.crm_contacts c
       where public.client_phone_key(c.phone) = public.client_phone_key(v_phone)
       order by c.created_at limit 1;
    end if;
    if v_contact is null then
      insert into public.crm_contacts (name, phone)
      values (coalesce(v_name, v_username, 'Без имени'), v_phone)
      returning id into v_contact;
    end if;
    insert into public.crm_contact_identities (contact_id, channel, account_id, external_id, username, display_name)
    values (v_contact, v_channel, v_scope, v_ext, v_username, v_name)
    returning * into v_identity;
  else
    v_contact := v_identity.contact_id;
    if v_identity.username is distinct from v_username or v_identity.display_name is distinct from v_name then
      update public.crm_contact_identities
         set username = coalesce(v_username, username),
             display_name = coalesce(v_name, display_name),
             updated_at = now()
       where id = v_identity.id;
    end if;
  end if;

  insert into public.crm_conversations (contact_id, account_id, identity_id, external_chat_id)
  values (v_contact, v_acc.id, v_identity.id, p_chat)
  on conflict (account_id, external_chat_id) do update set identity_id = excluded.identity_id
  returning id into v_conv;

  insert into public.crm_messages (conversation_id, direction, body, attachments, external_id, status, created_at)
  values (v_conv, 'in', nullif(p_message->>'body', ''),
          coalesce(p_message->'attachments', '[]'::jsonb),
          nullif(p_message->>'external_id', ''), 'received', v_at)
  on conflict (conversation_id, external_id) where external_id is not null do nothing
  returning id into v_msg;

  update public.crm_channel_accounts set last_event_at = now() where id = v_acc.id;

  if v_msg is null then
    return jsonb_build_object('duplicate', true, 'conversation_id', v_conv, 'contact_id', v_contact);
  end if;

  -- Нет открытой сделки — новое обращение в первом этапе воронки аккаунта.
  select d.id into v_deal from public.crm_deals d
   where d.contact_id = v_contact and d.closed_at is null
   order by d.created_at desc limit 1;
  if v_deal is null then
    v_pipeline := coalesce(
      (select p.id from public.crm_pipelines p where p.id = v_acc.pipeline_id and not p.is_archived),
      (select p.id from public.crm_pipelines p where not p.is_archived order by p.sort_order, p.created_at limit 1));
    select s.id into v_stage from public.crm_stages s
     where s.pipeline_id = v_pipeline and s.kind = 'open'
     order by s.sort_order, s.created_at limit 1;
    if v_stage is not null then
      -- Человек пишет впервые (сделок у него ещё не было) — распределение
      -- новых заявок, если включено: клуб и ответственный по очереди или
      -- случайно; диалог переходит в тот же клуб — его сотрудники видят
      -- переписку. Иначе — клуб аккаунта, как прежде.
      v_studio := v_acc.studio_id;
      if not exists (select 1 from public.crm_deals d where d.contact_id = v_contact) then
        select t.studio_id, t.responsible_id, t.distributed
          into v_dist_studio, v_responsible, v_distributed
          from public.crm_distribution_next() t;
        if v_distributed then
          v_studio := v_dist_studio;
          update public.crm_conversations set studio_id = v_studio where id = v_conv;
        end if;
      end if;
      insert into public.crm_deals (title, pipeline_id, stage_id, contact_id, studio_id, responsible_id, source)
      values ((select name from public.crm_contacts where id = v_contact), v_pipeline, v_stage,
              v_contact, v_studio, v_responsible,
              case v_channel when 'telegram' then 'Telegram' when 'whatsapp' then 'WhatsApp'
                             when 'instagram' then 'Instagram' else 'Facebook' end)
      returning id into v_deal;
    end if;
  end if;

  return jsonb_build_object('duplicate', false, 'conversation_id', v_conv, 'message_id', v_msg,
                            'contact_id', v_contact, 'deal_id', v_deal);
end;
$$;
revoke all on function public.crm_ingest_message(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crm_ingest_message(uuid, text, jsonb, jsonb) to service_role;
