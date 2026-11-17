-- CRM: задачи — типы, комментарий, результат, перенос и автозадачи «для кого»
-- (решение владельца 2026-11-18; CRM.md, «Задачи»).
--
--   crm_task_types — типы задач («Связаться», «Звонок», «Встреча»…): общие
--     на сеть, правит crm.manage; удалённый тип у задач становится пустым.
--   crm_tasks + type_id, note (комментарий постановщика), result (что
--     получилось — пишется при выполнении и уходит в ленту сделки).
--     Сотрудник правит текст, срок, исполнителя, тип и комментарий.
--   Сделку закрыли (успех или отказ) — её невыполненные задачи закрываются
--     сами с результатом «Сделка закрыта» (без событий в ленте).
--   У сделки сменили ответственного — невыполненные задачи прежнего
--     ответственного переходят новому.
--   Автозадача правила этапа: params.assignee — 'responsible' (ответственный
--     сделки) или id сотрудника; params.type_id — тип. Актуальные определения
--     crm_automations_biu и crm_automations_run — здесь.
--   crm_tasks_list — задачи для раздела «Задачи» одной выборкой: со сделкой,
--     контактом, этапом (security invoker — только видимые сделки).

-- 1) Типы ------------------------------------------------------------------------
create table if not exists public.crm_task_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.crm_task_types enable row level security;
grant select, insert, update, delete on public.crm_task_types to authenticated, service_role;
drop policy if exists "crm_task_types read" on public.crm_task_types;
create policy "crm_task_types read" on public.crm_task_types for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_task_types manage" on public.crm_task_types;
create policy "crm_task_types manage" on public.crm_task_types for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

insert into public.crm_task_types (name, color, sort_order)
select v.name, v.color, v.ord
  from (values ('Связаться', '#0ea5e9', 1), ('Звонок', '#16a34a', 2),
               ('Встреча', '#a855f7', 3), ('Напомнить', '#f59e0b', 4)) as v(name, color, ord)
 where not exists (select 1 from public.crm_task_types);

-- 2) Задачи ----------------------------------------------------------------------
alter table public.crm_tasks
  add column if not exists type_id uuid references public.crm_task_types(id) on delete set null,
  add column if not exists note text check (note is null or char_length(note) <= 2000),
  add column if not exists result text check (result is null or char_length(result) <= 2000);
create index if not exists crm_tasks_due_idx on public.crm_tasks (due_at) where done_at is null;
create index if not exists crm_tasks_done_idx on public.crm_tasks (done_at desc) where done_at is not null;

-- Автор, кто и когда выполнил; результат — только у выполненной. Без
-- security definer: auto ставит только сервер.
create or replace function public.crm_tasks_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.title := btrim(new.title);
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.result := nullif(btrim(coalesce(new.result, '')), '');
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
    else
      new.result := null;
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
    new.result := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end;
$$;

-- Выполненная задача — событием в ленту: тип, текст и результат.
create or replace function public.crm_tasks_done_au()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.done_at is not null and old.done_at is null
     and coalesce(current_setting('crm.silent_tasks', true), '') <> '1' then
    insert into public.crm_deal_events (deal_id, kind, body, meta, author_id, author_name)
    values (new.deal_id, 'task_done', new.title,
            jsonb_strip_nulls(jsonb_build_object(
              'type', (select name from public.crm_task_types where id = new.type_id),
              'result', new.result)),
            auth.uid(), public.crm_profile_name(auth.uid()));
  end if;
  return null;
end;
$$;

-- Сделка закрыта — её задачи закрываются; сменился ответственный — его
-- невыполненные задачи переходят новому.
create or replace function public.crm_deals_tasks_au()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    perform set_config('crm.silent_tasks', '1', true);
    update public.crm_tasks set done_at = now(), result = 'Сделка закрыта'
     where deal_id = new.id and done_at is null;
    perform set_config('crm.silent_tasks', '', true);
  end if;
  if new.responsible_id is distinct from old.responsible_id and new.responsible_id is not null then
    update public.crm_tasks set assignee_id = new.responsible_id
     where deal_id = new.id and done_at is null
       and assignee_id is not distinct from old.responsible_id;
  end if;
  return null;
end;
$$;
drop trigger if exists crm_deals_tasks_au on public.crm_deals;
create trigger crm_deals_tasks_au after update on public.crm_deals
  for each row execute function public.crm_deals_tasks_au();

-- 3) Автозадача: для кого и какого типа ---------------------------------------------
create or replace function public.crm_automations_biu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pipeline uuid;
  v_ids jsonb;
