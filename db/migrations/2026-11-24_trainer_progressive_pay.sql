-- ============================================================================
-- Прогрессивная ставка — по тренеру, а не по клубу (решение владельца
-- 2026-11-24; прежняя привязка к клубу — 2026-11-11_studio_per_person_pay.sql).
--
-- Формат оплаты тренера — trainer_pay_rates.pay_format:
--   classic     — «Классическая»: ставка за групповую и 5 % тренеру при продаже;
--   progressive — «Прогрессивная»: групповые по числу «Посетил» по СВОИМ
--                 схемам тренера, в любом клубе сети; бонус
--                 trainer_pay_rates.trial_sale_bonus ₾ тренеру первого
--                 пробного клиента за купленный абонемент (вместо 5 %).
-- Суммы прогрессивной ставки — у каждого тренера свои (решение владельца):
-- trainer_pay_schemes (как studio_pay_schemes: минимум до N человек, ₾ за
-- человека, бонусы за наполняемость, is_default — для тренировок без своей
-- схемы) и trainer_pay_scheme_workouts (тренировка → схема тренера).
-- Заполняются у всех, действуют только при pay_format = 'progressive'.
--
-- Выплаты: классическая — аванс 1–19 и основная 20–конец месяца, как раньше;
-- прогрессивная — 11-го за 26–10 и 26-го за 11–25 (считает админка, отметки
-- — в тех же payroll_payouts по границам периода).
--
-- Перенос: тренерам клубов с прежней настройкой «по числу людей» копируются
-- схемы и бонус клуба; формат «Прогрессивная» — тем, кто работает только в
-- таких клубах. studio_pay_* больше не читаются (таблицы оставлены).
--
-- payroll_lines и payroll_sale_payment_rows — тела как в
-- 2026-11-11_studio_per_person_pay.sql, условия клуба заменены условиями
-- тренера. Актуальные определения — здесь.
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

alter table public.trainer_pay_rates
  add column if not exists pay_format text not null default 'classic';
alter table public.trainer_pay_rates
  add column if not exists trial_sale_bonus numeric(10,2);

alter table public.trainer_pay_rates drop constraint if exists trainer_pay_rates_format_check;
alter table public.trainer_pay_rates add constraint trainer_pay_rates_format_check
  check (pay_format in ('classic', 'progressive')
         and (trial_sale_bonus is null or trial_sale_bonus >= 0));

comment on column public.trainer_pay_rates.pay_format is
  'Формат оплаты тренера: classic — ставка за групповую и 5 % при продаже; progressive — групповые по числу людей по trainer_pay_schemes.';
comment on column public.trainer_pay_rates.trial_sale_bonus is
  'Прогрессивная ставка: ₾ тренеру первого пробного клиента за купленный абонемент (вместо 5 % при продаже); null — 5 %.';

create table if not exists public.trainer_pay_schemes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  min_amount numeric(10,2) not null default 0,
  min_up_to integer not null default 0,
  per_person numeric(10,2) not null default 0,
  bonuses jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.trainer_pay_schemes drop constraint if exists trainer_pay_schemes_values_check;
alter table public.trainer_pay_schemes add constraint trainer_pay_schemes_values_check
  check (
    length(btrim(name)) between 1 and 60
    and min_amount >= 0 and per_person >= 0
    and min_up_to between 0 and 100
    and jsonb_typeof(bonuses) = 'array'
  );

create unique index if not exists trainer_pay_schemes_one_default
  on public.trainer_pay_schemes (trainer_id) where is_default;
create index if not exists trainer_pay_schemes_trainer_idx on public.trainer_pay_schemes (trainer_id);

comment on table public.trainer_pay_schemes is
  'Прогрессивная ставка тренера: до min_up_to человек — min_amount, больше — per_person × люди, плюс бонус bonuses [{from, amount}].';

create table if not exists public.trainer_pay_scheme_workouts (
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  scheme_id uuid not null references public.trainer_pay_schemes(id) on delete cascade,
  primary key (trainer_id, workout_id)
);

create index if not exists trainer_pay_scheme_workouts_scheme_idx
  on public.trainer_pay_scheme_workouts (scheme_id);

-- Тренер строки — тренер схемы (из браузера не подменить).
create or replace function public.trainer_pay_scheme_workouts_bi()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select s.trainer_id into new.trainer_id from public.trainer_pay_schemes s where s.id = new.scheme_id;
  return new;
end;
$$;

