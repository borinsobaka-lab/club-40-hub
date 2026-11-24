-- ============================================================================
-- «Зарплаты»: занятия сотрудника по одному и кто на них был (решение
-- владельца 2026-11-24: карточка тренера на прогрессивной ставке — подробно,
-- чтобы сверяться с тренером при начислении).
--
--   payroll_lessons(_trainer_id, _from, _to) — проведённые занятия сотрудника
--     за период: когда, клуб, тренировка, сколько «Посетил», сколько записей
--     без отметки и «Не пришёл», сумма. Те же строки, из которых складывается
--     payroll_lines (payroll_lesson_rows), — суммы совпадают.
--   payroll_lesson_clients(_trainer_id, _entry_id) — записанные на занятие:
--     имя, отметка, пробное ли.
--
-- Обе — security definer (занятия и записи клубов, где вызывающий не
-- работает, RLS не отдаёт, а оклад у сотрудника общий по клубам) и только
-- тому, кто ведёт зарплату этого сотрудника (can_manage_employee: раздел
-- «Сотрудники» и роль в его клубе).
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create or replace function public.payroll_lessons(_trainer_id uuid, _from date, _to date)
returns table (
  entry_id uuid, starts_at timestamptz, ends_at timestamptz, work_date date,
  studio_id uuid, studio_name text, kind text, title text,
  workout_id uuid, workout_name text,
  people integer, unmarked integer, no_show integer, amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_employee(auth.uid(), _trainer_id) then
    raise exception 'Нет доступа к зарплате сотрудника' using errcode = '42501';
  end if;
  if _from is null or _to is null or _to < _from or _to - _from > 62 then
    raise exception 'Неверный период: %–%', _from, _to;
  end if;

  return query
  select l.entry_id, l.starts_at, l.ends_at, l.work_date,
         l.studio_id, s.name, l.kind, l.title,
         l.workout_id, w.name,
         l.people,
         (select count(*)::integer from public.schedule_bookings b
           where b.entry_id = l.entry_id and b.status = 'booked'),
         (select count(*)::integer from public.schedule_bookings b
           where b.entry_id = l.entry_id and b.status = 'no_show'),
         l.amount
    from public.payroll_lesson_rows(_from, _to, array[_trainer_id]) l
    join public.studios s on s.id = l.studio_id
    left join public.workouts w on w.id = l.workout_id
   order by l.starts_at, l.entry_id;
end;
$$;

revoke all on function public.payroll_lessons(uuid, date, date) from public, anon;
grant execute on function public.payroll_lessons(uuid, date, date) to authenticated, service_role;

create or replace function public.payroll_lesson_clients(_trainer_id uuid, _entry_id uuid)
returns table (client_id uuid, client_name text, status text, is_trial boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_employee(auth.uid(), _trainer_id)
     or not exists (select 1 from public.schedule_entry_trainers et
                     where et.entry_id = _entry_id and et.trainer_id = _trainer_id) then
    raise exception 'Нет доступа к зарплате сотрудника' using errcode = '42501';
  end if;

  return query
  select c.id,
         coalesce(nullif(btrim(concat_ws(' ', c.last_name, c.first_name)), ''), c.full_name, '—'),
         b.status::text,
         coalesce((select m.kind = 'trial'
                     from public.client_memberships cm
                     join public.memberships m on m.id = cm.membership_id
                    where cm.id = b.charged_membership_id), false)
    from public.schedule_bookings b
    join public.clients c on c.id = b.client_id
   where b.entry_id = _entry_id
     and b.status in ('booked', 'attended', 'no_show')
   order by case b.status when 'attended' then 0 when 'booked' then 1 else 2 end,
            c.last_name, c.first_name;
end;
$$;

revoke all on function public.payroll_lesson_clients(uuid, uuid) from public, anon;
grant execute on function public.payroll_lesson_clients(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
