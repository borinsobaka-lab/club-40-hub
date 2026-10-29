-- ============================================================================
-- Кем отменена запись на занятие: клиентом или администратором (решение
-- владельца 2026-10-29). Показывается в «Истории записей» и во вкладке
-- «Посещения» карточки клиента: «Отменено клиентом» / «Отменено
-- администратором».
--
-- schedule_bookings / bookings_log:
--   cancelled_by       — кто отменил (auth.uid(); null — сервер или
--                        старая запись);
--   cancelled_by_kind  — 'client' (отменил сам клиент — его учётная запись)
--                        или 'admin' (сотрудник, отмена или удаление занятия
--                        клубом, сервер). null — отменено до этой миграции и
--                        определить нельзя: показывается просто «Отменено».
--
-- Ставит триггер при переходе записи в «Отменено» — какой бы функцией это ни
-- сделано (cancel_schedule_booking*, cancel_schedule_entry, удаление занятия,
-- версии функций на живой базе не важны); из «Отменено» в другой статус —
-- стирает. Подставить своё значение нельзя: триггер его перезаписывает.
-- Строка журнала берёт значение своей брони (журнал пишет триггер синхронизации
-- — тот же вызывающий), без брони — считает сама.
--
-- Вью bookings_log_full пересоздана (прежнее определение —
-- db/bookings_log_full_reason.sql) + cancelled_by_kind.
--
-- Идемпотентно.
-- ============================================================================

-- Причина и срок отмены — из db/booking_hygiene.sql (выполнялся вручную);
-- здесь на случай, если его не прогнали: на них стоит вью ниже.
alter table public.schedule_bookings
  add column if not exists cancel_reason text,
  add column if not exists cancelled_lead_minutes int,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_by_kind text;

alter table public.bookings_log
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_by_kind text;

alter table public.schedule_bookings
  drop constraint if exists schedule_bookings_cancelled_by_kind_check;
alter table public.schedule_bookings
  add constraint schedule_bookings_cancelled_by_kind_check
  check (cancelled_by_kind is null or cancelled_by_kind in ('client', 'admin'));

alter table public.bookings_log
  drop constraint if exists bookings_log_cancelled_by_kind_check;
alter table public.bookings_log
  add constraint bookings_log_cancelled_by_kind_check
  check (cancelled_by_kind is null or cancelled_by_kind in ('client', 'admin'));

comment on column public.schedule_bookings.cancelled_by_kind is
  'Кем отменена: client — сам клиент, admin — сотрудник/клуб/сервер; null — до 2026-10-29. Ставит триггер.';
comment on column public.bookings_log.cancelled_by_kind is
  'Кем отменена: client — сам клиент, admin — сотрудник/клуб/сервер; null — до 2026-10-29. Ставит триггер.';

-- 1. Брони --------------------------------------------------------------------
create or replace function public.schedule_bookings_cancelled_by_biu()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.status::text <> 'cancelled' then
    new.cancelled_by := null;
    new.cancelled_by_kind := null;
  elsif tg_op = 'UPDATE' and old.status::text = 'cancelled' then
    -- Уже отменена: значение не меняется (и не подделывается).
    new.cancelled_by := old.cancelled_by;
    new.cancelled_by_kind := old.cancelled_by_kind;
  else
    new.cancelled_by := v_uid;
    new.cancelled_by_kind :=
      case when v_uid is not null and v_uid = new.user_id then 'client' else 'admin' end;
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_bookings_cancelled_by_biu on public.schedule_bookings;
create trigger schedule_bookings_cancelled_by_biu
  before insert or update on public.schedule_bookings
  for each row execute function public.schedule_bookings_cancelled_by_biu();

-- 2. Журнал -------------------------------------------------------------------
create or replace function public.bookings_log_cancelled_by_biu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_by uuid;
  v_kind text;
begin
  if new.status::text <> 'cancelled' then
    new.cancelled_by := null;
    new.cancelled_by_kind := null;
  elsif tg_op = 'UPDATE' and old.status::text = 'cancelled' then
    new.cancelled_by := old.cancelled_by;
    new.cancelled_by_kind := old.cancelled_by_kind;
  else
    if new.booking_id is not null then
      select sb.cancelled_by, sb.cancelled_by_kind into v_by, v_kind
        from public.schedule_bookings sb
       where sb.id = new.booking_id and sb.status::text = 'cancelled';
    end if;
    if v_kind is not null then
      new.cancelled_by := v_by;
      new.cancelled_by_kind := v_kind;
    else
      new.cancelled_by := v_uid;
      new.cancelled_by_kind :=
        case when v_uid is not null and v_uid = new.user_id then 'client' else 'admin' end;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bookings_log_cancelled_by_biu() from public, anon, authenticated;

