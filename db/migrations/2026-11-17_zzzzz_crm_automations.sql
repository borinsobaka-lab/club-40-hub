-- CRM, этап 3 — автоматизации этапов и очередь ответственных (CRM.md).
--
-- crm_automations — правило этапа воронки: «когда» → «что сделать».
--   trigger: enter    — сделка вошла в этап (delay_minutes: сразу или через N);
--            inbound  — клиент написал, пока сделка в этапе;
--            no_reply — клиент не ответил N минут после нашего сообщения.
--   action:  task        — задача {title, due_minutes} ответственному сделки;
--            responsible — ответственный {user_ids: [...]} сделке без
--                          ответственного: один — он, несколько — по очереди
--                          (rr_cursor; замена «Очереди ответственных» amoCRM);
--            move        — перевести в этап {stage_id} той же воронки;
--            message     — сообщение клиенту {body} с {имя} и {клуб} в его
--                          последний диалог (шлёт сервер админки);
--            tag         — поставить тег {tag}.
-- crm_automation_jobs — очередь срабатываний: событие ставит задание
--   (триггеры на сделках и сообщениях), исполняет crm_automations_run —
--   сервер админки раз в несколько секунд (service_role). Задание выполняется,
--   только если сделка всё ещё в том же этапе с того же входа; повтор события
--   задание не задваивает (event_key), на сделку × правило — не больше 20
--   заданий в сутки (защита от петли «этап A → этап B → этап A»).
-- Сделанное видно в ленте сделки событием auto.

-- 1) Таблицы ----------------------------------------------------------------------
create table if not exists public.crm_automations (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.crm_stages(id) on delete cascade,
  trigger text not null check (trigger in ('enter', 'inbound', 'no_reply')),
  delay_minutes integer not null default 0 check (delay_minutes between 0 and 525600),
  action text not null check (action in ('task', 'responsible', 'move', 'message', 'tag')),
  params jsonb not null default '{}',
  is_active boolean not null default true,
  -- Очередь ответственных: сколько раз уже назначали.
  rr_cursor integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_automations_stage_idx on public.crm_automations (stage_id);

create table if not exists public.crm_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.crm_automations(id) on delete cascade,
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  -- Событие, поставившее задание: enter:<случайный ключ входа>, in:<сообщение>, out:<сообщение>.
  event_key text not null,
  -- Вход в этап, при котором задание поставлено: сделка ушла из этапа — пропуск.
  stage_entered_at timestamptz not null,
  -- no_reply: после какого момента ждём ответа клиента.
  since timestamptz,
  run_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'done', 'skipped', 'failed')),
  result text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (automation_id, deal_id, event_key)
);
create index if not exists crm_automation_jobs_due_idx
  on public.crm_automation_jobs (run_at) where status = 'pending';
create index if not exists crm_automation_jobs_deal_idx on public.crm_automation_jobs (deal_id);

-- Событие ленты «сделала автоматизация».
alter table public.crm_deal_events drop constraint if exists crm_deal_events_kind_check;
alter table public.crm_deal_events add constraint crm_deal_events_kind_check
  check (kind in ('note', 'created', 'stage', 'pipeline', 'responsible', 'task_done', 'auto'));

-- 2) Проверка правила --------------------------------------------------------------
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
    new.params := jsonb_build_object(
      'title', left(btrim(new.params->>'title'), 500),
      'due_minutes', greatest(0, least(525600, coalesce((new.params->>'due_minutes')::int, 0))));
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
drop trigger if exists crm_automations_biu on public.crm_automations;
create trigger crm_automations_biu before insert or update on public.crm_automations
  for each row execute function public.crm_automations_biu();