drop trigger if exists trainer_pay_scheme_workouts_biu on public.trainer_pay_scheme_workouts;
create trigger trainer_pay_scheme_workouts_biu
  before insert or update on public.trainer_pay_scheme_workouts
  for each row execute function public.trainer_pay_scheme_workouts_bi();

-- Доступ — как у ставок: раздел «Сотрудники» и роль в клубе сотрудника.
alter table public.trainer_pay_schemes enable row level security;
alter table public.trainer_pay_scheme_workouts enable row level security;

grant select, insert, update, delete on public.trainer_pay_schemes to authenticated;
grant select, insert, update, delete on public.trainer_pay_scheme_workouts to authenticated;
grant all on public.trainer_pay_schemes, public.trainer_pay_scheme_workouts to service_role;

drop policy if exists "trainer_pay_schemes staff" on public.trainer_pay_schemes;
create policy "trainer_pay_schemes staff" on public.trainer_pay_schemes
  for all to authenticated
  using (public.can_manage_employee((select auth.uid()), trainer_id))
  with check (public.can_manage_employee((select auth.uid()), trainer_id));

drop policy if exists "trainer_pay_scheme_workouts staff" on public.trainer_pay_scheme_workouts;
create policy "trainer_pay_scheme_workouts staff" on public.trainer_pay_scheme_workouts
  for all to authenticated
  using (public.can_manage_employee((select auth.uid()), trainer_id))
  with check (public.can_manage_employee((select auth.uid()), trainer_id));

-- Перенос прежней настройки клубов: тренерам клуба с «по числу людей» —
-- схемы и бонус клуба (если своих схем ещё нет: повторный запуск ничего не
-- меняет); формат «Прогрессивная» — только тем, у кого все клубы такие.
do $$
declare
  t record;
  s record;
  _new uuid;
begin
  for t in
    select tr.id as trainer_id,
           (select ts.studio_id
              from public.trainer_studios ts
              join public.studio_pay_settings ps on ps.studio_id = ts.studio_id and ps.per_person
             where ts.trainer_id = tr.id
               and exists (select 1 from public.studio_pay_schemes sc where sc.studio_id = ts.studio_id)
             order by ts.studio_id
             limit 1) as studio_id,
           not exists (
             select 1 from public.trainer_studios ts
              where ts.trainer_id = tr.id
                and not exists (select 1 from public.studio_pay_settings ps
                                 where ps.studio_id = ts.studio_id and ps.per_person)
           ) as only_per_person
      from public.trainers tr
     where tr.role = 'trainer'
       and not exists (select 1 from public.trainer_pay_schemes x where x.trainer_id = tr.id)
  loop
    continue when t.studio_id is null;

    for s in
      select * from public.studio_pay_schemes sc
       where sc.studio_id = t.studio_id order by sc.sort_order, sc.created_at
    loop
      insert into public.trainer_pay_schemes
        (trainer_id, name, is_default, min_amount, min_up_to, per_person, bonuses, sort_order)
      values (t.trainer_id, s.name, s.is_default, s.min_amount, s.min_up_to, s.per_person,
              s.bonuses, s.sort_order)
      returning id into _new;
      insert into public.trainer_pay_scheme_workouts (trainer_id, workout_id, scheme_id)
      select t.trainer_id, w.workout_id, _new
        from public.studio_pay_scheme_workouts w
       where w.scheme_id = s.id
      on conflict do nothing;
    end loop;

    insert into public.trainer_pay_rates (trainer_id, pay_format, trial_sale_bonus)
    select t.trainer_id,
           case when t.only_per_person then 'progressive' else 'classic' end,
           ps.trial_sale_bonus
      from public.studio_pay_settings ps where ps.studio_id = t.studio_id
    on conflict (trainer_id) do update
      set pay_format = excluded.pay_format,
          trial_sale_bonus = coalesce(public.trainer_pay_rates.trial_sale_bonus, excluded.trial_sale_bonus);
  end loop;
end;
$$;