drop trigger if exists bookings_log_cancelled_by_biu on public.bookings_log;
create trigger bookings_log_cancelled_by_biu
  before insert or update on public.bookings_log
  for each row execute function public.bookings_log_cancelled_by_biu();

-- 3. История: что можно определить -----------------------------------------
-- Отменено клубом: занятие отменено (cancel_schedule_entry) или удалено
-- (причина из bookings_log_cancel_on_entry_delete и исправления истории).
-- Триггеры выше значение отменённой записи не меняют — пишем, отключив их.
alter table public.schedule_bookings disable trigger schedule_bookings_cancelled_by_biu;
alter table public.bookings_log disable trigger bookings_log_cancelled_by_biu;

update public.schedule_bookings sb
   set cancelled_by_kind = 'admin'
  from public.schedule_entries se
 where se.id = sb.entry_id
   and sb.status::text = 'cancelled'
   and sb.cancelled_by_kind is null
   and se.cancelled_at is not null;

update public.bookings_log bl
   set cancelled_by_kind = 'admin'
 where bl.status::text = 'cancelled'
   and bl.cancelled_by_kind is null
   and (
     bl.cancel_reason in (
       'Занятие отменено студией',
       'Занятие удалено (исправлено задним числом)'
     )
     or exists (
       select 1 from public.schedule_entries se
        where se.id = bl.entry_id and se.cancelled_at is not null
     )
   );

alter table public.schedule_bookings enable trigger schedule_bookings_cancelled_by_biu;
alter table public.bookings_log enable trigger bookings_log_cancelled_by_biu;

-- 4. Вью «Истории записей» ----------------------------------------------------
drop view if exists public.bookings_log_full;
create view public.bookings_log_full
with (security_invoker = true) as
select
  bl.id::text as id,
  bl.studio_id,
  bl.booking_id,
  bl.entry_id,
  bl.user_id,
  bl.client_first_name,
  bl.client_last_name,
  bl.client_full_name,
  bl.client_phone,
  bl.client_email,
  bl.workout_name,
  bl.workout_type,
  bl.starts_at,
  bl.ends_at,
  bl.status::text as status,
  bl.booked_at,
  bl.cancelled_at,
  bl.completed_at,
  bl.cancel_reason,
  bl.cancelled_lead_minutes,
  bl.met_value,
  bl.weight_at_time,
  bl.duration_min,
  bl.calories,
  concat_ws(' ',
    bl.client_full_name, bl.client_first_name, bl.client_last_name,
    bl.client_phone, bl.client_email, bl.workout_name
  ) as search_text,
  bl.cancelled_by_kind
from public.bookings_log bl

union all

select
  'schedule-booking-' || sb.id::text as id,
  sb.studio_id,
  sb.id as booking_id,
  sb.entry_id,
  sb.user_id,
  c.first_name as client_first_name,
  c.last_name as client_last_name,
  coalesce(
    c.full_name,
    nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '')
  ) as client_full_name,
  c.phone as client_phone,
  c.email as client_email,
  w.name as workout_name,
  w.type as workout_type,
  se.starts_at,
  se.ends_at,
  sb.status::text as status,
  sb.created_at as booked_at,
  sb.cancelled_at,
  null::timestamptz as completed_at,
  sb.cancel_reason,
  sb.cancelled_lead_minutes,
  null::numeric(4, 2) as met_value,
  null::numeric(5, 1) as weight_at_time,
  null::int as duration_min,
  null::int as calories,
  concat_ws(' ',
    coalesce(c.full_name, nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '')),
    c.first_name, c.last_name, c.phone, c.email, w.name
  ) as search_text,
  sb.cancelled_by_kind
from public.schedule_bookings sb
join public.schedule_entries se on se.id = sb.entry_id
left join public.workouts w on w.id = se.workout_id
left join public.clients c
  on c.user_id = sb.user_id
 and c.studio_id = sb.studio_id
where not exists (
  select 1 from public.bookings_log bl2 where bl2.booking_id = sb.id
);

grant select on public.bookings_log_full to authenticated;

notify pgrst, 'reload schema';
