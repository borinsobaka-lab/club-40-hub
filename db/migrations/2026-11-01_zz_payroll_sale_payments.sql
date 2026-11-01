-- ============================================================================
-- Зарплаты: пробные — без бонуса, список платежей бонуса (решение владельца
-- 2026-11-01): «в продаже считаем в бонус только абонементы, пробные не
-- считаем» и «в блоке «Поступило по абонементам» — список платежей, из
-- которых считается бонус».
--
-- 1. payroll_sale_payment_rows (внутренняя, наружу не выдана) — платежи,
--    дающие бонус: сотрудник × платёж. Правила прежние
--    (2026-11-01_personal_first_sale_trainer_bonus.sql) плюс: продажа
--    пробного (memberships.kind = 'trial' или sale_kind = 'trial') бонуса
--    не даёт ни администратору, ни тренеру.
-- 2. payroll_lines — строки продаж теперь из неё (актуальное определение
--    здесь; прочее тело — как в 2026-11-01_personal_first_sale_trainer_bonus.sql).
-- 3. payroll_sale_payments(_trainer_id, _from, _to) — те же платежи одного
--    сотрудника с клиентом, абонементом, клубом и ролью (окно сотрудника в
--    «Зарплатах»). Доступ — как у payroll_lines: раздел «Сотрудники» и
--    сотрудник клубов вызывающего.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create or replace function public.payroll_sale_payment_rows(_from date, _to date)
returns table (
  trainer_id uuid,
  sale_id uuid,
  installment_id uuid,
  paid_on date,
  studio_id uuid,
  amount numeric,
  as_seller boolean,
  as_trainer boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with pk as (
    select s.id from public.studios s where s.format = 'packages'
  ),
  -- Продажи, дающие бонус: не пробное; пакет персональных — администратору
  -- никогда, тренеру при продаже — только первая покупка клиентом.
  bonus_sales as (
    select s.id, s.studio_id, s.sold_at, s.total_amount, s.seller_id,
           s.trainer_id, s.client_id, s.created_at, s.sale_kind,
           m.kind as m_kind
      from public.sales s
      join pk on pk.id = s.studio_id
      left join public.memberships m on m.id = s.membership_id
     where m.kind is distinct from 'trial'
       and s.sale_kind is distinct from 'trial'
  ),
  sale_people as (
    select b.seller_id as trainer_id, b.id as sale_id, true as as_seller, false as as_trainer
      from bonus_sales b
     where b.seller_id is not null
       and b.m_kind is distinct from 'personal'
    union all
    select b.trainer_id, b.id, false, true
      from bonus_sales b
     where b.trainer_id is not null
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
$$;

revoke all on function public.payroll_sale_payment_rows(date, date) from public, anon, authenticated;
grant execute on function public.payroll_sale_payment_rows(date, date) to service_role;

create or replace function public.payroll_lines(_from date, _to date)
returns table (
  trainer_id uuid,
  work_date date,
  studio_id uuid,
  studio_name text,
  kind text,
  title text,
  units integer,
  amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
               case when r.group_training_enabled then coalesce(r.group_training_rate, 0) else 0 end
             when 'personal' then
               case when r.personal_training_enabled then coalesce(r.personal_training_rate, 0) else 0 end
             else coalesce(e.pay_rate, 0)
           end as rate
      from public.schedule_entries e
      join pk on pk.id = e.studio_id
      join public.schedule_entry_trainers st on st.entry_id = e.id
      join visible v on v.trainer_id = st.trainer_id
      left join public.trainer_pay_rates r on r.trainer_id = st.trainer_id
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
  all_lines as (
    select x.trainer_id, x.d, x.studio_id, x.kind, x.title, 1 as n, x.rate as amount from lessons x
    union all
    select x.trainer_id, x.d, x.studio_id, 'shift', null, 1, x.rate from shifts x
    union all
    select x.trainer_id, x.d, x.studio_id, 'sale', null, 1, x.total_amount from sold x
  )
  select l.trainer_id, l.d, l.studio_id, pk.name, l.kind, l.title,
         count(*)::integer, sum(l.amount)
    from all_lines l
    join pk on pk.id = l.studio_id
   group by l.trainer_id, l.d, l.studio_id, pk.name, l.kind, l.title
   order by l.d, pk.name;
end;
$$;


revoke all on function public.payroll_lines(date, date) from public, anon;
grant execute on function public.payroll_lines(date, date) to authenticated, service_role;

create or replace function public.payroll_sale_payments(_trainer_id uuid, _from date, _to date)
returns table (
  paid_on date,
  sale_id uuid,
  installment_id uuid,
  sold_at date,
  studio_id uuid,
  studio_name text,
  client_id uuid,
  client_name text,
  membership_name text,
  sale_kind text,
  amount numeric,
  as_seller boolean,
  as_trainer boolean,
  installment_no integer,
  installments_total integer,
  refunded boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_admin_section(auth.uid(), 'staff') then
    raise exception 'Нет доступа к разделу «Сотрудники»' using errcode = '42501';
  end if;
  if _from is null or _to is null or _to < _from or _to - _from > 62 then
    raise exception 'Неверный период: %–%', _from, _to;
  end if;
  -- Только сотрудник клубов вызывающего — как строки payroll_lines.
  if not exists (
    select 1
      from public.trainer_studios ts
      join public.studios st on st.id = ts.studio_id and st.format = 'packages'
     where ts.trainer_id = _trainer_id
       and public.is_trainer(auth.uid(), ts.studio_id)
  ) then
    raise exception 'Нет доступа к сотруднику' using errcode = '42501';
  end if;

  return query
  select r.paid_on, r.sale_id, r.installment_id, s.sold_at, r.studio_id, st.name,
         s.client_id,
         coalesce(nullif(btrim(concat_ws(' ', c.last_name, c.first_name)), ''), 'Без имени'),
         coalesce(m.name, 'Абонемент'),
         s.sale_kind, r.amount, r.as_seller, r.as_trainer,
         case when r.installment_id is not null then (
           select count(*)::integer from public.sale_installments i2
            where i2.sale_id = s.id
              and (i2.due_date, i2.id) <= (i.due_date, i.id)
         ) end,
         case when r.installment_id is not null then (
           select count(*)::integer from public.sale_installments i2 where i2.sale_id = s.id
         ) end,
         exists (select 1 from public.refunds rf where rf.sale_id = s.id)
    from public.payroll_sale_payment_rows(_from, _to) r
    join public.sales s on s.id = r.sale_id
    join public.studios st on st.id = r.studio_id
    left join public.clients c on c.id = s.client_id
    left join public.memberships m on m.id = s.membership_id
    left join public.sale_installments i on i.id = r.installment_id
   where r.trainer_id = _trainer_id
   order by 1, 4, 8;
end;
$$;

revoke all on function public.payroll_sale_payments(uuid, date, date) from public, anon;
grant execute on function public.payroll_sale_payments(uuid, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
