-- ============================================================================
-- Оплата групповых по числу людей и бонус за продажу после пробного
-- (решение владельца 2026-11-11: условия купленной студии; правила — от её
-- старшего тренера). Пакетные клубы, настраивается по клубу в «Сотрудники»
-- → «Ставки».
--
--   1. studio_pay_settings — строка на клуб: per_person — групповые
--      оплачиваются по числу людей (иначе — прежняя ставка «Групповая
--      тренировка» сотрудника), trial_sale_bonus — сколько ₾ тренеру
--      пробного занятия за абонемент, купленный клиентом после пробного
--      (null — как раньше: 5 % тренеру, выбранному в продаже).
--   2. studio_pay_schemes — схемы оплаты клуба («Обычная группа», «TRX»,
--      «Гамаки»): до min_up_to человек — min_amount, больше — per_person ×
--      число людей; плюс бонус за наполняемость bonuses
--      [{"from": 7, "amount": 5}, {"from": 10, "amount": 10}] — берётся
--      самый крупный порог, до которого дошли. is_default — схема для
--      тренировок без своей схемы (одна на клуб).
--      studio_pay_scheme_workouts — какие тренировки по какой схеме (у
--      тренировки в клубе одна схема).
--      Люди на занятии — только «Посетил» (решение владельца 2026-11-11),
--      из всех клубов сети.
--   3. payroll_lines (тело — как в 2026-11-01_zz_payroll_sale_payments.sql):
--      групповое в клубе с per_person — по схеме (pay_scheme_amount); новый
--      вид строки trial_bonus — тренеру первого пробного занятия клиента в
--      клубе с trial_sale_bonus, когда клиент купил абонемент (не пробное,
--      не разовое, не перенос; без возврата) в день пробного или позже;
--      дата строки — дата продажи, один бонус на клиента.
--   4. payroll_sale_payment_rows (тело — как в
--      2026-11-01_zzzz_payroll_personal_one_session.sql): в клубе с
--      trial_sale_bonus тренеру при продаже 5 % не идёт (решение владельца:
--      вместо 5 %). Администратору — как раньше.
--
-- Читают и правят — сотрудники клуба с разделом «Сотрудники» (как ставки).
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create table if not exists public.studio_pay_settings (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  per_person boolean not null default false,
  trial_sale_bonus numeric(10,2),
  updated_at timestamptz not null default now()
);

alter table public.studio_pay_settings drop constraint if exists studio_pay_settings_bonus_check;
alter table public.studio_pay_settings add constraint studio_pay_settings_bonus_check
  check (trial_sale_bonus is null or trial_sale_bonus >= 0);

comment on table public.studio_pay_settings is
  'Оплата тренеров клуба: групповые по числу людей (studio_pay_schemes) и бонус тренеру пробного за абонемент после пробного.';