-- Расчёт зарплат ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_lines(_from date, _to date)
 RETURNS TABLE(trainer_id uuid, work_date date, studio_id uuid, studio_name text, kind text, title text, units integer, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  _today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if not public.has_admin_section(auth.uid(), 'staff') then
    raise exception 'Нет доступа к разделу «Сотрудники»' using errcode = '42501';
  end if;
  if _from is null or _to is null or _to < _from or _to - _from > 62 then
    raise exception 'Неверный период: %–%', _from, _to;
  end if;

  return query
  with pk as (
    select s.id, s.name from public.studios s where s.format = 'packages'
  ),
  visible as (
    select distinct ts.trainer_id
      from public.trainer_studios ts
      join pk on pk.id = ts.studio_id
     where public.is_trainer(auth.uid(), ts.studio_id)
  ),
  lessons as (
    select st.trainer_id,
           (e.starts_at at time zone 'Asia/Tbilisi')::date as d,
           e.studio_id,
           e.kind,
           case when e.kind = 'other' then e.title end as title,
           case e.kind
             when 'group' then
               -- Тренер на прогрессивной ставке — по его схеме тренировки
               -- (в любом клубе сети), иначе — ставка «Групповая тренировка».
               case when r.pay_format = 'progressive' and sch.id is not null then
                      public.pay_scheme_amount(sch.min_amount, sch.min_up_to, sch.per_person, sch.bonuses,
                        (select count(*)::integer from public.schedule_bookings b
                          where b.entry_id = e.id and b.status = 'attended'))
                    when r.group_training_enabled then coalesce(r.group_training_rate, 0)
                    else 0 end
             when 'personal' then
               case when r.personal_training_enabled then coalesce(r.personal_training_rate, 0) else 0 end
             else coalesce(e.pay_rate, 0)
           end as rate
      from public.schedule_entries e
      join pk on pk.id = e.studio_id
      join public.schedule_entry_trainers st on st.entry_id = e.id
      join visible v on v.trainer_id = st.trainer_id
      left join public.trainer_pay_rates r on r.trainer_id = st.trainer_id
      left join lateral (
        select sc.*
          from public.trainer_pay_schemes sc
         where sc.trainer_id = st.trainer_id
           and (sc.is_default or sc.id = (
                 select w.scheme_id from public.trainer_pay_scheme_workouts w
                  where w.trainer_id = st.trainer_id and w.workout_id = e.workout_id))
         order by sc.is_default
         limit 1
      ) sch on e.kind = 'group'
     where e.starts_at <= now()
       and e.cancelled_at is null
       -- Диагностика в зарплату не идёт (решение владельца 2026-10-15).
       and e.kind <> 'diagnostic'
       and (e.starts_at at time zone 'Asia/Tbilisi')::date between _from and _to
  ),
  shifts as (
    select a.trainer_id, a.shift_date as d, a.studio_id,
           case when r.admin_shift_enabled then coalesce(r.admin_shift_rate, 0) else 0 end as rate
      from public.admin_shifts a
      join pk on pk.id = a.studio_id
      join visible v on v.trainer_id = a.trainer_id
      left join public.trainer_pay_rates r on r.trainer_id = a.trainer_id
     where a.shift_date between _from and least(_to, _today)
  ),
  -- Продажи: поступившие платежи по продажам, дающим бонус
  -- (payroll_sale_payment_rows — правила там).
  sold as (
    select r.trainer_id, r.paid_on as d, r.studio_id, r.amount as total_amount
      from public.payroll_sale_payment_rows(_from, _to) r
      join visible v on v.trainer_id = r.trainer_id
  ),
  -- Бонус тренеру пробного (тренер на прогрессивной ставке с
  -- trial_sale_bonus): первое пробное клиента и его первая покупка
  -- абонемента в тот же день или позже.
  trial_visits as (
    select distinct on (cm.client_id)
           cm.client_id, e.id as entry_id, e.studio_id,
           (e.starts_at at time zone 'Asia/Tbilisi')::date as d
      from public.schedule_bookings b
      join public.client_memberships cm on cm.id = b.charged_membership_id
      join public.memberships m on m.id = cm.membership_id and m.kind = 'trial'
      join public.schedule_entries e on e.id = b.entry_id
     where b.status = 'attended'
     order by cm.client_id, e.starts_at
  ),
  trial_sales as (
    select tv.entry_id, tv.studio_id, bought.sold_at
      from trial_visits tv
      join lateral (
        select s.sold_at
          from public.sales s
          join public.memberships sm on sm.id = s.membership_id
          left join public.client_memberships scm on scm.sale_id = s.id
         where s.client_id = tv.client_id
           and coalesce(sm.kind, 'package') not in ('trial', 'single', 'carryover')
           and s.sold_at >= tv.d
           and (scm.id is null or scm.status not in ('refunded', 'cancelled'))
         order by s.sold_at, s.created_at
         limit 1
      ) bought on true
     where bought.sold_at between _from and _to
  ),
  trial_bonus as (
    select st.trainer_id, ts.sold_at as d, ts.studio_id, r.trial_sale_bonus as bonus
      from trial_sales ts
      join public.schedule_entry_trainers st on st.entry_id = ts.entry_id
      join visible v on v.trainer_id = st.trainer_id
      join public.trainer_pay_rates r
        on r.trainer_id = st.trainer_id
       and r.pay_format = 'progressive'
       and r.trial_sale_bonus is not null
  ),
  all_lines as (
    select x.trainer_id, x.d, x.studio_id, x.kind, x.title, 1 as n, x.rate as amount from lessons x
    union all
    select x.trainer_id, x.d, x.studio_id, 'shift', null, 1, x.rate from shifts x
    union all
    select x.trainer_id, x.d, x.studio_id, 'sale', null, 1, x.total_amount from sold x
    union all
    select x.trainer_id, x.d, x.studio_id, 'trial_bonus', null, 1, x.bonus from trial_bonus x
  )
  select l.trainer_id, l.d, l.studio_id, pk.name, l.kind, l.title,
         count(*)::integer, sum(l.amount)
    from all_lines l
    join pk on pk.id = l.studio_id
   group by l.trainer_id, l.d, l.studio_id, pk.name, l.kind, l.title
   order by l.d, pk.name;
end;
$function$;

-- 4. 5 % тренеру при продаже ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_sale_payment_rows(_from date, _to date)
 RETURNS TABLE(trainer_id uuid, sale_id uuid, installment_id uuid, paid_on date, studio_id uuid, amount numeric, as_seller boolean, as_trainer boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pk as (
    select s.id from public.studios s where s.format = 'packages'
  ),
  -- Продажи, дающие бонус: не пробное и не разовое посещение; пакет
  -- персональных — администратору всегда, кроме пакета на 1 персональную;
  -- тренеру при продаже — только первая покупка клиентом.
  bonus_sales as (
    select s.id, s.studio_id, s.sold_at, s.total_amount, s.seller_id,
           s.trainer_id, s.client_id, s.created_at, s.sale_kind,
           m.kind as m_kind, m.personal_count as m_personal_count
      from public.sales s
      join pk on pk.id = s.studio_id
      left join public.memberships m on m.id = s.membership_id
     where m.kind is distinct from 'trial'
       and m.kind is distinct from 'single'
       and s.sale_kind is distinct from 'trial'
  ),
  sale_people as (
    select b.seller_id as trainer_id, b.id as sale_id, true as as_seller, false as as_trainer
      from bonus_sales b
     where b.seller_id is not null
       and not (b.m_kind = 'personal' and coalesce(b.m_personal_count, 0) = 1)
    union all
    select b.trainer_id, b.id, false, true
      from bonus_sales b
     where b.trainer_id is not null
       -- Тренеру на прогрессивной ставке с бонусом за абонемент после
       -- пробного 5 % при продаже не идут — бонус вместо них.
       and not exists (
         select 1 from public.trainer_pay_rates pr
          where pr.trainer_id = b.trainer_id
            and pr.pay_format = 'progressive'
            and pr.trial_sale_bonus is not null
       )
       and (
         b.m_kind is distinct from 'personal'
         or (
           b.sale_kind is distinct from 'renewal'
           and not exists (
             select 1
               from public.sales p
               join public.memberships pm on pm.id = p.membership_id
              where p.client_id = b.client_id
                and p.id <> b.id
                and pm.kind = 'personal'
                and (p.sold_at, p.created_at) < (b.sold_at, b.created_at)
           )
         )
       )
  ),
  -- Один человек в обеих ролях — одна продажа.
  people as (
    select sp.trainer_id, sp.sale_id, bool_or(sp.as_seller) as as_seller,
           bool_or(sp.as_trainer) as as_trainer
      from sale_people sp
     group by sp.trainer_id, sp.sale_id
  ),
  -- Поступившие деньги: без графика — вся сумма в день продажи; с графиком —
  -- каждый внесённый платёж в день внесения (без даты — по плановой).
  payments as (
    select b.id as sale_id, null::uuid as installment_id, b.studio_id,
           b.sold_at as d, b.total_amount as amount
      from bonus_sales b
     where b.sold_at between _from and _to
       and not exists (select 1 from public.sale_installments i where i.sale_id = b.id)
    union all
    select b.id, i.id, b.studio_id, coalesce(i.paid_at, i.due_date), i.amount
      from public.sale_installments i
      join bonus_sales b on b.id = i.sale_id
     where i.paid
       and coalesce(i.paid_at, i.due_date) between _from and _to
  )
  select p.trainer_id, p.sale_id, pay.installment_id, pay.d, pay.studio_id,
         pay.amount, p.as_seller, p.as_trainer
    from people p
    join payments pay on pay.sale_id = p.sale_id;
$function$;

notify pgrst, 'reload schema';
