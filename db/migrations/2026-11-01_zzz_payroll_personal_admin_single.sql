-- ============================================================================
-- Бонус с продаж: пакет персональных — администратору, разовые — никому
-- (решения владельца 2026-11-01):
-- • «добавить в бонусы бонус за продажу пакетов персональных для
--   администраторов — если это первая продажа и если это продление»:
--   администратору (seller_id) с пакета персональных бонус идёт всегда
--   (отменяет «не идёт» из 2026-10-11_zzzzz_attendance_undo_personal_bonus.sql).
--   Тренеру при продаже — как было: только первая покупка персональных.
-- • «разовые посещения в бонус не должны идти»: продажа разового посещения
--   (memberships.kind = 'single') бонуса не даёт ни администратору, ни
--   тренеру — как пробное.
--
-- payroll_sale_payment_rows — актуальное определение здесь (прочее — как в
-- 2026-11-01_zz_payroll_sale_payments.sql); payroll_lines и
-- payroll_sale_payments читают её и не меняются.
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
  -- Продажи, дающие бонус: не пробное и не разовое посещение; пакет
  -- персональных — администратору всегда, тренеру при продаже — только
  -- первая покупка клиентом.
  bonus_sales as (
    select s.id, s.studio_id, s.sold_at, s.total_amount, s.seller_id,
           s.trainer_id, s.client_id, s.created_at, s.sale_kind,
           m.kind as m_kind
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

notify pgrst, 'reload schema';
