-- ============================================================================
-- Абонемент переноса (решение владельца 2026-11-10: куплена студия растяжки
-- с действующей базой клиентов). Пакетные клубы.
--
-- Владелец заводит в «Номенклатурах» номенклатуру типа «Абонемент переноса»
-- (memberships.kind = 'carryover') и задаёт ей только название (и переводы).
-- Всем перенесённым клиентам выдаётся этот абонемент — у каждого свой
-- остаток и срок: их несёт продажа, а не номенклатура.
--
--   1. memberships.kind = 'carryover': цена 0, без количества и срока, один
--      платёж, в приложении не продаётся (is_active = false — витрина
--      приложения показывает только is_active) —
--      memberships_carryover_terms_check.
--   2. sales.sale_kind = 'carryover' — тип продажи «Перенос»; у такой
--      продажи — carryover_visits / carryover_personal / carryover_diagnostics
--      (остаток групповых, персональных, диагностик) и carryover_starts_on /
--      carryover_ends_on (срок, как был в прежней студии). Тип продажи и тип
--      номенклатуры совпадают (sales_carryover_guard). Сумма продажи — долг
--      клиента за абонемент (0 — оплачен полностью): долг — невнесённый
--      платёж рассрочки, внесут — деньги в выручке и кассе клуба продажи,
--      как обычная доплата. Скидки и «цены по прайсу» нет.
--   3. activate_membership_from_sale: по продаже переноса выдаётся абонемент
--      сразу с этими остатками и сроком (не «ожидает посещения»). Вид
--      баланса — групповой (персональные — подарочным остатком при нём, как
--      у пакета тренировок); только персональные — пакет персональных. Живой
--      абонемент того же вида у клиента не вытесняется: перенос встаёт в
--      очередь (packages_settle), как продление.
--      client_memberships_packages_fill остатки переноса не трогает.
--   4. Дальше — как у любого абонемента пакетных клубов: действует во всех
--      клубах сети (общая база клиентов), списание при «Посетил»,
--      заморозка, «Изменить» в карточке клиента, возврат, удаление,
--      «Переоформить». Зарплата: бонус — только если у продажи указан
--      администратор (как у переноса из 1С; «Поменять администратора» в
--      «Абонементах»), и только с внесённых доплат.
--   5. Клиент читает номенклатуру своих абонементов, даже скрытую из витрины
--      (политика «memberships client held»): иначе у абонемента переноса
--      (и «Остатка из 1С») в приложении не было бы названия — скрытая
--      номенклатура другого клуба сети клиенту не видна.
--   6. NPS: клиент с абонементом переноса — не новичок (опросы «Первые
--      занятия» и «Первый месяц» ему не приходят); тело nps_pending_survey —
--      как в 2026-10-16_zz_rls_initplan_perf.sql, плюс эта проверка.
--   7. Триггер «Мало тренировок»: у номенклатуры переноса нет количества, и
--      проверка «остаток меньше, чем в пакете» не пускала пуш никогда — у
--      переноса её нет. Тело push_triggers_run — как в
--      2026-10-15_zzzz_push_review_fixes.sql, кроме этой строки.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

-- 1. Номенклатура -----------------------------------------------------------

alter table public.memberships drop constraint if exists memberships_kind_check;
alter table public.memberships add constraint memberships_kind_check
  check (kind in ('package', 'trial', 'personal', 'single', 'carryover'));

alter table public.memberships drop constraint if exists memberships_carryover_terms_check;
alter table public.memberships add constraint memberships_carryover_terms_check
  check (
    kind <> 'carryover'
    or (price = 0 and max_payments = 1 and not is_active
        and visits_count is null and duration_days is null
        and personal_count = 0 and diagnostics_count = 0)
  );

-- Выданную номенклатуру нельзя перевести в перенос и обратно: у переноса
-- остаток и срок — у продажи, у прочих — у номенклатуры.
create or replace function public.memberships_carryover_kind_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.kind = 'carryover') is distinct from (new.kind = 'carryover')
     and exists (select 1 from public.sales s where s.membership_id = old.id) then
    raise exception 'Номенклатуру уже выдавали — тип «Абонемент переноса» у неё не меняется'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_carryover_kind_guard_bu on public.memberships;
create trigger memberships_carryover_kind_guard_bu
  before update of kind on public.memberships
  for each row execute function public.memberships_carryover_kind_guard();

comment on column public.memberships.kind is
  'Пакетные клубы: package — пакет тренировок, personal — пакет персональных, trial — пробное посещение, single — разовое посещение, carryover — абонемент переноса (остаток и срок — у продажи, sales.carryover_*).';

-- 2. Продажа переноса -------------------------------------------------------

alter table public.sales add column if not exists carryover_visits int;
alter table public.sales add column if not exists carryover_personal int;
alter table public.sales add column if not exists carryover_diagnostics int;
alter table public.sales add column if not exists carryover_starts_on date;
alter table public.sales add column if not exists carryover_ends_on date;

comment on column public.sales.carryover_visits is
  'Абонемент переноса: сколько групповых тренировок перенесено (остаток в прежней студии).';
comment on column public.sales.carryover_personal is
  'Абонемент переноса: сколько персональных тренировок перенесено.';
comment on column public.sales.carryover_diagnostics is
  'Абонемент переноса: сколько диагностик тела перенесено.';
comment on column public.sales.carryover_starts_on is
  'Абонемент переноса: начало срока (как в прежней студии).';
comment on column public.sales.carryover_ends_on is
  'Абонемент переноса: окончание срока (как в прежней студии).';

alter table public.sales drop constraint if exists sales_sale_kind_check;
alter table public.sales add constraint sales_sale_kind_check
  check (sale_kind is null or sale_kind in ('new', 'trial', 'upsell', 'renewal', 'carryover'));

