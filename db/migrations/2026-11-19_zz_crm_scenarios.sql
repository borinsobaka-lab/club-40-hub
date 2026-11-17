-- CRM: сценарии по клиентам клуба — сделки из событий портала (решение
-- владельца 2026-11-19; CRM.md, «Сценарии»). Продавать тем, кто уже в базе:
-- продление, дожим после пробного, возврат, долги.
--
-- crm_scenarios — строка на сценарий (заводит миграция, правит crm.manage):
--   expiring          — абонемент заканчивается: срок через ≤ days дней или
--                       остаток ≤ left тренировок, продление не куплено;
--   trial_no_purchase — был на пробном ≥ days дней назад (не старше 30 дней)
--                       и абонемент не купил;
--   inactive          — действующий абонемент, не был ≥ days дней и не
--                       записан на будущее;
--   lapsed            — абонемент закончился ≥ days дней назад (не старше 90
--                       дней), нового нет;
--   overdue_payment   — платёж по рассрочке просрочен на ≥ days дней.
--   enabled, pipeline_id + stage_id — куда ставить сделку, params,
--   task_title — текст первой задачи.
-- crm_scenarios_run (service_role, сервер админки раз в 10 минут): по
--   каждому включённому сценарию находит клиентов (crm_scenario_candidates),
--   заводит контакт CRM по карточке клиента (если нет) и сделку в этапе
--   сценария: источник — название сценария, crm_deals.scenario /
--   scenario_ref, клуб — клуб абонемента (продажи), ответственный — по
--   очереди из «Распределения заявок» этого клуба. Без повторов:
--   crm_scenario_log (сценарий × клиент × событие); пока у клиента открыта
--   сделка этого сценария или сценарий срабатывал по нему за 14 дней —
--   новой нет. За проход — не больше 200 сделок на сценарий.
-- Закрытие «Успешно» само: покупка абонемента (кроме сделки о долге) —
--   crm_sales_ai (актуальное определение — здесь); внесён просроченный
--   платёж — сделка о долге; пришёл на занятие — «давно не был»
--   (crm_bookings_aiu — актуальное определение здесь).
-- crm_scenario_preview — сколько клиентов подходит сейчас (для настроек);
-- crm_scenarios_report — итог по сценариям за период.

alter table public.crm_deals
  add column if not exists scenario text,
  add column if not exists scenario_ref text;
create index if not exists crm_deals_scenario_idx on public.crm_deals (scenario) where scenario is not null;

