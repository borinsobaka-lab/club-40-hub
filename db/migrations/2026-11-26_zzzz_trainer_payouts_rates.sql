-- ============================================================================
-- «Выплаты» тренера в приложении — по его структуре оплаты (решение
-- владельца 2026-11-26: тренерам с классической ставкой так же понятно, как
-- с прогрессивной — когда были тренировки, сколько получили, фикс и процент
-- с продаж, корректировки, даты выплат).
--
--   staff_sale_payments_json(trainer, from, to, percent) — внутренняя:
--     платежи по продажам периода, с которых сотруднику идёт бонус (правила
--     — payroll_sale_payment_rows): дата, клуб, клиент, абонемент, сумма,
--     бонус по проценту, платёж N из M, возврат, роль (продавец / тренер при
--     продаже). Её читают trainer_payouts и admin_payouts.
--   trainer_payouts (актуальное определение — здесь): прежний ответ
--     (staff_payouts_for) + rates — ставки тренера из «Ставок»: групповая и
--     персональная (null — не оплачиваются), бонус за абонемент после
--     пробного (у прогрессивной; тогда 5 % при продаже не идут) — и
--     sale_payments.
--   admin_payouts (актуальное определение — здесь): тот же ответ, что в
--     2026-11-26_zzz_admin_app_payouts.sql, платежи — через общую функцию.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create or replace function public.staff_sale_payments_json(
  p_trainer uuid, p_from date, p_to date, p_percent numeric
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'paid_on', r.paid_on,
           'sale_id', r.sale_id,
           'studio_id', r.studio_id,
           'client_name', coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                                   nullif(btrim(c.full_name), ''), 'Без имени'),
           'membership', case when m.id is null then null else jsonb_build_object(
             'name', m.name, 'translations', m.translations) end,
           'amount', r.amount,
           'bonus', round(r.amount * p_percent / 100, 2),
           'as_seller', r.as_seller,
           'as_trainer', r.as_trainer,
           'installment_no', case when r.installment_id is not null then (
             select count(*)::integer from public.sale_installments i2
              where i2.sale_id = s.id and (i2.due_date, i2.id) <= (i.due_date, i.id)) end,
           'installments_total', case when r.installment_id is not null then (
             select count(*)::integer from public.sale_installments i2 where i2.sale_id = s.id) end,
           'refunded', exists (select 1 from public.refunds rf where rf.sale_id = s.id)
         ) order by r.paid_on desc, s.created_at desc), '[]'::jsonb)
    from public.payroll_sale_payment_rows(p_from, p_to) r
    join public.sales s on s.id = r.sale_id
    left join public.clients c on c.id = s.client_id
    left join public.memberships m on m.id = s.membership_id
    left join public.sale_installments i on i.id = r.installment_id
   where r.trainer_id = p_trainer
$$;

revoke all on function public.staff_sale_payments_json(uuid, date, date, numeric) from public, anon, authenticated;
grant execute on function public.staff_sale_payments_json(uuid, date, date, numeric) to service_role;

create or replace function public.trainer_payouts(p_shift integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trainer uuid := public.app_trainer_of(auth.uid());
  v_base jsonb;
  v_rates jsonb;
begin
  if v_trainer is null then
    return null;
  end if;
  v_base := public.staff_payouts_for(v_trainer, p_shift);

  select jsonb_build_object(
           'group', case when r.group_training_enabled then coalesce(r.group_training_rate, 0) end,
           'personal', case when r.personal_training_enabled then coalesce(r.personal_training_rate, 0) end,
           'trial_sale_bonus', case when r.pay_format = 'progressive' then r.trial_sale_bonus end)
    into v_rates
    from public.trainer_pay_rates r where r.trainer_id = v_trainer;

  return v_base || jsonb_build_object(
    'rates', coalesce(v_rates, jsonb_build_object('group', null, 'personal', null, 'trial_sale_bonus', null)),
    'sale_payments', public.staff_sale_payments_json(
      v_trainer, (v_base ->> 'period_from')::date, (v_base ->> 'period_to')::date,
      (v_base ->> 'sales_percent')::numeric)
  );
end;
$$;

revoke all on function public.trainer_payouts(integer) from public, anon;
grant execute on function public.trainer_payouts(integer) to authenticated, service_role;

create or replace function public.admin_payouts(p_shift integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.app_admin_of(auth.uid());
  v_base jsonb;
  v_from date;
  v_to date;
  v_today date := (now() at time zone 'Asia/Tbilisi')::date;
  v_rate numeric;
  v_percent numeric;
  v_shifts jsonb;
  v_ahead integer;
  v_payments jsonb;
begin
  if v_admin is null then
    return null;
  end if;

  v_base := public.staff_payouts_for(v_admin, p_shift);
  v_from := (v_base ->> 'period_from')::date;
  v_to := (v_base ->> 'period_to')::date;
  v_percent := (v_base ->> 'sales_percent')::numeric;

  select case when r.admin_shift_enabled then coalesce(r.admin_shift_rate, 0) end into v_rate
    from public.trainer_pay_rates r where r.trainer_id = v_admin;

  -- Смены периода в пакетных клубах: прошедшие и сегодняшняя — в начислении
  -- (как в payroll_lines_for), будущие — впереди.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', a.shift_date,
           'studio_id', a.studio_id,
           'done', a.shift_date <= v_today,
           'amount', case when a.shift_date <= v_today then coalesce(v_rate, 0) end
         ) order by a.shift_date, st.name), '[]'::jsonb),
         count(*) filter (where a.shift_date > v_today)::integer
    into v_shifts, v_ahead
    from public.admin_shifts a
    join public.studios st on st.id = a.studio_id and st.format = 'packages'
   where a.trainer_id = v_admin and a.shift_date between v_from and v_to;

  v_payments := public.staff_sale_payments_json(v_admin, v_from, v_to, v_percent);

  return v_base || jsonb_build_object(
    'shift_rate', v_rate,
    'shifts', v_shifts,
    'upcoming_shifts', v_ahead,
    'forecast', (v_base ->> 'total')::numeric + v_ahead * coalesce(v_rate, 0),
    'sale_payments', v_payments
  );
end;
$$;

revoke all on function public.admin_payouts(integer) from public, anon;
grant execute on function public.admin_payouts(integer) to authenticated, service_role;


notify pgrst, 'reload schema';
