-- ============================================================================
-- Свой процент с продаж у сотрудника (решение владельца 2026-11-26:
-- администраторы купленной студии получают другой процент с продаж и
-- зарплату — в дни прогрессивной ставки).
--
--   trainer_pay_rates.sales_percent — процент бонуса с поступивших платежей
--     по продажам; null — 5 %, как у всех. Задаётся в «Ставках».
--   payroll_pay_format(trainer) — формат выплат сотрудника: progressive
--     (выплаты 11-го за 26–10 и 26-го за 11–25) — тренер на прогрессивной
--     ставке или администратор (admin / senior_admin) со своим процентом,
--     отличным от 5; иначе classic. То же правило — в админке
--     (payFormatOf, вкладки «Зарплат»).
--   trainer_payouts (тело — как в 2026-11-24_zzzz_trainer_payouts_days.sql):
--     период — по payroll_pay_format, бонус с продаж — по проценту
--     сотрудника; в ответе sales_percent. Актуальное определение — здесь.
--
-- payroll_lines отдаёт сами платежи, процент применяет админка (summarize).
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

alter table public.trainer_pay_rates
  add column if not exists sales_percent numeric(5,2);

alter table public.trainer_pay_rates drop constraint if exists trainer_pay_rates_sales_percent_check;
alter table public.trainer_pay_rates add constraint trainer_pay_rates_sales_percent_check
  check (sales_percent is null or sales_percent between 0 and 100);

comment on column public.trainer_pay_rates.sales_percent is
  'Процент бонуса сотрудника с поступивших платежей по продажам; null — 5 %. У администратора отличный от 5 — выплаты в дни прогрессивной ставки.';

create or replace function public.payroll_pay_format(_trainer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
             when t.role = 'trainer' and r.pay_format = 'progressive' then 'progressive'
             when t.role in ('admin', 'senior_admin')
                  and r.sales_percent is not null and r.sales_percent <> 5 then 'progressive'
             else 'classic'
           end
      from public.trainers t
      left join public.trainer_pay_rates r on r.trainer_id = t.id
     where t.id = _trainer_id
  ), 'classic')
$$;

revoke all on function public.payroll_pay_format(uuid) from public, anon, authenticated;
grant execute on function public.payroll_pay_format(uuid) to service_role;