create table if not exists public.crm_scenarios (
  key text primary key
    check (key in ('expiring', 'trial_no_purchase', 'inactive', 'lapsed', 'overdue_payment')),
  enabled boolean not null default false,
  pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  stage_id uuid references public.crm_stages(id) on delete set null,
  params jsonb not null default '{}',
  task_title text not null check (char_length(btrim(task_title)) between 1 and 500),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.crm_scenario_log (
  key text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  ref text not null,
  deal_id uuid references public.crm_deals(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (key, client_id, ref)
);
create index if not exists crm_scenario_log_recent_idx on public.crm_scenario_log (key, client_id, created_at);

alter table public.crm_scenarios enable row level security;
alter table public.crm_scenario_log enable row level security;
grant select, update on public.crm_scenarios to authenticated;
grant all on public.crm_scenarios, public.crm_scenario_log to service_role;
revoke all on public.crm_scenario_log from public, anon, authenticated;

drop policy if exists "crm_scenarios read" on public.crm_scenarios;
create policy "crm_scenarios read" on public.crm_scenarios for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_scenarios manage" on public.crm_scenarios;
create policy "crm_scenarios manage" on public.crm_scenarios for update to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

create or replace function public.crm_scenario_label(_key text)
returns text
language sql
immutable
as $$
  select case _key
    when 'expiring' then 'Продление'
    when 'trial_no_purchase' then 'После пробного'
    when 'inactive' then 'Давно не был'
    when 'lapsed' then 'Возврат'
    when 'overdue_payment' then 'Долг по оплате'
  end
$$;

-- Параметры — в пределах; этап — открытый этап выбранной воронки; включить
-- можно только с этапом.
create or replace function public.crm_scenarios_bu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
begin
  new.key := old.key;
  new.sort_order := old.sort_order;
  new.task_title := btrim(new.task_title);
  new.updated_at := now();
  new.updated_by := auth.uid();
  v_days := greatest(case when new.key = 'expiring' then 0 else 1 end,
                     least(365, coalesce((new.params->>'days')::int,
                                         case new.key when 'expiring' then 7 when 'trial_no_purchase' then 1
                                                      when 'overdue_payment' then 1 else 14 end)));
  new.params := case when new.key = 'expiring'
    then jsonb_build_object('days', v_days,
                            'left', greatest(0, least(50, coalesce((new.params->>'left')::int, 2))))
    else jsonb_build_object('days', v_days) end;
  if new.stage_id is not null then
    select s.pipeline_id into new.pipeline_id from public.crm_stages s
     where s.id = new.stage_id and s.kind = 'open';
    if new.pipeline_id is null then
      raise exception using errcode = '23514', message = 'Выберите этап, в который ставить сделки';
    end if;
  end if;
  if new.enabled and new.stage_id is null then
    raise exception using errcode = '23514', message = 'Чтобы включить сценарий, выберите воронку и этап';
  end if;
  return new;
end;
$$;
drop trigger if exists crm_scenarios_bu on public.crm_scenarios;
create trigger crm_scenarios_bu before update on public.crm_scenarios
  for each row execute function public.crm_scenarios_bu();

-- Кто подходит под сценарий сейчас. ref — событие (абонемент, платёж):
-- по одному событию сделка заводится один раз. Наружу не выдана.
create or replace function public.crm_scenario_candidates(_key text, _params jsonb, _now timestamptz)
returns table (client_id uuid, studio_id uuid, ref text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (_now at time zone 'Asia/Tbilisi')::date;
  v_days integer := coalesce((_params->>'days')::int, 7);
  v_left integer := coalesce((_params->>'left')::int, 2);
begin
  if _key = 'expiring' then
    return query
    select distinct on (cm.client_id) cm.client_id, cm.studio_id, cm.id::text,
           case when cm.ends_at is not null and cm.ends_at <= v_today + v_days
                then 'Абонемент «' || m.name || '» до ' || to_char(cm.ends_at, 'DD.MM')
                else 'Абонемент «' || m.name || '»: осталось '
                     || (case when cm.balance_kind = 'personal' then cm.personal_left else cm.visits_left end)::text
                     || ' тренировок' end
      from public.client_memberships cm
      join public.memberships m on m.id = cm.membership_id
     where cm.status = 'active' and m.kind not in ('trial', 'single')
       and (cm.ends_at is null or cm.ends_at >= v_today)
       and ((cm.ends_at is not null and cm.ends_at <= v_today + v_days)
            or (case when cm.balance_kind = 'personal' then cm.personal_left else cm.visits_left end) <= v_left)
       -- Продление уже куплено и ждёт в очереди.
       and not exists (select 1 from public.client_memberships p
                        where p.client_id = cm.client_id and p.status = 'pending'
                          and p.balance_kind is not distinct from cm.balance_kind)
     order by cm.client_id, cm.ends_at nulls last;

  elsif _key = 'trial_no_purchase' then
    return query
    select t.client_id, t.studio_id, t.id::text,
           'Пробное занятие ' || to_char(t.visited_at at time zone 'Asia/Tbilisi', 'DD.MM')
      from (select cm.id, cm.client_id, cm.studio_id, max(e.starts_at) as visited_at
              from public.client_memberships cm
              join public.memberships m on m.id = cm.membership_id and m.kind = 'trial'
              join public.schedule_bookings b on b.charged_membership_id = cm.id and b.status = 'attended'
              join public.schedule_entries e on e.id = b.entry_id
             group by cm.id) t
     where t.visited_at <= _now - make_interval(days => v_days)
       and t.visited_at > _now - make_interval(days => v_days + 30)
       and not exists (select 1 from public.client_memberships cm2
                         join public.memberships m2 on m2.id = cm2.membership_id
                        where cm2.client_id = t.client_id and m2.kind not in ('trial', 'single'));

  elsif _key = 'inactive' then
    return query
    select distinct on (x.client_id) x.client_id, x.studio_id,
           x.id::text || ':' || coalesce(to_char(x.last_visit, 'YYYY-MM-DD'), 'none'),
           case when x.last_visit is null then 'Купил абонемент и ещё не был на занятиях'
                else 'Не был на занятиях с ' || to_char(x.last_visit, 'DD.MM') end
      from (select cm.id, cm.client_id, cm.studio_id, cm.created_at,
                   (select max((e.starts_at at time zone 'Asia/Tbilisi')::date)
                      from public.schedule_bookings b
                      join public.schedule_entries e on e.id = b.entry_id
                     where b.client_id = cm.client_id and b.status = 'attended') as last_visit
              from public.client_memberships cm
              join public.memberships m on m.id = cm.membership_id
             where cm.status = 'active' and m.kind not in ('trial', 'single')
               and (cm.ends_at is null or cm.ends_at >= v_today)) x
     where coalesce(x.last_visit, (x.created_at at time zone 'Asia/Tbilisi')::date) <= v_today - v_days
       and not exists (select 1 from public.schedule_bookings b
                         join public.schedule_entries e on e.id = b.entry_id
                        where b.client_id = x.client_id and b.status = 'booked' and e.starts_at > _now)
     order by x.client_id, x.created_at desc;

  elsif _key = 'lapsed' then
    return query
    select l.client_id, l.studio_id, l.id::text,
           'Абонемент «' || l.name || '» закончился ' || to_char(l.ended_on, 'DD.MM')
      from (select distinct on (cm.client_id) cm.id, cm.client_id, cm.studio_id, m.name,
                   case when cm.ends_at is not null and cm.ends_at < v_today then cm.ends_at
                        else coalesce(
                          (select max((e.starts_at at time zone 'Asia/Tbilisi')::date)
                             from public.schedule_bookings b
                             join public.schedule_entries e on e.id = b.entry_id
                            where b.charged_membership_id = cm.id and b.status = 'attended'),
                          cm.ends_at, (cm.created_at at time zone 'Asia/Tbilisi')::date) end as ended_on
              from public.client_memberships cm
              join public.memberships m on m.id = cm.membership_id
             where m.kind not in ('trial', 'single')
               and (cm.status = 'expired' or (cm.status = 'active' and cm.ends_at < v_today))
             order by cm.client_id, cm.created_at desc) l
     where l.ended_on <= v_today - v_days and l.ended_on > v_today - v_days - 90
       and not exists (select 1 from public.client_memberships a
                         join public.memberships ma on ma.id = a.membership_id
                        where a.client_id = l.client_id and ma.kind not in ('trial', 'single')
                          and (a.status in ('frozen', 'pending')
                               or (a.status = 'active' and (a.ends_at is null or a.ends_at >= v_today))));

  elsif _key = 'overdue_payment' then
    return query
    select distinct on (s.client_id) s.client_id, s.studio_id, si.id::text,
           'Платёж ' || trim(to_char(si.amount, 'FM999999990')) || ' ₾ до ' || to_char(si.due_date, 'DD.MM')
             || ' не внесён'
      from public.sale_installments si
      join public.sales s on s.id = si.sale_id
     where not si.paid and not coalesce(si.refunded, false) and s.client_id is not null
       and si.due_date <= v_today - v_days and si.due_date > v_today - 180
     order by s.client_id, si.due_date;
  end if;
end;
$$;
revoke all on function public.crm_scenario_candidates(text, jsonb, timestamptz) from public, anon, authenticated;

-- Те же кандидаты без уже обработанных: нет открытой сделки сценария, нет
-- срабатывания по этому событию и за последние 14 дней.
create or replace function public.crm_scenario_due(_key text, _params jsonb, _now timestamptz)
returns table (client_id uuid, studio_id uuid, ref text, detail text)
language sql
stable
security definer
set search_path = public
as $$
  select c.client_id, c.studio_id, c.ref, c.detail
    from public.crm_scenario_candidates(_key, _params, _now) c
   where not exists (select 1 from public.crm_scenario_log l
                      where l.key = _key and l.client_id = c.client_id
                        and (l.ref = c.ref or l.created_at > _now - interval '14 days'))
     and not exists (select 1 from public.crm_deals d
                       join public.crm_contacts ct on ct.id = d.contact_id
                      where ct.client_id = c.client_id and d.closed_at is null and d.scenario = _key)
$$;
revoke all on function public.crm_scenario_due(text, jsonb, timestamptz) from public, anon, authenticated;

-- Сколько клиентов подходит прямо сейчас (с параметрами из формы).
create or replace function public.crm_scenario_preview(p_key text, p_params jsonb default null)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.auth_crm_can_manage() then
    raise exception 'crm_forbidden' using errcode = '42501';
  end if;
  return (select count(*) from public.crm_scenario_due(
            p_key, coalesce(p_params, (select params from public.crm_scenarios where key = p_key)), now()));
end;
$$;
revoke all on function public.crm_scenario_preview(text, jsonb) from public, anon;
grant execute on function public.crm_scenario_preview(text, jsonb) to authenticated;

-- Проход: сделки по включённым сценариям. Возвращает, сколько заведено.
create or replace function public.crm_scenarios_run(p_now timestamptz default now(), p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  sc public.crm_scenarios;
  c record;
  v_client public.clients;
  v_contact uuid;
  v_deal uuid;
  v_name text;
  v_users uuid[];
  v_user uuid;
  v_cursor integer;
  v_made integer := 0;
begin
  for sc in select * from public.crm_scenarios s
             where s.enabled and s.stage_id is not null
               and exists (select 1 from public.crm_stages st
                            where st.id = s.stage_id and st.kind = 'open')
             order by s.sort_order loop
    for c in select * from public.crm_scenario_due(sc.key, sc.params, p_now)
              limit greatest(1, least(p_limit, 1000)) loop
      select * into v_client from public.clients where id = c.client_id;
      continue when v_client.id is null;
      v_name := coalesce(nullif(btrim(v_client.full_name), ''),
                         nullif(btrim(concat_ws(' ', v_client.last_name, v_client.first_name)), ''),
                         'Клиент');
      select ct.id into v_contact from public.crm_contacts ct
       where ct.client_id = v_client.id order by ct.created_at limit 1;
      if v_contact is null then
        insert into public.crm_contacts (name, phone, email, client_id)
        values (left(v_name, 200), left(v_client.phone, 40), left(v_client.email, 200), v_client.id)
        returning id into v_contact;
      end if;

      -- Ответственный — по очереди из «Распределения заявок» клуба.
      v_user := null;
      select array_agg(x.id order by x.ord), max(ds.user_cursor) into v_users, v_cursor
        from public.crm_distribution_studios ds
        cross join lateral unnest(ds.user_ids) with ordinality as x(id, ord)
       where ds.studio_id = c.studio_id
         and exists (select 1 from auth.users u where u.id = x.id);
      if coalesce(cardinality(v_users), 0) > 0 then
        v_user := v_users[1 + v_cursor % cardinality(v_users)];
        update public.crm_distribution_studios set user_cursor = user_cursor + 1
         where studio_id = c.studio_id;
      end if;

      insert into public.crm_deals (title, pipeline_id, stage_id, contact_id, studio_id, responsible_id,
                                    source, scenario, scenario_ref)
      values (left(v_name, 200), sc.pipeline_id, sc.stage_id, v_contact, c.studio_id, v_user,
              public.crm_scenario_label(sc.key), sc.key, c.ref)
      returning id into v_deal;
      -- Первую задачу сделке поставила база («Связаться с клиентом») — у
      -- сценария свой текст и пояснение.
      update public.crm_tasks set title = sc.task_title, note = c.detail
       where deal_id = v_deal and auto and done_at is null;
      perform public.crm_automation_note(v_deal, 'Сценарий «' || public.crm_scenario_label(sc.key) || '»: ' || c.detail);
      insert into public.crm_scenario_log (key, client_id, ref, deal_id)
      values (sc.key, c.client_id, c.ref, v_deal)
      on conflict do nothing;
      v_made := v_made + 1;
    end loop;
  end loop;
  return v_made;
end;
$$;
revoke all on function public.crm_scenarios_run(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.crm_scenarios_run(timestamptz, integer) to service_role;

-- Закрыть «Успешно» открытые сделки клиента по сценарию.
create or replace function public.crm_scenario_win(_client uuid, _key text, _note text, _budget numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.crm_deals;
  v_won uuid;
begin
  for d in select dl.* from public.crm_deals dl
            join public.crm_contacts c on c.id = dl.contact_id
           where c.client_id = _client and dl.closed_at is null and dl.scenario = _key loop
    select id into v_won from public.crm_stages where pipeline_id = d.pipeline_id and kind = 'won';
    if v_won is not null then
      update public.crm_deals set stage_id = v_won, budget = coalesce(_budget, budget) where id = d.id;
      perform public.crm_automation_note(d.id, _note);
    end if;
  end loop;
end;
$$;
revoke all on function public.crm_scenario_win(uuid, text, text, numeric) from public, anon, authenticated;

-- Покупка абонемента закрывает сделки клиента — кроме сделки о долге (её
-- закрывает внесённый платёж).
create or replace function public.crm_sales_ai()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_name text;
  d public.crm_deals;
  v_won uuid;
begin
  if new.client_id is null or new.onec_ref is not null or new.carryover_ref is not null
     or new.sale_kind = 'carryover' then
    return null;
  end if;
  select kind, name into v_kind, v_name from public.memberships where id = new.membership_id;
  if v_kind in ('trial', 'single') then
    perform public.crm_portal_event(new.client_id, 'trial_sale', 'sale:' || new.id::text);
    return null;
  end if;
  for d in select dl.* from public.crm_deals dl
            join public.crm_contacts c on c.id = dl.contact_id
           where c.client_id = new.client_id and dl.closed_at is null
             and dl.scenario is distinct from 'overdue_payment' loop
    select id into v_won from public.crm_stages where pipeline_id = d.pipeline_id and kind = 'won';
    if v_won is not null then
      update public.crm_deals
         set stage_id = v_won, sale_id = new.id, budget = coalesce(new.total_amount, budget)
       where id = d.id;
      perform public.crm_automation_note(
        d.id, 'Куплен абонемент' || coalesce(' «' || v_name || '»', '') || ' — сделка закрыта');
    end if;
  end loop;
  return null;
end;
$$;

-- Пришёл на занятие — сделка «давно не был» закрыта.
create or replace function public.crm_bookings_aiu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'booked' then
      perform public.crm_portal_event(new.client_id, 'booked', 'booked:' || new.id::text);
    end if;
  elsif new.status = 'attended' and old.status is distinct from 'attended' then
    perform public.crm_portal_event(new.client_id, 'attended', 'attended:' || new.id::text);
    perform public.crm_scenario_win(new.client_id, 'inactive', 'Клиент пришёл на занятие — сделка закрыта');
  elsif new.status = 'booked' and old.status = 'waitlist' then
    perform public.crm_portal_event(new.client_id, 'booked', 'booked:' || new.id::text);
  end if;
  return null;
end;
$$;

-- Внесён платёж, просроченных у клиента больше нет — сделка о долге закрыта.
create or replace function public.crm_installments_au()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
begin
  if not (new.paid and not old.paid) then
    return null;
  end if;
  select client_id into v_client from public.sales where id = new.sale_id;
  if v_client is null then
    return null;
  end if;
  if not exists (select 1 from public.sale_installments si
                   join public.sales s on s.id = si.sale_id
                  where s.client_id = v_client and not si.paid and not coalesce(si.refunded, false)
                    and si.due_date < (now() at time zone 'Asia/Tbilisi')::date) then
    perform public.crm_scenario_win(v_client, 'overdue_payment', 'Платёж внесён — сделка закрыта', new.amount);
  end if;
  return null;
end;
$$;
drop trigger if exists crm_installments_au on public.sale_installments;
create trigger crm_installments_au after update of paid on public.sale_installments
  for each row execute function public.crm_installments_au();

-- Итог по сценариям: сделки, заведённые за период, и чем они кончились.
create or replace function public.crm_scenarios_report(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', x.scenario, 'created', x.created, 'open', x.open, 'won', x.won,
           'lost', x.lost, 'won_budget', x.won_budget) order by x.created desc), '[]'::jsonb)
    from (select d.scenario, count(*) as created,
                 count(*) filter (where d.closed_at is null) as open,
                 count(*) filter (where s.kind = 'won') as won,
                 count(*) filter (where s.kind = 'lost') as lost,
                 coalesce(sum(d.budget) filter (where s.kind = 'won'), 0) as won_budget
            from public.crm_deals d
            join public.crm_stages s on s.id = d.stage_id
           where d.scenario is not null
             and d.created_at >= p_from::timestamptz and d.created_at < (p_to + 1)::timestamptz
           group by d.scenario) x
$$;
revoke all on function public.crm_scenarios_report(date, date) from public, anon;
grant execute on function public.crm_scenarios_report(date, date) to authenticated;

-- Сценарий сделки сотрудник не ставит и не меняет.
create or replace function public.crm_deals_scenario_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.scenario := null;
      new.scenario_ref := null;
    else
      new.scenario := old.scenario;
      new.scenario_ref := old.scenario_ref;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_deals_scenario_guard_biu on public.crm_deals;
create trigger crm_deals_scenario_guard_biu before insert or update on public.crm_deals
  for each row execute function public.crm_deals_scenario_guard();

-- Стартовый набор: воронка «Клиенты клуба» и сценарии (выключены — включает
-- руководитель в «Настройках» → «Сценарии»).
do $$
declare
  v_pipe uuid;
begin
  if exists (select 1 from public.crm_scenarios) then
    return;
  end if;
  insert into public.crm_pipelines (name) values ('Клиенты клуба') returning id into v_pipe;
  insert into public.crm_stages (pipeline_id, name, color, sort_order) values
    (v_pipe, 'Заканчивается абонемент', '#f59e0b', 1),
    (v_pipe, 'После пробного', '#f472b6', 2),
    (v_pipe, 'Давно не был', '#818cf8', 3),
    (v_pipe, 'Вернуть в клуб', '#38bdf8', 4),
    (v_pipe, 'Долг по оплате', '#ef4444', 5),
    (v_pipe, 'Договорились', '#22c55e', 6);
  insert into public.crm_scenarios (key, pipeline_id, stage_id, params, task_title, sort_order)
  select v.key, v_pipe, s.id, v.params::jsonb, v.task, v.ord
    from (values
      ('expiring', 'Заканчивается абонемент', '{"days": 7, "left": 2}', 'Предложить продление', 1),
      ('trial_no_purchase', 'После пробного', '{"days": 1}', 'Узнать впечатления о пробном и предложить абонемент', 2),
      ('inactive', 'Давно не был', '{"days": 14}', 'Узнать, почему не ходит, и записать на занятие', 3),
      ('lapsed', 'Вернуть в клуб', '{"days": 14}', 'Позвать обратно в клуб', 4),
      ('overdue_payment', 'Долг по оплате', '{"days": 1}', 'Напомнить о платеже', 5)
    ) as v(key, stage, params, task, ord)
    join public.crm_stages s on s.pipeline_id = v_pipe and s.name = v.stage;
end;
$$;