alter table public.sales drop constraint if exists sales_carryover_terms_check;
alter table public.sales add constraint sales_carryover_terms_check
  check (
    sale_kind is distinct from 'carryover'
    or (carryover_visits >= 0 and carryover_personal >= 0 and carryover_diagnostics >= 0
        and carryover_visits + carryover_personal + carryover_diagnostics > 0
        and carryover_starts_on is not null and carryover_ends_on is not null
        and carryover_ends_on >= carryover_starts_on)
  );

-- Тип продажи «Перенос» ⇔ номенклатура «Абонемент переноса», только в
-- пакетном клубе; цены по прайсу и скидки у переноса нет.
create or replace function public.sales_carryover_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_carryover boolean;
begin
  select m.kind = 'carryover' into v_carryover
    from public.memberships m
   where m.id = new.membership_id;
  v_carryover := coalesce(v_carryover, false);

  if tg_op = 'UPDATE'
     and new.membership_id is not distinct from old.membership_id
     and new.sale_kind is not distinct from old.sale_kind then
    return new;
  end if;

  if v_carryover and new.sale_kind is distinct from 'carryover' then
    raise exception 'Абонемент переноса выдаётся только продажей типа «Перенос»'
      using errcode = '23514';
  end if;
  if not v_carryover and new.sale_kind = 'carryover' then
    raise exception 'Продажа типа «Перенос» — только абонемента переноса из «Номенклатур»'
      using errcode = '23514';
  end if;
  if v_carryover then
    if not exists (
      select 1 from public.studios s where s.id = new.studio_id and s.format = 'packages'
    ) then
      raise exception 'Абонемент переноса — только в пакетных клубах' using errcode = '23514';
    end if;
    new.list_price := 0;
    new.discount_amount := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_carryover_guard_biu on public.sales;
create trigger sales_carryover_guard_biu
  before insert or update of membership_id, sale_kind on public.sales
  for each row execute function public.sales_carryover_guard();

-- 3. Выдача абонемента ------------------------------------------------------
-- Тело — как в 2026-10-15_zzzz_packages_review_fixes.sql, плюс ветка переноса
-- в начале.

create or replace function public.activate_membership_from_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  computed_ends date;
  v_balance text;
  v_packages boolean;
  v_queue boolean;
begin
  select duration_days, visits_count, auto_renew, kind
    into m
    from public.memberships
    where id = new.membership_id;

  v_packages := exists (
    select 1 from public.studios s where s.id = new.studio_id and s.format = 'packages'
  );

  -- Абонемент переноса: остатки и срок — из продажи, срок уже идёт. Живой
  -- абонемент того же вида не вытесняется — перенос ждёт в очереди.
  if m.kind = 'carryover' and v_packages then
    v_balance := case
      when coalesce(new.carryover_visits, 0) = 0 and coalesce(new.carryover_personal, 0) > 0
        then 'personal'
      else 'group'
    end;
    v_queue := exists (
      select 1 from public.client_memberships cm
       where cm.client_id = new.client_id
         and cm.status in ('active', 'frozen')
         and cm.balance_kind = v_balance
    );
    insert into public.client_memberships (
      studio_id, client_id, membership_id, sale_id, source,
      started_at, ends_at, visits_left, personal_left, diagnostics_left,
      balance_kind, status, auto_renew, starts_on_first_visit
    ) values (
      new.studio_id, new.client_id, new.membership_id, new.id,
      coalesce(new.source, 'admin'),
      new.carryover_starts_on, new.carryover_ends_on,
      coalesce(new.carryover_visits, 0), coalesce(new.carryover_personal, 0),
      coalesce(new.carryover_diagnostics, 0),
      v_balance, case when v_queue then 'pending' else 'active' end, false, false
    );
    perform public.packages_settle(new.client_id);
    return new;
  end if;

  -- Пакет персональных — свой вид баланса: вытесняет только такой же.
  v_balance := case
    when m.kind = 'personal' and v_packages then 'personal'
    else 'group'
  end;

  -- Продление ничего не вытесняет: ждёт, пока закончится текущий. Так же —
  -- разовое посещение при живом групповом и пакет при живом разовом.
  v_queue := v_packages and (
    new.sale_kind = 'renewal'
    or (v_balance = 'group' and exists (
      select 1 from public.client_memberships cm
        join public.memberships lm on lm.id = cm.membership_id
       where cm.client_id = new.client_id
         and cm.status in ('active', 'frozen')
         and cm.balance_kind = 'group'
         and (m.kind = 'single' or lm.kind = 'single')
    ))
  );

  -- Срок — с первого посещения. balance_kind и personal_left поставит
  -- client_memberships_packages_fill.
  if v_queue then
    insert into public.client_memberships (
      studio_id, client_id, membership_id, sale_id, source,
      started_at, ends_at, visits_left, status, auto_renew, starts_on_first_visit
    ) values (
      new.studio_id, new.client_id, new.membership_id, new.id,
      coalesce(new.source, 'admin'),
      null, null, m.visits_count, 'pending', false, true
    );
    perform public.packages_settle(new.client_id);
    return new;
  end if;

  update public.client_memberships
     set status = 'replaced'
   where client_id = new.client_id
     and status in ('active','frozen')
     and balance_kind = v_balance;

  if v_packages then
    -- «Ожидает посещения»: срок пойдёт с первого посещения.
    insert into public.client_memberships (
      studio_id, client_id, membership_id, sale_id, source,
      started_at, ends_at, visits_left, status, auto_renew, starts_on_first_visit
    ) values (
      new.studio_id, new.client_id, new.membership_id, new.id,
      coalesce(new.source, 'admin'),
      null, null, m.visits_count, 'active', false, true
    );
    return new;
  end if;

  computed_ends := case
    when m.duration_days is not null
      then (new.sold_at + (m.duration_days || ' days')::interval)::date
    else null
  end;

  -- balance_kind и personal_left поставит client_memberships_packages_fill.
  insert into public.client_memberships (
    studio_id, client_id, membership_id, sale_id, source,
    started_at, ends_at, visits_left, status, auto_renew
  ) values (
    new.studio_id, new.client_id, new.membership_id, new.id,
    coalesce(new.source, 'admin'),
    new.sold_at, computed_ends, m.visits_count, 'active',
    coalesce(m.auto_renew, false)
  );

  return new;
