-- ============================================================================
-- Администратор в мобильном приложении — «Мои смены» и «Выплаты» (решение
-- владельца 2026-11-26; пакетное приложение Lady Stretch).
--
-- 1) app_admin_links — «этот пользователь приложения — администратор»:
--    карточка клиента ↔ администратор справочника (trainers.role admin /
--    senior_admin). Как app_trainer_links: ставят сотрудники клубов, которым
--    видна карточка (админка: карточка клиента → «Приложение» →
--    «Администратор»), у карточки один администратор, один администратор —
--    у нескольких карточек. Не администратора справочника не поставить
--    (триггер, ошибка admin_link_role).
-- 2) staff_payouts_for(trainer, shift) — внутренняя: тело прежней
--    trainer_payouts (2026-11-26_zz_sales_percent.sql) для любого
--    сотрудника + sales_total (поступило по продажам за период).
--    trainer_payouts — та же, для тренера вызывающего (актуальное
--    определение — здесь, ответ прежний + sales_total).
-- 3) RPC приложения администратора (только о себе, app_admin_of):
--    admin_app_me — я администратор? имя, фото, формат выплат, процент,
--      ставка смены;
--    admin_payouts(p_shift) — то же, что у тренера (период по формату:
--      classic — 20-го и 1-го, progressive — 11-го и 26-го; итог, по дням,
--      корректировки, отметка выплаты) + смены периода (отработанные и
--      впереди), ставка смены, прогноз с оставшимися сменами и платежи по
--      продажам, с которых идёт бонус (дата, клуб, клиент, абонемент,
--      сумма, бонус, платёж N из M, возврат);
--    admin_my_shifts(p_days) — смены из «Графика» админки с сегодняшней на
--      p_days дней вперёд (до 92), клуб и кто ещё в смене.
--
-- Суммы — те же функции, что «Зарплаты» админки (payroll_lines_for,
-- payroll_sale_payment_rows): в приложении расчётов нет.
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

-- 1. Связь «пользователь приложения — администратор» -----------------------------

create table if not exists public.app_admin_links (
  client_id uuid primary key references public.clients(id) on delete cascade,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists app_admin_links_trainer_idx
  on public.app_admin_links (trainer_id);

comment on table public.app_admin_links is
  'Пользователь мобильного приложения — администратор: карточка клиента ↔ администратор справочника (2026-11-26_zzz_admin_app_payouts.sql).';

alter table public.app_admin_links enable row level security;
revoke all on public.app_admin_links from public, anon, authenticated;
grant select, insert, update, delete on public.app_admin_links to authenticated;
grant all on public.app_admin_links to service_role;

-- Сотрудники клубов, которым видна карточка (у пакетных — вся сеть).
drop policy if exists "app_admin_links staff" on public.app_admin_links;
create policy "app_admin_links staff" on public.app_admin_links
  for all to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = app_admin_links.client_id
       and c.studio_id = any ((select public.auth_network_studio_ids())::uuid[])))
  with check (exists (
    select 1 from public.clients c
     where c.id = app_admin_links.client_id
       and c.studio_id = any ((select public.auth_network_studio_ids())::uuid[])));

create or replace function public.app_admin_links_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.trainers t
     where t.id = new.trainer_id and t.role in ('admin', 'senior_admin')
  ) then
    raise exception 'admin_link_role: указанный сотрудник — не администратор'
      using errcode = '23514';
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists app_admin_links_biu on public.app_admin_links;
create trigger app_admin_links_biu
  before insert or update on public.app_admin_links
  for each row execute function public.app_admin_links_biu();

-- Администратор вызывающего (учётная запись → карточка → администратор); нет — null.
-- Сменили роль в справочнике (уже не администратор) — тоже null.
create or replace function public.app_admin_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.trainer_id
    from public.app_admin_links l
    join public.clients c on c.id = l.client_id
    join public.trainers t on t.id = l.trainer_id and t.role in ('admin', 'senior_admin')
   where p_user is not null and c.user_id = p_user
   order by l.created_at
   limit 1
$$;

revoke all on function public.app_admin_of(uuid) from public, anon, authenticated;
grant execute on function public.app_admin_of(uuid) to service_role;

-- 2. Выплаты сотрудника (внутренняя) ------------------------------------------------