-- 3) События → задания --------------------------------------------------------------
create or replace function public.crm_automation_enqueue(
  _automation public.crm_automations, _deal public.crm_deals, _event text, _since timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Защита от петли правил.
  if (select count(*) from public.crm_automation_jobs j
       where j.automation_id = _automation.id and j.deal_id = _deal.id
         and j.created_at > now() - interval '1 day') >= 20 then
    return;
  end if;
  insert into public.crm_automation_jobs (automation_id, deal_id, event_key, stage_entered_at, since, run_at)
  values (_automation.id, _deal.id, _event, _deal.stage_entered_at, _since,
          now() + make_interval(mins => _automation.delay_minutes))
  on conflict (automation_id, deal_id, event_key) do nothing;
end;
$$;
revoke all on function public.crm_automation_enqueue(public.crm_automations, public.crm_deals, text, timestamptz)
  from public, anon, authenticated;

-- Сделка вошла в этап.
create or replace function public.crm_deals_automations_aiu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.crm_automations;
begin
  if tg_op = 'UPDATE' and new.stage_id = old.stage_id then
    return null;
  end if;
  for a in select * from public.crm_automations
            where stage_id = new.stage_id and is_active and trigger = 'enter'
            order by sort_order, created_at loop
    -- Триггер срабатывает один раз на вход — ключ события свой у каждого входа.
    perform public.crm_automation_enqueue(a, new, 'enter:' || gen_random_uuid()::text, null);
  end loop;
  return null;
end;
$$;
drop trigger if exists crm_deals_automations_aiu on public.crm_deals;
create trigger crm_deals_automations_aiu after insert or update on public.crm_deals
  for each row execute function public.crm_deals_automations_aiu();

-- Сообщение: входящее — правила inbound, наше (не автоматическое) — no_reply.
create or replace function public.crm_messages_automations_ai()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.crm_deals;
  a public.crm_automations;
  v_trigger text := case when new.direction = 'in' then 'inbound' else 'no_reply' end;
begin
  if new.direction = 'out' and (new.auto or new.status = 'failed') then
    return null;
  end if;
  for d in select dl.* from public.crm_deals dl
            join public.crm_conversations c on c.contact_id = dl.contact_id
           where c.id = new.conversation_id and dl.closed_at is null loop
    for a in select * from public.crm_automations
              where stage_id = d.stage_id and is_active and trigger = v_trigger
              order by sort_order, created_at loop
      perform public.crm_automation_enqueue(
        a, d, (case when new.direction = 'in' then 'in:' else 'out:' end) || new.id::text, new.created_at);
    end loop;
  end loop;
  return null;
end;
$$;
drop trigger if exists crm_messages_automations_ai on public.crm_messages;
create trigger crm_messages_automations_ai after insert on public.crm_messages
  for each row execute function public.crm_messages_automations_ai();

-- 4) Исполнение ---------------------------------------------------------------------
create or replace function public.crm_automation_note(_deal uuid, _text text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.crm_deal_events (deal_id, kind, body) values (_deal, 'auto', _text)
$$;
revoke all on function public.crm_automation_note(uuid, text) from public, anon, authenticated;

-- Текст с переменными: {имя} — первое слово имени контакта, {клуб} — клуб сделки.
create or replace function public.crm_fill_template(_body text, _deal public.crm_deals)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select btrim(regexp_replace(
    replace(replace(_body,
      '{имя}', coalesce(split_part(btrim((select name from public.crm_contacts where id = _deal.contact_id)), ' ', 1), '')),
      '{клуб}', coalesce((select name from public.studios where id = _deal.studio_id), '')),
    '[ \t]+([,.!?])', '\1', 'g'))
$$;
revoke all on function public.crm_fill_template(text, public.crm_deals) from public, anon, authenticated;

-- Проход очереди. Возвращает сообщения, которые должен отправить сервер:
-- [{job_id, conversation_id, body}] — после отправки он зовёт
-- crm_automation_job_finish.
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
      insert into public.crm_tasks (deal_id, title, due_at, assignee_id, auto)
      values (d.id, v_title, now() + make_interval(mins => (a.params->>'due_minutes')::int),
              d.responsible_id, true);
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
revoke all on function public.crm_automations_run(integer) from public, anon, authenticated;
grant execute on function public.crm_automations_run(integer) to service_role;

-- Итог отправки сообщения автоматизации.
create or replace function public.crm_automation_job_finish(p_job uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal uuid;
begin
  update public.crm_automation_jobs
     set status = case when p_ok then 'done' else 'failed' end,
         result = case when p_ok then null else left(coalesce(p_error, 'Не отправлено'), 500) end,
         done_at = now()
   where id = p_job and status = 'sending'
  returning deal_id into v_deal;
  if v_deal is not null then
    perform public.crm_automation_note(v_deal, case when p_ok then 'Отправлено сообщение клиенту'
      else 'Сообщение клиенту не отправлено: ' || left(coalesce(p_error, ''), 300) end);
  end if;
end;
$$;
revoke all on function public.crm_automation_job_finish(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.crm_automation_job_finish(uuid, boolean, text) to service_role;

-- 5) RLS ----------------------------------------------------------------------------
alter table public.crm_automations enable row level security;
alter table public.crm_automation_jobs enable row level security;
grant select, insert, update, delete on public.crm_automations to authenticated, service_role;
grant select on public.crm_automation_jobs to authenticated;
grant select, insert, update, delete on public.crm_automation_jobs to service_role;

drop policy if exists "crm_automations read" on public.crm_automations;
create policy "crm_automations read" on public.crm_automations for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_automations manage" on public.crm_automations;
create policy "crm_automations manage" on public.crm_automations for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

drop policy if exists "crm_automation_jobs read" on public.crm_automation_jobs;
create policy "crm_automation_jobs read" on public.crm_automation_jobs for select to authenticated
  using (exists (select 1 from public.crm_deals d where d.id = deal_id));