end
$$;

-- Остатки по номенклатуре; у абонемента переноса их нет — остаются те, с
-- которыми строку вставили (продажа переноса, перенос истории). Тело — как в
-- 2026-10-15_zz_diagnostics_client_requests.sql, плюс ветка переноса.
create or replace function public.client_memberships_packages_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_personal int;
  v_diagnostics int;
begin
  select m.kind, m.personal_count, m.diagnostics_count into v_kind, v_personal, v_diagnostics
    from public.memberships m
    join public.studios s on s.id = m.studio_id and s.format = 'packages'
   where m.id = new.membership_id;
  if found then
    if v_kind = 'carryover' then
      new.visits_left := coalesce(new.visits_left, 0);
      new.personal_left := coalesce(new.personal_left, 0);
      new.diagnostics_left := coalesce(new.diagnostics_left, 0);
      new.balance_kind := case
        when new.visits_left = 0 and new.personal_left > 0 then 'personal'
        else 'group'
      end;
      return new;
    end if;
    new.personal_left := coalesce(v_personal, 0);
    new.diagnostics_left := coalesce(v_diagnostics, 0);
    if v_kind = 'personal' then
      new.balance_kind := 'personal';
      new.visits_left := 0;
    else
      new.balance_kind := 'group';
    end if;
  end if;
  return new;
end;
$$;

-- 5. Номенклатура своих абонементов — клиенту ----------------------------------

-- Номенклатура абонементов вызывающего (по его карточкам). Массивом — для
-- политики в виде initplan (2026-10-16_zz_rls_initplan_perf.sql).
create or replace function public.auth_held_membership_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct cm.membership_id), '{}')
    from public.client_memberships cm
    join public.clients c on c.id = cm.client_id
   where c.user_id = auth.uid();
$$;

revoke all on function public.auth_held_membership_ids() from public, anon;
grant execute on function public.auth_held_membership_ids() to authenticated, service_role;

drop policy if exists "memberships client held" on public.memberships;
create policy "memberships client held" on public.memberships
  for select to authenticated
  using (id = any ((select public.auth_held_membership_ids())::uuid[]));

-- 6. NPS: перенесённый клиент — не новичок -----------------------------------