create or replace function public.staff_payouts_for(p_trainer uuid, p_shift integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trainer uuid := p_trainer;
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
    'sales_total', v_sales,
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

revoke all on function public.staff_payouts_for(uuid, integer) from public, anon, authenticated;
grant execute on function public.staff_payouts_for(uuid, integer) to service_role;

-- «Выплаты» тренера — прежний ответ (+ sales_total).
create or replace function public.trainer_payouts(p_shift integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when t.id is null then null
              else public.staff_payouts_for(t.id, p_shift) end
    from (select public.app_trainer_of(auth.uid()) as id) t
$$;

revoke all on function public.trainer_payouts(integer) from public, anon;
grant execute on function public.trainer_payouts(integer) to authenticated, service_role;

-- 3. RPC приложения администратора ------------------------------------------------

-- Я администратор? Сотрудник справочника с форматом выплат и ставками; нет — null.
create or replace function public.admin_app_me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'trainer_id', t.id,
           'full_name', t.full_name,
           'photo_url', t.photo_url,
           'translations', t.translations,
           'role', t.role,
           'format', public.payroll_pay_format(t.id),
           'sales_percent', coalesce(r.sales_percent, 5),
           'shift_rate', case when r.admin_shift_enabled then coalesce(r.admin_shift_rate, 0) end)
    from public.trainers t
    left join public.trainer_pay_rates r on r.trainer_id = t.id
   where t.id = public.app_admin_of(auth.uid())
$$;

revoke all on function public.admin_app_me() from public, anon;
grant execute on function public.admin_app_me() to authenticated, service_role;

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

  -- Платежи по продажам, с которых идёт бонус (правила — payroll_sale_payment_rows).
  select coalesce(jsonb_agg(jsonb_build_object(
           'paid_on', r.paid_on,
           'sale_id', r.sale_id,
           'studio_id', r.studio_id,
           'client_name', coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                                   nullif(btrim(c.full_name), ''), 'Без имени'),
           'membership', case when m.id is null then null else jsonb_build_object(
             'name', m.name, 'translations', m.translations) end,
           'amount', r.amount,
           'bonus', round(r.amount * v_percent / 100, 2),
           'installment_no', case when r.installment_id is not null then (
             select count(*)::integer from public.sale_installments i2
              where i2.sale_id = s.id and (i2.due_date, i2.id) <= (i.due_date, i.id)) end,
           'installments_total', case when r.installment_id is not null then (
             select count(*)::integer from public.sale_installments i2 where i2.sale_id = s.id) end,
           'refunded', exists (select 1 from public.refunds rf where rf.sale_id = s.id)
         ) order by r.paid_on desc, s.created_at desc), '[]'::jsonb)
    into v_payments
    from public.payroll_sale_payment_rows(v_from, v_to) r
    join public.sales s on s.id = r.sale_id
    left join public.clients c on c.id = s.client_id
    left join public.memberships m on m.id = s.membership_id
    left join public.sale_installments i on i.id = r.installment_id
   where r.trainer_id = v_admin;

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

-- Мои смены из «Графика»: с сегодняшней на p_days дней вперёд; кто ещё в смене.
create or replace function public.admin_my_shifts(p_days integer default 60)
returns table (shift_date date, studio_id uuid, colleagues jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select a.shift_date, a.studio_id,
         coalesce((
           select jsonb_agg(jsonb_build_object('full_name', t.full_name, 'photo_url', t.photo_url)
                            order by t.full_name)
             from public.admin_shifts o
             join public.trainers t on t.id = o.trainer_id
            where o.studio_id = a.studio_id and o.shift_date = a.shift_date
              and o.trainer_id <> a.trainer_id
         ), '[]'::jsonb)
    from public.admin_shifts a
    join public.studios st on st.id = a.studio_id and st.format = 'packages'
   where a.trainer_id = public.app_admin_of(auth.uid())
     and a.shift_date between (now() at time zone 'Asia/Tbilisi')::date
                          and (now() at time zone 'Asia/Tbilisi')::date
                              + least(greatest(coalesce(p_days, 60), 1), 92)
   order by a.shift_date, st.name
$$;

revoke all on function public.admin_my_shifts(integer) from public, anon;
grant execute on function public.admin_my_shifts(integer) to authenticated, service_role;

notify pgrst, 'reload schema';