begin
  select pipeline_id into v_pipeline from public.crm_stages where id = new.stage_id;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if new.trigger = 'inbound' then
    new.delay_minutes := 0;
  elsif new.trigger = 'no_reply' and new.delay_minutes < 1 then
    raise exception using errcode = '23514', message = 'Укажите, сколько ждать ответа клиента';
  end if;

  if new.action = 'task' then
    if nullif(btrim(coalesce(new.params->>'title', '')), '') is null then
      raise exception using errcode = '23514', message = 'Напишите текст задачи';
    end if;
    -- assignee: 'responsible' — ответственный сделки, иначе id сотрудника.
    if coalesce(new.params->>'assignee', 'responsible') <> 'responsible'
       and not exists (select 1 from public.profiles
                        where id::text = new.params->>'assignee') then
      raise exception using errcode = '23514', message = 'Исполнитель задачи не найден';
    end if;
    new.params := jsonb_build_object(
      'title', left(btrim(new.params->>'title'), 500),
      'due_minutes', greatest(0, least(525600, coalesce((new.params->>'due_minutes')::int, 0))),
      'assignee', coalesce(new.params->>'assignee', 'responsible'),
      'type_id', (select t.id from public.crm_task_types t
                   where t.id::text = new.params->>'type_id'));
  elsif new.action = 'responsible' then
    v_ids := coalesce(new.params->'user_ids', '[]'::jsonb);
    if jsonb_typeof(v_ids) <> 'array' or jsonb_array_length(v_ids) = 0 then
      raise exception using errcode = '23514', message = 'Выберите хотя бы одного сотрудника';
    end if;
    new.params := jsonb_build_object('user_ids', v_ids);
  elsif new.action = 'move' then
    if not exists (select 1 from public.crm_stages s
                    where s.id = (new.params->>'stage_id')::uuid
                      and s.pipeline_id = v_pipeline and s.id <> new.stage_id) then
      raise exception using errcode = '23514', message = 'Выберите другой этап этой же воронки';
    end if;
    new.params := jsonb_build_object('stage_id', new.params->>'stage_id');
  elsif new.action = 'message' then
    if nullif(btrim(coalesce(new.params->>'body', '')), '') is null then
      raise exception using errcode = '23514', message = 'Напишите текст сообщения';
    end if;
    new.params := jsonb_build_object('body', left(btrim(new.params->>'body'), 4000));
  else
    if nullif(btrim(coalesce(new.params->>'tag', '')), '') is null then
      raise exception using errcode = '23514', message = 'Укажите тег';
    end if;
    new.params := jsonb_build_object('tag', left(btrim(ltrim(btrim(new.params->>'tag'), '#')), 60));
  end if;
  return new;
end;
$$;