CREATE OR REPLACE FUNCTION public.nps_pending_survey(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Tbilisi')::date;
  v_cards uuid[];
  v_since date;
  v_newcomer boolean;
  v_candidates jsonb := '[]'::jsonb;  -- в порядке приоритета
  v_cand jsonb;
  v_prompt public.nps_survey_prompts%rowtype;
  v_last_shown timestamptz;
  v_prev_count int;
  v_prev_end date;
  r record;
  v record;
begin
  if p_user is null then
    return null;
  end if;
  select coalesce(array_agg(c.id), '{}') into v_cards from public.clients c where c.user_id = p_user;
  if cardinality(v_cards) = 0 then
    return null;
  end if;

  -- Новичок: самая ранняя дата клиента в базе — регистрация, первый абонемент
  -- (и пробный), первое посещение — не раньше 120 дней назад.
  select least(
    (select min(c.registration_date) from public.clients c where c.id = any(v_cards)),
    (select min(least(cm.started_at, (cm.created_at at time zone 'Asia/Tbilisi')::date))
       from public.client_memberships cm where cm.client_id = any(v_cards)),
    (select min((se.starts_at at time zone 'Asia/Tbilisi')::date)
       from public.schedule_bookings b
       join public.schedule_entries se on se.id = b.entry_id
      where (b.user_id = p_user or b.client_id = any(v_cards))
        and b.status = 'attended')
  ) into v_since;
  v_newcomer := v_since is null or v_since >= v_today - 120;
  -- Перенесён из купленной студии (абонемент переноса) — клиент не новый
  -- (2026-11-10_packages_carryover_membership.sql).
  if v_newcomer and exists (
    select 1 from public.client_memberships cm
      join public.memberships m on m.id = cm.membership_id
     where cm.client_id = any(v_cards)
       and m.kind = 'carryover'
  ) then
    v_newcomer := false;
  end if;

  -- После возобновления: последний купленный абонемент (не пробный) за 120
  -- дней, перед которым клиент был без абонемента дольше 14 дней. Конец
  -- прежнего: дата окончания; действующий без даты — не кончился; заменённый
  -- без даты — до покупки, которая его заменила; закончившийся без даты — по
  -- последнему списанному посещению. Возвращённый или отменённый до начала
  -- срока абонементом не считается.
  for r in
    select cm.id, cm.client_id, cm.created_at,
           coalesce(s.sold_at, (cm.created_at at time zone 'Asia/Tbilisi')::date) as bought_on
      from public.client_memberships cm
      join public.memberships m on m.id = cm.membership_id
      left join public.sales s on s.id = cm.sale_id
     where cm.client_id = any(v_cards)
       and coalesce(m.kind, 'package') not in ('trial', 'single')
       and cm.status <> 'refunded'
       and cm.created_at > v_now - interval '120 days'
     order by cm.created_at desc
  loop
    select count(*),
           max(case
                 when p.ends_at is not null then p.ends_at
                 when p.status in ('active', 'frozen', 'pending') then 'infinity'::date
                 when p.status = 'replaced' then coalesce(
                   (select min((n.created_at at time zone 'Asia/Tbilisi')::date)
                      from public.client_memberships n
                     where n.client_id = p.client_id
                       and n.created_at > p.created_at
                       and coalesce(n.balance_kind, 'group') = coalesce(p.balance_kind, 'group')),
                   (p.created_at at time zone 'Asia/Tbilisi')::date)
                 else coalesce(
                   (select max((se.starts_at at time zone 'Asia/Tbilisi')::date)
                      from public.schedule_bookings b
                      join public.schedule_entries se on se.id = b.entry_id
                     where b.charged_membership_id = p.id),
                   p.started_at,
                   (p.created_at at time zone 'Asia/Tbilisi')::date)
               end)
      into v_prev_count, v_prev_end
      from public.client_memberships p
      join public.memberships pm on pm.id = p.membership_id
     where p.client_id = any(v_cards)
       and p.id <> r.id
       and p.created_at < r.created_at
       and coalesce(pm.kind, 'package') not in ('trial', 'single')
       and not (p.status in ('refunded', 'cancelled') and p.started_at is null);

    if v_prev_count > 0 and v_prev_end < r.bought_on - 14 then
      select se.ends_at into v
        from public.schedule_bookings b
        join public.schedule_entries se on se.id = b.entry_id
       where (b.user_id = p_user or b.client_id = any(v_cards))
         and b.status = 'attended'
         and se.kind in ('group', 'personal')
         and (se.starts_at at time zone 'Asia/Tbilisi')::date >= r.bought_on
       order by se.starts_at, b.created_at
       offset 1 limit 1;
      if found and v.ends_at <= v_now and v.ends_at > v_now - interval '21 days' then
        v_candidates := v_candidates || jsonb_build_object(
          'survey_type', 'after_return', 'occasion', r.id::text, 'client_id', r.client_id);
      end if;
      exit;
    end if;
  end loop;

  -- Первые занятия: 4-е посещение закончилось.
  if v_newcomer then
    select b.client_id, se.ends_at into v
      from public.schedule_bookings b
      join public.schedule_entries se on se.id = b.entry_id
     where (b.user_id = p_user or b.client_id = any(v_cards))
       and b.status = 'attended'
       and se.kind in ('group', 'personal')
     order by se.starts_at, b.created_at
     offset 3 limit 1;
    if found and v.ends_at <= v_now and v.ends_at > v_now - interval '14 days' then
      v_candidates := v_candidates || jsonb_build_object(
        'survey_type', 'first_lessons', 'occasion', 'once', 'client_id', v.client_id);
    end if;
  end if;

  -- Первый месяц: 30 дней с начала первого абонемента, клиент ещё с нами.
  if v_newcomer then
    select cm.client_id, cm.started_at into v
      from public.client_memberships cm
      join public.memberships m on m.id = cm.membership_id
     where cm.client_id = any(v_cards)
       and coalesce(m.kind, 'package') not in ('trial', 'single')
       and cm.started_at is not null
     order by cm.started_at, cm.created_at
     limit 1;
    if found
       and v_today between v.started_at + 30 and v.started_at + 30 + 20
       and exists (
         select 1
           from public.client_memberships cm
           join public.memberships m on m.id = cm.membership_id
          where cm.client_id = any(v_cards)
            and coalesce(m.kind, 'package') not in ('trial', 'single')
            and cm.status not in ('refunded', 'cancelled')
            and ((cm.status in ('active', 'frozen', 'pending')
                  and (cm.ends_at is null or cm.ends_at >= v_today))
                 or cm.ends_at >= v_today - 14)
       ) then
      v_candidates := v_candidates || jsonb_build_object(
        'survey_type', 'first_month', 'occasion', 'once', 'client_id', v.client_id);
    end if;
  end if;

  -- Перед продлением: до окончания действующего абонемента 10 дней или меньше;
  -- в пакетном клубе — и когда осталось 2 тренировки или меньше. Остаток
  -- подписочных абонементов не списывается — по нему не смотрим. Продление
  -- уже куплено (следующий абонемент того же вида ждёт в очереди или уже
  -- оформлен) — не спрашиваем: опрос нужен, чтобы отработать возражения до
  -- продажи (решение владельца 2026-10-15).
  select cm.id, cm.client_id into v
    from public.client_memberships cm
    join public.memberships m on m.id = cm.membership_id
    join public.studios st on st.id = cm.studio_id
   where cm.client_id = any(v_cards)
     and coalesce(m.kind, 'package') not in ('trial', 'single')
     and cm.status = 'active'
     and cm.started_at is not null
     and (cm.ends_at is null or cm.ends_at >= v_today)
     and ((cm.ends_at is not null and cm.ends_at - 10 <= v_today)
          or (st.format = 'packages'
              and (case when cm.balance_kind = 'personal' then cm.personal_left
                        else cm.visits_left end) <= 2))
     and not exists (
       select 1
         from public.client_memberships nx
         join public.memberships nm on nm.id = nx.membership_id
        where nx.client_id = any(v_cards)
          and nx.id <> cm.id
          and nx.created_at > cm.created_at
          and coalesce(nm.kind, 'package') not in ('trial', 'single')
          and coalesce(nx.balance_kind, 'group') = coalesce(cm.balance_kind, 'group')
          and nx.status in ('pending', 'active', 'frozen'))
   order by cm.ends_at nulls last, cm.created_at
   limit 1;
  if found then
    v_candidates := v_candidates || jsonb_build_object(
      'survey_type', 'before_renewal', 'occasion', v.id::text, 'client_id', v.client_id);
  end if;

  if jsonb_array_length(v_candidates) = 0 then
    return null;
  end if;

  -- Показанный и не законченный (закрыли приложение) — снова, пока актуален.
  for v_cand in select value from jsonb_array_elements(v_candidates) loop
    select * into v_prompt
      from public.nps_survey_prompts p
     where p.user_id = p_user
       and p.survey_type = v_cand->>'survey_type'
       and p.occasion = v_cand->>'occasion';
    if found and v_prompt.closed_at is null and v_prompt.answered_at is null then
      return v_cand;
    end if;
  end loop;

  -- Новый — не чаще раза в 14 дней.
  select max(p.shown_at) into v_last_shown from public.nps_survey_prompts p where p.user_id = p_user;
  if v_last_shown > v_now - interval '14 days' then
    return null;
  end if;

  for v_cand in select value from jsonb_array_elements(v_candidates) loop
    -- Уже показывали — закрыт или отвечен.
    continue when exists (
      select 1 from public.nps_survey_prompts p
       where p.user_id = p_user
         and p.survey_type = v_cand->>'survey_type'
         and p.occasion = v_cand->>'occasion');
    if v_cand->>'survey_type' = 'before_renewal' then
      continue when v_last_shown > v_now - interval '30 days';
      continue when exists (
        select 1 from public.nps_survey_prompts p
         where p.user_id = p_user
           and p.survey_type = 'before_renewal'
           and p.shown_at > v_now - interval '90 days');
    end if;
    return v_cand;
  end loop;

  return null;
end;
$function$;

-- 7. «Мало тренировок» у абонемента переноса ----------------------------------

CREATE OR REPLACE FUNCTION public.push_triggers_run(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.push_triggers;
  r record;
  v_sent integer := 0;
  v_today date := (p_now at time zone 'Asia/Tbilisi')::date;
  v_hour integer := extract(hour from (p_now at time zone 'Asia/Tbilisi'))::integer;
  -- Ночью не шлём необязательное — уйдёт утром (окна событий — сутки и больше).
  v_quiet boolean := v_hour < 9 or v_hour >= 22;
  v_daily boolean;
  v_n integer;
  v_since timestamptz;
  v_year text := extract(year from (p_now at time zone 'Asia/Tbilisi'))::integer::text;
begin
  -- Два сервера при выкатке: второй просто пропускает проход.
  if not pg_try_advisory_xact_lock(hashtext('push_triggers_run')) then
    return 0;
  end if;

  delete from public.push_trigger_log where created_at < p_now - interval '400 days';

  for t in
    select * from public.push_triggers pt
     where pt.enabled
       and exists (select 1 from public.studios s where s.format = pt.format)
     order by pt.format, pt.key
  loop
    v_daily := v_hour >= coalesce((t.params ->> 'send_hour')::integer, 11) and v_hour < 22;

    case t.key

    -- Напоминание о занятии за N часов (ночное — утром или накануне вечером).
    -- Записавшимся позже момента напоминания не шлём: они только что записались.
    when 'class_reminder' then
      v_n := coalesce((t.params ->> 'hours')::integer, 3);
      for r in
        select distinct on (u.user_id, b.entry_id)
               u.user_id, u.client_id, e.studio_id, b.entry_id
          from public.schedule_bookings b
          join public.schedule_entries e on e.id = b.entry_id
          join public.studios s on s.id = e.studio_id and s.format = t.format
          left join public.clients c on c.id = b.client_id
          cross join lateral (
            select coalesce(b.user_id, c.user_id) as user_id,
                   coalesce(c.id, (select c2.id from public.clients c2
                                    where c2.user_id = b.user_id order by c2.created_at limit 1)) as client_id
          ) u
         where b.status = 'booked'
           and e.cancelled_at is null
           and coalesce(e.kind, 'group') in ('group', 'personal', 'diagnostic')
           and e.starts_at > p_now
           and e.starts_at <= p_now + make_interval(hours => v_n + 13)
           and public.push_trigger_reminder_at(e.starts_at, v_n) <= p_now
           and coalesce(b.booked_at, b.created_at) <= public.push_trigger_reminder_at(e.starts_at, v_n)
           and u.user_id is not null
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = u.user_id and lg.ref = b.entry_id::text
           )
         order by u.user_id, b.entry_id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.entry_id::text,
             public.push_trigger_vars(r.client_id, r.studio_id, r.entry_id, null, null, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Записал не сам клиент (администратор в админке).
    when 'booked_for_client' then
      v_since := greatest(t.active_since, p_now - interval '6 hours');
      for r in
        select distinct on (u.user_id, b.entry_id)
               u.user_id, u.client_id, e.studio_id, b.entry_id, x.ref
          from public.schedule_bookings b
          join public.schedule_entries e on e.id = b.entry_id
          join public.studios s on s.id = e.studio_id and s.format = t.format
          left join public.clients c on c.id = b.client_id
          cross join lateral (
            select coalesce(b.user_id, c.user_id) as user_id,
                   coalesce(c.id, (select c2.id from public.clients c2
                                    where c2.user_id = b.user_id order by c2.created_at limit 1)) as client_id
          ) u
          cross join lateral (
            select b.id::text || ':' || floor(extract(epoch from b.booked_at))::bigint::text as ref
          ) x
         where b.status = 'booked'
           and b.booked_at >= v_since
           and b.booked_at <= p_now
           and b.booked_by is not null
           and b.booked_by is distinct from u.user_id
           and e.cancelled_at is null
           and e.starts_at > p_now
           and u.user_id is not null
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = u.user_id and lg.ref = x.ref
           )
         order by u.user_id, b.entry_id, b.booked_at desc
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.ref,
             public.push_trigger_vars(r.client_id, r.studio_id, r.entry_id, null, null, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Клуб отменил занятие: записи переведены в «Отменено» тем же
    -- cancel_schedule_entry (cancelled_at записи = cancelled_at занятия).
    when 'class_cancelled' then
      v_since := greatest(t.active_since, p_now - interval '24 hours');
      for r in
        select distinct on (u.user_id, b.entry_id)
               u.user_id, u.client_id, e.studio_id, b.entry_id, x.ref
          from public.schedule_entries e
          join public.studios s on s.id = e.studio_id and s.format = t.format
          join public.schedule_bookings b on b.entry_id = e.id
          left join public.clients c on c.id = b.client_id
          cross join lateral (
            select coalesce(b.user_id, c.user_id) as user_id,
                   coalesce(c.id, (select c2.id from public.clients c2
                                    where c2.user_id = b.user_id order by c2.created_at limit 1)) as client_id
          ) u
          cross join lateral (
            select b.entry_id::text || ':' || floor(extract(epoch from e.cancelled_at))::bigint::text as ref
          ) x
         where e.cancelled_at >= v_since
           and e.cancelled_at <= p_now
           and e.starts_at > p_now
           and b.status = 'cancelled'
           and b.cancelled_at = e.cancelled_at
           and u.user_id is not null
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = u.user_id and lg.ref = x.ref
           )
         order by u.user_id, b.entry_id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.ref,
             public.push_trigger_vars(r.client_id, r.studio_id, r.entry_id, null, null, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Замена тренера — тем, кто записался до замены.
    when 'trainer_substitution' then
      v_since := greatest(t.active_since, p_now - interval '24 hours');
      for r in
        select distinct on (u.user_id, b.entry_id)
               u.user_id, u.client_id, e.studio_id, b.entry_id, x.ref
          from public.schedule_entry_substitutions su
          join public.schedule_entries e on e.id = su.entry_id
          join public.studios s on s.id = e.studio_id and s.format = t.format
          join public.schedule_bookings b on b.entry_id = e.id
          left join public.clients c on c.id = b.client_id
          cross join lateral (
            select coalesce(b.user_id, c.user_id) as user_id,
                   coalesce(c.id, (select c2.id from public.clients c2
                                    where c2.user_id = b.user_id order by c2.created_at limit 1)) as client_id
          ) u
          cross join lateral (select b.entry_id::text || ':' || su.trainer_id::text as ref) x
         where su.created_at >= v_since
           and su.created_at <= p_now
           and e.cancelled_at is null
           and e.starts_at > p_now
           and b.status = 'booked'
           and coalesce(b.booked_at, b.created_at) < su.created_at
           and u.user_id is not null
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = u.user_id and lg.ref = x.ref
           )
         order by u.user_id, b.entry_id, su.created_at desc
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.ref,
             public.push_trigger_vars(r.client_id, r.studio_id, r.entry_id, null, null, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Абонемент по продаже (в админке или в приложении) выдан.
    when 'membership_activated' then
      v_since := greatest(t.active_since, p_now - interval '24 hours');
      for r in
        select distinct on (c.user_id, cm.id)
               c.user_id, c.id as client_id, cm.studio_id, cm.id as cm_id, cm.membership_id
          from public.client_memberships cm
          join public.clients c on c.id = cm.client_id
          join public.studios s on s.id = cm.studio_id and s.format = t.format
         where cm.sale_id is not null
           and cm.created_at >= v_since
           and cm.created_at <= p_now
           and cm.status in ('active', 'pending')
           and c.user_id is not null
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = c.user_id and lg.ref = cm.id::text
           )
         order by c.user_id, cm.id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.cm_id::text,
             public.push_trigger_vars(r.client_id, r.studio_id, null, r.membership_id, null, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Срок абонемента кончается через N дней, продления нет (ни ждущего, ни
    -- автопродления). Пробный — не в счёт.
    when 'membership_expiring' then
      continue when not v_daily;
      v_n := coalesce((t.params ->> 'days')::integer, 3);
      for r in
        select distinct on (c.user_id, cm.id)
               c.user_id, c.id as client_id, cm.studio_id, cm.id as cm_id, cm.membership_id, cm.ends_at
          from public.client_memberships cm
          join public.clients c on c.id = cm.client_id
          join public.studios s on s.id = cm.studio_id and s.format = t.format
          join public.memberships m on m.id = cm.membership_id
         where cm.status = 'active'
           and cm.ends_at between v_today and v_today + v_n
           and not coalesce(cm.auto_renew, false)
           and coalesce(m.kind, 'package') <> 'trial'
           and c.user_id is not null
           and not exists (
             select 1 from public.client_memberships nx
              where nx.client_id = cm.client_id
                and nx.id <> cm.id
                and coalesce(nx.balance_kind, 'group') = coalesce(cm.balance_kind, 'group')
                and nx.status in ('pending', 'active', 'frozen')
                and (nx.status = 'pending' or nx.ends_at is null or nx.ends_at > cm.ends_at)
           )
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = c.user_id and lg.ref = cm.id::text
           )
         order by c.user_id, cm.id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.cm_id::text,
             public.push_trigger_vars(r.client_id, r.studio_id, null, r.membership_id, r.ends_at,
               jsonb_build_object('days', (r.ends_at - v_today)::text), p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Срок абонемента вышел 1–3 дня назад, другого действующего нет.
    when 'membership_ended' then
      continue when not v_daily;
      for r in
        select distinct on (c.user_id, cm.id)
               c.user_id, c.id as client_id, cm.studio_id, cm.id as cm_id, cm.membership_id, cm.ends_at
          from public.client_memberships cm
          join public.clients c on c.id = cm.client_id
          join public.studios s on s.id = cm.studio_id and s.format = t.format
          join public.memberships m on m.id = cm.membership_id
         where cm.status in ('active', 'expired')
           and cm.ends_at between v_today - 3 and v_today - 1
           -- Закончился по сроку: отхоженный (остаток 0) — не «срок вышел».
           and coalesce(case when cm.balance_kind = 'personal' then cm.personal_left else cm.visits_left end, 1) > 0
           and cm.ends_at >= (t.active_since at time zone 'Asia/Tbilisi')::date - 1
           and coalesce(m.kind, 'package') <> 'trial'
           and c.user_id is not null
           and not exists (
             select 1 from public.client_memberships nx
              where nx.client_id = cm.client_id
                and nx.id <> cm.id
                and coalesce(nx.balance_kind, 'group') = coalesce(cm.balance_kind, 'group')
                and nx.status in ('pending', 'active', 'frozen')
           )
           -- О закончившихся тренировках уже сказали.
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key in (t.key, 'visits_exhausted')
                and lg.user_id = c.user_id and lg.ref = cm.id::text
           )
         order by c.user_id, cm.id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.cm_id::text,
             public.push_trigger_vars(r.client_id, r.studio_id, null, r.membership_id, r.ends_at, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Пакетные: после списания осталось N тренировок или меньше (не ноль).
    when 'visits_low', 'visits_exhausted' then
      continue when v_quiet;
      v_n := coalesce((t.params ->> 'left')::integer, 2);
      v_since := greatest(t.active_since, p_now - interval '3 days');
      for r in
        select distinct on (c.user_id, cm.id)
               c.user_id, c.id as client_id, cm.studio_id, cm.id as cm_id, cm.membership_id,
               case when cm.balance_kind = 'personal' then cm.personal_left else cm.visits_left end as balance
          from public.client_memberships cm
          join public.clients c on c.id = cm.client_id
          join public.studios s on s.id = cm.studio_id and s.format = t.format
          join public.memberships m on m.id = cm.membership_id
         -- Пробное и разовое посещение (2026-10-15_zz_packages_single_visit.sql) — не в счёт.
         where coalesce(m.kind, 'package') not in ('trial', 'single')
           and c.user_id is not null
           and case when t.key = 'visits_low'
                    then cm.status = 'active'
                         and (case when cm.balance_kind = 'personal' then cm.personal_left else cm.visits_left end)
                             between 1 and v_n
                         -- У абонемента переноса количества в номенклатуре нет.
                         and (m.kind = 'carryover'
                              or (case when cm.balance_kind = 'personal' then cm.personal_left else cm.visits_left end)
                                 < coalesce(case when cm.balance_kind = 'personal' then m.personal_count else m.visits_count end, 0))
                    else cm.status in ('active', 'expired')
                         and (case when cm.balance_kind = 'personal' then cm.personal_left else cm.visits_left end) = 0
               end
           -- Тренировка списана недавно (после включения триггера).
           and exists (
             select 1 from public.schedule_bookings b
               join public.schedule_entries e on e.id = b.entry_id
              where b.charged_membership_id = cm.id
                and b.status in ('attended', 'no_show')
                and coalesce(b.charged_balance, '') <> 'diagnostic'
                and e.starts_at >= v_since
                and e.starts_at <= p_now
           )
           -- Продление уже куплено.
           and not exists (
             select 1 from public.client_memberships nx
              where nx.client_id = cm.client_id
                and nx.id <> cm.id
                and coalesce(nx.balance_kind, 'group') = coalesce(cm.balance_kind, 'group')
                and nx.status in ('pending', 'active', 'frozen')
           )
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = c.user_id and lg.ref = cm.id::text
           )
         order by c.user_id, cm.id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.cm_id::text,
             public.push_trigger_vars(r.client_id, r.studio_id, null, r.membership_id, null,
               jsonb_build_object('left', r.balance::text), p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Через N часов после пробной тренировки, если абонемент ещё не купили.
    -- Окно — 48 часов после момента отправки (ночь его не съедает).
    when 'trial_followup' then
      continue when v_quiet;
      v_n := coalesce((t.params ->> 'hours')::integer, 3);
      v_since := greatest(t.active_since, p_now - make_interval(hours => v_n + 48));
      for r in
        select distinct on (u.user_id, cm.id)
               u.user_id, cm.client_id, e.studio_id, cm.id as cm_id
          from public.schedule_bookings b
          join public.client_memberships cm on cm.id = b.charged_membership_id
          join public.memberships m on m.id = cm.membership_id and m.kind = 'trial'
          join public.schedule_entries e on e.id = b.entry_id
          join public.studios s on s.id = e.studio_id and s.format = t.format
          join public.clients c on c.id = cm.client_id
          cross join lateral (select coalesce(b.user_id, c.user_id) as user_id) u
         where b.status = 'attended'
           and coalesce(e.ends_at, e.starts_at + interval '1 hour') >= v_since
           and coalesce(e.ends_at, e.starts_at + interval '1 hour') + make_interval(hours => v_n) <= p_now
           and u.user_id is not null
           and not exists (
             select 1 from public.client_memberships nx
               join public.memberships nm on nm.id = nx.membership_id
              where nx.client_id = cm.client_id
                and nx.id <> cm.id
                and coalesce(nm.kind, 'package') <> 'trial'
                and nx.created_at > cm.created_at
           )
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = u.user_id and lg.ref = cm.id::text
           )
         order by u.user_id, cm.id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.cm_id::text,
             public.push_trigger_vars(r.client_id, r.studio_id, null, null, null, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Через N часов после посещения — оценить тренера (раз на тренера, пока
    -- клиент его не оценил). Окно — как у пробной.
    when 'rate_trainer' then
      continue when v_quiet;
      v_n := coalesce((t.params ->> 'hours')::integer, 2);
      v_since := greatest(t.active_since, p_now - make_interval(hours => v_n + 48));
      for r in
        select distinct on (u.user_id, tr.trainer_id)
               u.user_id, u.client_id, e.studio_id, b.entry_id, tr.trainer_id
          from public.schedule_bookings b
          join public.schedule_entries e on e.id = b.entry_id
          join public.studios s on s.id = e.studio_id and s.format = t.format
          left join public.clients c on c.id = b.client_id
          cross join lateral (
            select coalesce(b.user_id, c.user_id) as user_id,
                   coalesce(c.id, (select c2.id from public.clients c2
                                    where c2.user_id = b.user_id order by c2.created_at limit 1)) as client_id
          ) u
          cross join lateral (
            select coalesce(
              (select su.trainer_id from public.schedule_entry_substitutions su
                where su.entry_id = e.id order by su.created_at desc limit 1),
              (select et.trainer_id from public.schedule_entry_trainers et
                 join public.trainers tt on tt.id = et.trainer_id
                where et.entry_id = e.id order by tt.full_name limit 1)
            ) as trainer_id
          ) tr
          join public.trainers trn on trn.id = tr.trainer_id
         where b.status = 'attended'
           and coalesce(trn.role, 'trainer') in ('trainer', 'masseur')
           and coalesce(e.ends_at, e.starts_at + interval '1 hour') >= v_since
           and coalesce(e.ends_at, e.starts_at + interval '1 hour') + make_interval(hours => v_n) <= p_now
           and u.user_id is not null
           and not exists (
             select 1 from public.trainer_reviews rv
              where rv.trainer_id = tr.trainer_id and rv.user_id = u.user_id
           )
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = u.user_id and lg.ref = tr.trainer_id::text
           )
         order by u.user_id, tr.trainer_id, e.starts_at desc
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.trainer_id::text,
             public.push_trigger_vars(r.client_id, r.studio_id, r.entry_id, null, null, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- Платёж по рассрочке через N дней (0 — в день платежа) или просрочен
    -- на N дней (неделю после — не напоминаем).
    when 'installment_due', 'installment_overdue' then
      continue when not v_daily;
      v_n := coalesce((t.params ->> 'days')::integer, 1);
      for r in
        select distinct on (c.user_id, i.id)
               c.user_id, c.id as client_id, sa.studio_id, i.id as installment_id,
               sa.membership_id, i.due_date, i.amount
          from public.sale_installments i
          join public.sales sa on sa.id = i.sale_id
          join public.clients c on c.id = sa.client_id
          join public.studios s on s.id = sa.studio_id and s.format = t.format
         where not i.paid
           and not coalesce(i.refunded, false)
           and c.user_id is not null
           and case when t.key = 'installment_due'
                    then i.due_date between v_today and v_today + v_n
                    else i.due_date between v_today - v_n - 7 and v_today - greatest(v_n, 1)
               end
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = c.user_id and lg.ref = i.id::text
           )
         order by c.user_id, i.id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.installment_id::text,
             public.push_trigger_vars(r.client_id, r.studio_id, null, r.membership_id, r.due_date,
               jsonb_build_object('amount', trim_scale(r.amount)::text), p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- С действующим абонементом, но без посещений N дней (неделю после — не
    -- пишем) и без будущих записей — в клубах формата триггера. Диагностика
    -- тела — не тренировка.
    when 'no_visits' then
      continue when not v_daily;
      v_n := coalesce((t.params ->> 'days')::integer, 14);
      for r in
        with live as (
          select distinct on (c.user_id)
                 c.user_id, c.id as client_id, c.studio_id
            from public.client_memberships cm
            join public.clients c on c.id = cm.client_id
            join public.studios s on s.id = c.studio_id and s.format = t.format
           where cm.status = 'active'
             and c.user_id is not null
           order by c.user_id, c.created_at
        ),
        -- Последнее посещение. Записи раньше окна не нужны: если последнее
        -- посещение раньше окна, клиент и так не подходит.
        visits as (
          select coalesce(b.user_id, bc.user_id) as user_id,
                 max((e.starts_at at time zone 'Asia/Tbilisi')::date) as visit_date
            from public.schedule_bookings b
            join public.schedule_entries e on e.id = b.entry_id
            join public.studios es on es.id = e.studio_id and es.format = t.format
            left join public.clients bc on bc.id = b.client_id
           where b.status = 'attended'
             and coalesce(e.kind, 'group') <> 'diagnostic'
             and e.starts_at >= ((v_today - v_n - 7)::timestamp at time zone 'Asia/Tbilisi')
           group by 1
        )
        select live.user_id, live.client_id, live.studio_id, v.visit_date,
               v.visit_date::text || ':' || t.format as ref
          from live
          join visits v on v.user_id = live.user_id
         where v.visit_date between v_today - v_n - 7 and v_today - v_n
           -- Уже писали (прежний ref — без формата).
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = live.user_id
                and lg.ref in (v.visit_date::text || ':' || t.format, v.visit_date::text)
           )
           and not exists (
             select 1 from public.schedule_bookings b
               join public.schedule_entries e on e.id = b.entry_id
               join public.studios es on es.id = e.studio_id and es.format = t.format
               left join public.clients bc on bc.id = b.client_id
              where b.status = 'booked'
                and e.starts_at > p_now
                and e.cancelled_at is null
                and coalesce(b.user_id, bc.user_id) = live.user_id
           )
         order by live.user_id
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, r.ref,
             public.push_trigger_vars(r.client_id, r.studio_id, null, null, r.visit_date,
               jsonb_build_object('days', (v_today - r.visit_date)::text), p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    -- День рождения: карточка клиента или анкета приложения. Раз в год в
    -- каждом приложении (прежний ref — год без формата).
    when 'birthday' then
      continue when not v_daily;
      for r in
        select distinct on (c.user_id)
               c.user_id, c.id as client_id, c.studio_id
          from public.clients c
          join public.studios s on s.id = c.studio_id and s.format = t.format
          left join public.member_profiles mp on mp.user_id = c.user_id
         where c.user_id is not null
           and to_char(coalesce(c.birthday, mp.birth_date), 'MM-DD') = to_char(v_today, 'MM-DD')
           and not exists (
             select 1 from public.push_trigger_log lg
              where lg.trigger_key = t.key and lg.user_id = c.user_id
                and lg.ref in (v_year || ':' || t.format, v_year)
           )
         order by c.user_id, c.created_at
         limit 500
      loop
        if public.push_trigger_send(t, r.user_id, r.studio_id, v_year || ':' || t.format,
             public.push_trigger_vars(r.client_id, r.studio_id, null, null, null, '{}', p_now)) then
          v_sent := v_sent + 1;
        end if;
      end loop;

    else
      null;
    end case;
  end loop;

  return v_sent;
end;
$function$;

notify pgrst, 'reload schema';