create table if not exists public.studio_pay_schemes (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  min_amount numeric(10,2) not null default 0,
  min_up_to integer not null default 0,
  per_person numeric(10,2) not null default 0,
  bonuses jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.studio_pay_schemes drop constraint if exists studio_pay_schemes_values_check;
alter table public.studio_pay_schemes add constraint studio_pay_schemes_values_check
  check (
    length(btrim(name)) between 1 and 60
    and min_amount >= 0 and per_person >= 0
    and min_up_to between 0 and 100
    and jsonb_typeof(bonuses) = 'array'
  );

create unique index if not exists studio_pay_schemes_one_default
  on public.studio_pay_schemes (studio_id) where is_default;
create index if not exists studio_pay_schemes_studio_idx on public.studio_pay_schemes (studio_id);

comment on table public.studio_pay_schemes is
  'Схема оплаты групповых клуба: до min_up_to человек — min_amount, больше — per_person × люди, плюс бонус bonuses [{from, amount}].';

create table if not exists public.studio_pay_scheme_workouts (
  studio_id uuid not null references public.studios(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  scheme_id uuid not null references public.studio_pay_schemes(id) on delete cascade,
  primary key (studio_id, workout_id)
);

create index if not exists studio_pay_scheme_workouts_scheme_idx
  on public.studio_pay_scheme_workouts (scheme_id);

-- Клуб строки — клуб схемы (из браузера не подменить).
create or replace function public.studio_pay_scheme_workouts_bi()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select s.studio_id into new.studio_id from public.studio_pay_schemes s where s.id = new.scheme_id;
  return new;
end;
$$;

drop trigger if exists studio_pay_scheme_workouts_biu on public.studio_pay_scheme_workouts;
create trigger studio_pay_scheme_workouts_biu
  before insert or update on public.studio_pay_scheme_workouts
  for each row execute function public.studio_pay_scheme_workouts_bi();

-- Доступ: сотрудник клуба с разделом «Сотрудники».
alter table public.studio_pay_settings enable row level security;
alter table public.studio_pay_schemes enable row level security;
alter table public.studio_pay_scheme_workouts enable row level security;

grant select, insert, update, delete on public.studio_pay_settings to authenticated;
grant select, insert, update, delete on public.studio_pay_schemes to authenticated;
grant select, insert, update, delete on public.studio_pay_scheme_workouts to authenticated;
grant all on public.studio_pay_settings, public.studio_pay_schemes,
  public.studio_pay_scheme_workouts to service_role;

drop policy if exists "studio_pay_settings staff" on public.studio_pay_settings;
create policy "studio_pay_settings staff" on public.studio_pay_settings
  for all to authenticated
  using (
    studio_id = any ((select public.auth_staff_studio_ids())::uuid[])
    and (select public.has_admin_section(auth.uid(), 'staff'))
  )
  with check (
    studio_id = any ((select public.auth_staff_studio_ids())::uuid[])
    and (select public.has_admin_section(auth.uid(), 'staff'))
  );

drop policy if exists "studio_pay_schemes staff" on public.studio_pay_schemes;
create policy "studio_pay_schemes staff" on public.studio_pay_schemes
  for all to authenticated
  using (
    studio_id = any ((select public.auth_staff_studio_ids())::uuid[])
    and (select public.has_admin_section(auth.uid(), 'staff'))
  )
  with check (
    studio_id = any ((select public.auth_staff_studio_ids())::uuid[])
    and (select public.has_admin_section(auth.uid(), 'staff'))
  );

drop policy if exists "studio_pay_scheme_workouts staff" on public.studio_pay_scheme_workouts;
create policy "studio_pay_scheme_workouts staff" on public.studio_pay_scheme_workouts
  for all to authenticated
  using (
    studio_id = any ((select public.auth_staff_studio_ids())::uuid[])
    and (select public.has_admin_section(auth.uid(), 'staff'))
  )
  with check (
    studio_id = any ((select public.auth_staff_studio_ids())::uuid[])
    and (select public.has_admin_section(auth.uid(), 'staff'))
  );

-- Оплата занятия по схеме: n — число «Посетил».
create or replace function public.pay_scheme_amount(
  p_min_amount numeric, p_min_up_to integer, p_per_person numeric, p_bonuses jsonb, p_people integer
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select (case when coalesce(p_people, 0) <= coalesce(p_min_up_to, 0)
               then coalesce(p_min_amount, 0)
               else coalesce(p_per_person, 0) * p_people end)
       + coalesce((
           select (b->>'amount')::numeric
             from jsonb_array_elements(coalesce(p_bonuses, '[]'::jsonb)) b
            where (b->>'from')::integer <= coalesce(p_people, 0)
            order by (b->>'from')::integer desc
            limit 1
         ), 0);
$$;

grant execute on function public.pay_scheme_amount(numeric, integer, numeric, jsonb, integer)
  to authenticated, service_role;

-- 3. Расчёт зарплат ---------------------------------------------------------------

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
               -- Клуб с оплатой по числу людей — по схеме тренировки
               -- (2026-11-11_studio_per_person_pay.sql), иначе — ставка сотрудника.
               case when coalesce(ps.per_person, false) and sch.id is not null then
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
      left join public.studio_pay_settings ps on ps.studio_id = e.studio_id
      left join lateral (
        select sc.*
          from public.studio_pay_schemes sc
         where sc.studio_id = e.studio_id
           and (sc.is_default or sc.id = (
                 select w.scheme_id from public.studio_pay_scheme_workouts w
                  where w.studio_id = e.studio_id and w.workout_id = e.workout_id))
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
  -- Бонус тренеру пробного (клуб с trial_sale_bonus): первое пробное
  -- клиента и его первая покупка абонемента в тот же день или позже.
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
    select tv.entry_id, tv.studio_id, ps.trial_sale_bonus as bonus, bought.sold_at
      from trial_visits tv
      join public.studio_pay_settings ps
        on ps.studio_id = tv.studio_id and ps.trial_sale_bonus is not null
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
    select st.trainer_id, ts.sold_at as d, ts.studio_id, ts.bonus
      from trial_sales ts
      join public.schedule_entry_trainers st on st.entry_id = ts.entry_id
      join visible v on v.trainer_id = st.trainer_id
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
       -- Клуб с бонусом тренеру пробного — вместо 5 % тренеру при продаже
       -- (2026-11-11_studio_per_person_pay.sql).
       and not exists (
         select 1 from public.studio_pay_settings ps
          where ps.studio_id = b.studio_id and ps.trial_sale_bonus is not null
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
