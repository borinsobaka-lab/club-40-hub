-- ============================================================================
-- «Выплаты» тренера в мобильном приложении (решение владельца 2026-11-24):
-- на главной у тренера вкладки «Моё расписание» и «Выплаты» — проведённые
-- занятия периода (сколько людей было, сколько за занятие), сумма за период,
-- сколько занятий ещё до выплаты и когда выплата.
--
--   1. payroll_lesson_rows(_from, _to, _trainers) — внутренняя: оплата
--      каждого проведённого занятия (одна строка на занятие × тренера).
--      Правила — прежние из payroll_lines (ставка сотрудника; у тренера на
--      прогрессивной ставке групповое — по его схеме и числу «Посетил»).
--      Занятие считается проведённым, когда закончилось по времени
--      (ends_at; было — когда началось).
--   2. payroll_lines_for(_from, _to, _trainers) — внутренняя: тело прежней
--      payroll_lines (2026-11-24_trainer_progressive_pay.sql) для заданных
--      сотрудников, занятия — из payroll_lesson_rows. payroll_lines —
--      проверка доступа и сотрудники клубов вызывающего, как раньше.
--      Так админка и приложение считают одной функцией — суммы совпадают.
--   3. trainer_payout_period(p_format, p_shift) — период выплаты по дате
--      Тбилиси: классическая — 1–19 (выплата 20-го) и 20–конец (1-го),
--      прогрессивная — 26–10 (11-го) и 11–25 (26-го); p_shift — на сколько
--      периодов назад (0 — текущий).
--   4. trainer_payouts(p_shift) — RPC приложения, только тренеру
--      (app_trainer_of) и только о себе: период и день выплаты, занятия
--      (люди, «без отметки», сумма), бонусы, корректировки, итог, сколько
--      занятий осталось до конца периода, отметка «выплачено».
--      Кто был на занятии — прежняя trainer_entry_clients.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create or replace function public.payroll_lesson_rows(_from date, _to date, _trainers uuid[])
returns table (
  trainer_id uuid, entry_id uuid, starts_at timestamptz, ends_at timestamptz, work_date date,
  studio_id uuid, kind text, title text, workout_id uuid, people integer, amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select st.trainer_id, e.id, e.starts_at, e.ends_at,
         (e.starts_at at time zone 'Asia/Tbilisi')::date,
         e.studio_id, e.kind::text,
         case when e.kind = 'other' then e.title end,
         e.workout_id,
         att.n,
         (case e.kind
            when 'group' then
              -- Тренер на прогрессивной ставке — по его схеме тренировки
              -- (в любом клубе сети), иначе — ставка «Групповая тренировка».
              case when r.pay_format = 'progressive' and sch.id is not null then
                     public.pay_scheme_amount(sch.min_amount, sch.min_up_to, sch.per_person,
                                              sch.bonuses, att.n)
                   when r.group_training_enabled then coalesce(r.group_training_rate, 0)
                   else 0 end
            when 'personal' then
              case when r.personal_training_enabled then coalesce(r.personal_training_rate, 0) else 0 end
            else coalesce(e.pay_rate, 0)
          end)::numeric
    from public.schedule_entries e
    join public.studios s on s.id = e.studio_id and s.format = 'packages'
    join public.schedule_entry_trainers st on st.entry_id = e.id
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
    cross join lateral (
      select count(*)::integer as n from public.schedule_bookings b
       where b.entry_id = e.id and b.status = 'attended'
    ) att
   where st.trainer_id = any (coalesce(_trainers, '{}'::uuid[]))
     -- Проведено — когда закончилось по времени.
     and coalesce(e.ends_at, e.starts_at) <= now()
     and e.cancelled_at is null
     -- Диагностика в зарплату не идёт (решение владельца 2026-10-15).
     and e.kind <> 'diagnostic'
     and (e.starts_at at time zone 'Asia/Tbilisi')::date between _from and _to
$$;

revoke all on function public.payroll_lesson_rows(date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.payroll_lesson_rows(date, date, uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.payroll_lines_for(_from date, _to date, _trainers uuid[])
 RETURNS TABLE(trainer_id uuid, work_date date, studio_id uuid, studio_name text, kind text, title text, units integer, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  _today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if _from is null or _to is null or _to < _from or _to - _from > 62 then
    raise exception 'Неверный период: %–%', _from, _to;
  end if;

  return query
  with pk as (
    select s.id, s.name from public.studios s where s.format = 'packages'
  ),
  visible as (
    select distinct x as trainer_id from unnest(coalesce(_trainers, '{}'::uuid[])) x
  ),
  -- Проведённые занятия — payroll_lesson_rows (правила оплаты занятия там).
  lessons as (
    select l.trainer_id, l.work_date as d, l.studio_id, l.kind, l.title, l.amount as rate
      from public.payroll_lesson_rows(_from, _to, _trainers) l
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

revoke all on function public.payroll_lines_for(date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.payroll_lines_for(date, date, uuid[]) to service_role;

create or replace function public.payroll_lines(_from date, _to date)
returns table (trainer_id uuid, work_date date, studio_id uuid, studio_name text, kind text, title text, units integer, amount numeric)
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
  return query
  select l.*
    from public.payroll_lines_for(_from, _to, (
           select coalesce(array_agg(distinct ts.trainer_id), '{}'::uuid[])
             from public.trainer_studios ts
             join public.studios s on s.id = ts.studio_id and s.format = 'packages'
            where public.is_trainer(auth.uid(), ts.studio_id)
         )) l;
end;
$$;

-- Период выплаты -----------------------------------------------------------------

create or replace function public.trainer_payout_period(p_format text, p_shift integer default 0)
returns table (period_from date, period_to date, pay_on date)
language plpgsql
stable
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Tbilisi')::date;
  v_day integer := extract(day from v_today)::integer;
  v_month date := date_trunc('month', v_today)::date;
  v_half integer;   -- 0 — первый период месяца, 1 — второй
  v_idx integer;    -- периоды подряд: месяц × 2 + половина
begin
  if p_format = 'progressive' then
    -- 26–10 (выплата 11-го) и 11–25 (26-го); с 26-го идёт период следующего месяца.
    if v_day >= 26 then
      v_month := (v_month + interval '1 month')::date;
      v_half := 0;
    else
      v_half := case when v_day <= 10 then 0 else 1 end;
    end if;
  else
    v_half := case when v_day <= 19 then 0 else 1 end;
  end if;

  v_idx := (extract(year from v_month)::integer * 12 + extract(month from v_month)::integer - 1) * 2
           + v_half + coalesce(p_shift, 0);
  v_month := make_date(v_idx / 24, (v_idx / 2) % 12 + 1, 1);
  v_half := v_idx % 2;

  if p_format = 'progressive' then
    if v_half = 0 then
      return query select (v_month - interval '1 month')::date + 25, v_month + 9, v_month + 10;
    else
      return query select v_month + 10, v_month + 24, v_month + 25;
    end if;
  elsif v_half = 0 then
    return query select v_month, v_month + 18, v_month + 19;
  else
    return query select v_month + 19, (v_month + interval '1 month')::date - 1,
                        (v_month + interval '1 month')::date;
  end if;
end;
$$;

revoke all on function public.trainer_payout_period(text, integer) from public, anon, authenticated;
grant execute on function public.trainer_payout_period(text, integer) to service_role;

-- «Выплаты» тренера ---------------------------------------------------------------

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
begin
  if v_trainer is null then
    return null;
  end if;

  select case when t.role = 'trainer' and r.pay_format = 'progressive' then 'progressive' else 'classic' end
    into v_format
    from public.trainers t
    left join public.trainer_pay_rates r on r.trainer_id = t.id
   where t.id = v_trainer;
  v_format := coalesce(v_format, 'classic');

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
  -- 5 % от поступивших платежей — как в «Зарплатах» админки.
  v_sales_bonus := round(v_sales * 0.05, 2);

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