create or replace function public.crm_automations_run(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.crm_automation_jobs;
  a public.crm_automations;
  d public.crm_deals;
  v_out jsonb := '[]'::jsonb;
  v_result text;
  v_status text;
  v_ids uuid[];
  v_user uuid;
  v_conv uuid;
  v_title text;
begin
  -- Сервер упал посреди отправки — задание не висит вечно.
  update public.crm_automation_jobs
     set status = 'failed', result = 'Сообщение не отправлено: сервер не ответил', done_at = now()
   where status = 'sending' and run_at < now() - interval '10 minutes';

  for j in select * from public.crm_automation_jobs
            where status = 'pending' and run_at <= now()
            order by run_at limit greatest(1, least(p_limit, 200))
            for update skip locked loop
    select * into a from public.crm_automations where id = j.automation_id;
    select * into d from public.crm_deals where id = j.deal_id;
    v_status := 'done';
    v_result := null;

    if not a.is_active then
      v_status := 'skipped'; v_result := 'Правило выключено';
    elsif d.stage_id <> a.stage_id or d.stage_entered_at <> j.stage_entered_at then
      v_status := 'skipped'; v_result := 'Сделка уже в другом этапе';
    elsif a.trigger = 'no_reply' and exists (
            select 1 from public.crm_messages m
              join public.crm_conversations c on c.id = m.conversation_id
             where c.contact_id = d.contact_id and m.direction = 'in' and m.created_at > j.since) then
      v_status := 'skipped'; v_result := 'Клиент ответил';
    elsif a.trigger = 'no_reply' and exists (
            select 1 from public.crm_messages m
              join public.crm_conversations c on c.id = m.conversation_id
             where c.contact_id = d.contact_id and m.direction = 'out' and not m.auto
               and m.status <> 'failed' and m.created_at > j.since) then
      -- Ждём от последнего нашего сообщения: у него своё задание.
      v_status := 'skipped'; v_result := 'Есть более позднее сообщение';
    elsif a.action = 'task' then
      v_title := public.crm_fill_template(a.params->>'title', d);
      insert into public.crm_tasks (deal_id, title, due_at, assignee_id, type_id, auto)
      values (d.id, v_title, now() + make_interval(mins => (a.params->>'due_minutes')::int),
              case when coalesce(a.params->>'assignee', 'responsible') = 'responsible'
                   then d.responsible_id else (a.params->>'assignee')::uuid end,
              (select t.id from public.crm_task_types t where t.id::text = a.params->>'type_id'),
              true);
      perform public.crm_automation_note(d.id, 'Поставлена задача: ' || v_title);
    elsif a.action = 'responsible' and d.responsible_id is not null then
      -- Сделку завели вручную с ответственным — очередь её не трогает.
      v_status := 'skipped'; v_result := 'Ответственный уже назначен';
    elsif a.action = 'responsible' then
      -- Только те, у кого ещё есть доступ к CRM.
      select array_agg(u.id order by u.ord) into v_ids
        from (select (x.value)::uuid as id, x.ord
                from jsonb_array_elements_text(a.params->'user_ids') with ordinality as x(value, ord)) u
       where public.crm_has(u.id, 'crm.view') or public.crm_has(u.id, 'crm.manage');
      if v_ids is null then
        v_status := 'skipped'; v_result := 'Некого назначить: у выбранных нет доступа к CRM';
      else
        v_user := v_ids[1 + (a.rr_cursor % array_length(v_ids, 1))];
        update public.crm_automations set rr_cursor = rr_cursor + 1 where id = a.id;
        if d.responsible_id is distinct from v_user then
          update public.crm_deals set responsible_id = v_user where id = d.id;
          -- Невыполненные автозадачи без исполнителя — новому ответственному.
          update public.crm_tasks set assignee_id = v_user
           where deal_id = d.id and done_at is null and assignee_id is null;
        end if;
      end if;
    elsif a.action = 'move' then
      if exists (select 1 from public.crm_stages s
                  where s.id = (a.params->>'stage_id')::uuid and s.pipeline_id = d.pipeline_id) then
        update public.crm_deals set stage_id = (a.params->>'stage_id')::uuid where id = d.id;
      else
        v_status := 'skipped'; v_result := 'Этап удалён';
      end if;
    elsif a.action = 'tag' then
      update public.crm_deals set tags = array_append(tags, a.params->>'tag')
       where id = d.id and not (a.params->>'tag' = any (tags));
    else
      -- Сообщение: последний диалог контакта в работающем аккаунте.
      select c.id into v_conv from public.crm_conversations c
        join public.crm_channel_accounts acc on acc.id = c.account_id
       where c.contact_id = d.contact_id and acc.status = 'active'
       order by c.last_message_at desc nulls last limit 1;
      if v_conv is null then
        v_status := 'skipped'; v_result := 'У контакта нет диалога';
      else
        v_status := 'sending';
        v_out := v_out || jsonb_build_object(
          'job_id', j.id, 'conversation_id', v_conv,
          'body', public.crm_fill_template(a.params->>'body', d));
      end if;
    end if;

    update public.crm_automation_jobs
       set status = v_status, result = v_result,
           done_at = case when v_status = 'sending' then null else now() end
     where id = j.id;
  end loop;
  return v_out;
end;
$$;

-- 4) Раздел «Задачи» ----------------------------------------------------------------
-- p_assignee: null — всех; p_done: false — невыполненные (ближайшие и
-- просроченные сверху), true — выполненные за 30 дней (свежие сверху).
create or replace function public.crm_tasks_list(
  p_assignee uuid default null, p_type uuid default null, p_done boolean default false
)
returns table (
  id uuid, deal_id uuid, title text, note text, result text, due_at timestamptz,
  assignee_id uuid, type_id uuid, auto boolean, done_at timestamptz, created_by uuid,
  deal_title text, contact_name text, stage_name text, stage_color text, studio_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.deal_id, t.title, t.note, t.result, t.due_at, t.assignee_id, t.type_id, t.auto,
         t.done_at, t.created_by, d.title, c.name, s.name, s.color, d.studio_id
    from public.crm_tasks t
    join public.crm_deals d on d.id = t.deal_id
    join public.crm_stages s on s.id = d.stage_id
    left join public.crm_contacts c on c.id = d.contact_id
   where (p_assignee is null or t.assignee_id = p_assignee)
     and (p_type is null or t.type_id = p_type)
     and case when p_done then t.done_at > now() - interval '30 days' else t.done_at is null end
   order by case when p_done then null else t.due_at end asc,
            case when p_done then t.done_at end desc
   limit 500
$$;
revoke all on function public.crm_tasks_list(uuid, uuid, boolean) from public, anon;
grant execute on function public.crm_tasks_list(uuid, uuid, boolean) to authenticated;