create or replace function public.trainer_payouts(p_shift integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trainer uuid := public.app_trainer_of(auth.uid());
  v_shift integer := least(greatest(coalesce(p_shift, 0), -24), 0);
  v_format text;
  v_from date;
  v_to date;
  v_pay date;
  v_lessons jsonb;
  v_lessons_total numeric;
  v_lessons_count integer;
  v_shifts numeric;
  v_sales numeric;
  v_trial numeric;
  v_trial_count integer;
  v_adjustments jsonb;
  v_adjust_total numeric;
  v_upcoming integer;
  v_paid jsonb;
  v_sales_bonus numeric;
  v_extras jsonb;
  v_percent numeric;
begin
  if v_trainer is null then
    return null;
  end if;

  v_format := public.payroll_pay_format(v_trainer);
  select coalesce(r.sales_percent, 5) into v_percent
    from public.trainer_pay_rates r where r.trainer_id = v_trainer;
  v_percent := coalesce(v_percent, 5);

  select p.period_from, p.period_to, p.pay_on into v_from, v_to, v_pay
    from public.trainer_payout_period(v_format, v_shift) p;

  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id', l.entry_id,
           'starts_at', l.starts_at,
           'ends_at', l.ends_at,
           'kind', l.kind,
           'title', l.title,
           'studio_id', l.studio_id,
           'workout', case when w.id is null then null else jsonb_build_object(
             'id', w.id, 'name', w.name, 'color', w.color, 'translations', w.translations) end,
           'people', l.people,
           'unmarked', (select count(*)::integer from public.schedule_bookings b
                         where b.entry_id = l.entry_id and b.status = 'booked'),
           'amount', l.amount
         ) order by l.starts_at desc, l.entry_id), '[]'::jsonb),
         coalesce(sum(l.amount), 0), count(*)::integer
    into v_lessons, v_lessons_total, v_lessons_count
    from public.payroll_lesson_rows(v_from, v_to, array[v_trainer]) l
    left join public.workouts w on w.id = l.workout_id;

  select coalesce(sum(x.amount) filter (where x.kind = 'shift'), 0),
         coalesce(sum(x.amount) filter (where x.kind = 'sale'), 0),
         coalesce(sum(x.amount) filter (where x.kind = 'trial_bonus'), 0),
         coalesce(sum(x.units) filter (where x.kind = 'trial_bonus'), 0)::integer
    into v_shifts, v_sales, v_trial, v_trial_count
    from public.payroll_lines_for(v_from, v_to, array[v_trainer]) x;
  -- Процент сотрудника от поступивших платежей (по умолчанию 5 %) — как в
  -- «Зарплатах» админки.
  v_sales_bonus := round(v_sales * v_percent / 100, 2);

  -- То же по дням: смены, платежи по продажам (бонус — 5 % от суммы дня),
  -- абонементы после пробного. Занятия дня — в lessons.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', d.work_date, 'kind', d.kind, 'units', d.units, 'amount', d.amount,
           'bonus', case when d.kind = 'sale' then round(d.amount * v_percent / 100, 2) else d.amount end
         ) order by d.work_date, d.kind), '[]'::jsonb)
    into v_extras
    from (
      select x.work_date, x.kind, sum(x.units)::integer as units, sum(x.amount) as amount
        from public.payroll_lines_for(v_from, v_to, array[v_trainer]) x
       where x.kind in ('shift', 'sale', 'trial_bonus')
       group by x.work_date, x.kind
    ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', a.kind, 'amount', a.amount, 'reason', a.reason, 'adjusted_on', a.adjusted_on
         ) order by a.adjusted_on, a.created_at), '[]'::jsonb),
         coalesce(sum(case when a.kind = 'deduction' then -a.amount else a.amount end), 0)
    into v_adjustments, v_adjust_total
    from public.payroll_adjustments a
   where a.trainer_id = v_trainer and a.adjusted_on between v_from and v_to;

  -- Сколько занятий ещё впереди до конца периода (диагностики не оплачиваются).
  select count(*)::integer into v_upcoming
    from public.schedule_entries e
    join public.studios s on s.id = e.studio_id and s.format = 'packages'
    join public.schedule_entry_trainers et on et.entry_id = e.id
   where et.trainer_id = v_trainer
     and e.cancelled_at is null
     and e.kind <> 'diagnostic'
     and coalesce(e.ends_at, e.starts_at) > now()
     and (e.starts_at at time zone 'Asia/Tbilisi')::date between v_from and v_to;

  select jsonb_build_object('amount', p.amount, 'paid_at', p.paid_at) into v_paid
    from public.payroll_payouts p
   where p.trainer_id = v_trainer and p.period_start = v_from and p.period_end = v_to;

  return jsonb_build_object(
    'format', v_format,
    'sales_percent', v_percent,
    'shift', v_shift,
    'period_from', v_from,
    'period_to', v_to,
    'pay_on', v_pay,
    'today', (now() at time zone 'Asia/Tbilisi')::date,
    'lessons', v_lessons,
    'lessons_count', v_lessons_count,
    'lessons_total', v_lessons_total,
    'shifts_total', v_shifts,
    'sales_bonus', v_sales_bonus,
    'trial_bonus', v_trial,
    'trial_count', v_trial_count,
    'adjustments', v_adjustments,
    'extras', v_extras,
    'adjustments_total', v_adjust_total,
    'total', v_lessons_total + v_shifts + v_sales_bonus + v_trial + v_adjust_total,
    'upcoming_count', v_upcoming,
    'paid', v_paid
  );
end;
$$;

revoke all on function public.trainer_payouts(integer) from public, anon;
grant execute on function public.trainer_payouts(integer) to authenticated, service_role;

notify pgrst, 'reload schema';
