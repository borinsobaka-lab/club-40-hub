-- ============================================================================
-- «Закрытая запись» в клубе (решение владельца 2026-11-11): новую студию
-- заводят заранее — расписание и тренировки в приложении видны, но
-- записаться нельзя: карточки не нажимаются, свободных мест не видно,
-- подпись «Запись пока закрыта». Переключатель — «Управление» → «Клубы»
-- админки (studios.booking_closed).
--
-- Граница — в базе: book_schedule_entry отвечает `booking_closed`, если клуб
-- занятия закрыл запись (клиент в обход приложения тоже не запишется).
-- Сотрудник записывает клиента по-прежнему (admin_book_client не тронут).
-- Отменить уже сделанную запись клиент может (cancel_schedule_booking не
-- тронут).
--
-- book_schedule_entry — актуальное определение здесь (прежнее —
-- 2026-10-19_packages_book_without_membership.sql; тело то же, добавлена
-- одна проверка после `past`).
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

alter table public.studios add column if not exists booking_closed boolean not null default false;

comment on column public.studios.booking_closed is
  'Закрытая запись: расписание в приложении видно, записаться клиенту нельзя.';

-- studios читается публично по колонкам (2026-10-09_studio_formats.sql).
grant select (booking_closed) on public.studios to anon, authenticated;
grant update (booking_closed) on public.studios to authenticated;

create or replace function public.book_schedule_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_entry public.schedule_entries%rowtype;
  v_capacity int;
  v_booking_id uuid;
  v_existing public.schedule_bookings%rowtype;
  v_has_membership boolean;
  v_packages boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select * into v_entry from public.schedule_entries where id = p_entry_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_entry.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'past');
  end if;

  -- «Закрытая запись» клуба занятия (2026-11-11).
  if exists (
    select 1 from public.studios s
     where s.id = v_entry.studio_id and s.booking_closed
  ) then
    return jsonb_build_object('ok', false, 'reason', 'booking_closed');
  end if;

  -- null — без лимита (как admin_book_client и расписание админки).
  v_capacity := nullif(coalesce(
    v_entry.capacity,
    (select w.capacity from public.workouts w where w.id = v_entry.workout_id),
    0
  ), 0);

  select s.format = 'packages' into v_packages
    from public.studios s where s.id = v_entry.studio_id;
  v_packages := coalesce(v_packages, false);

  select exists (
    select 1
      from public.client_memberships cm
      join public.clients c on c.id = cm.client_id
     where c.user_id = v_user
       and public.studios_same_network(cm.studio_id, v_entry.studio_id)
       and cm.status = 'active'
       and (cm.ends_at is null or cm.ends_at >= (now() at time zone 'Asia/Tbilisi')::date)
       and (cm.visits_left is null or cm.visits_left > 0)
       -- Пакет персональных на групповую не списывается.
       and (not v_packages or cm.balance_kind = 'group')
  ) into v_has_membership;

  if v_packages then
    if not exists (
      select 1 from public.clients c
       where c.user_id = v_user
         and public.studios_same_network(c.studio_id, v_entry.studio_id)
    ) then
      return jsonb_build_object('ok', false, 'reason', 'no_client');
    end if;
  elsif not v_has_membership then
    return jsonb_build_object('ok', false, 'reason', 'no_membership');
  end if;

  select * into v_existing
  from public.schedule_bookings
  where entry_id = p_entry_id and user_id = v_user;

  -- Посещение и «Не посетил» уже отмечены сотрудником: повторная запись
  -- вернула бы списанную тренировку.
  if found and v_existing.status in ('booked', 'attended', 'no_show') then
    return jsonb_build_object('ok', false, 'reason', 'already_booked',
      'booking_id', v_existing.id, 'booked_count', v_entry.booked_count, 'capacity', v_capacity);
  end if;
  if found and v_existing.status = 'waitlist' then
    return jsonb_build_object('ok', false, 'reason', 'already_waitlisted', 'waitlisted', true,
      'booking_id', v_existing.id, 'booked_count', v_entry.booked_count, 'capacity', v_capacity);
  end if;

  if v_capacity is not null and v_entry.booked_count >= v_capacity then
    if found then
      update public.schedule_bookings
         set status = 'waitlist', cancelled_at = null, created_at = now()
       where id = v_existing.id
       returning id into v_booking_id;
    else
      insert into public.schedule_bookings (studio_id, entry_id, user_id, status)
      values (v_entry.studio_id, p_entry_id, v_user, 'waitlist')
      returning id into v_booking_id;
    end if;
    update public.schedule_entries
       set waitlist_count = waitlist_count + 1
     where id = p_entry_id;
    return jsonb_build_object('ok', true, 'waitlisted', true,
      'booking_id', v_booking_id, 'booked_count', v_entry.booked_count, 'capacity', v_capacity,
      'has_membership', v_has_membership);
  end if;

  if found then
    update public.schedule_bookings
       set status = 'booked', cancelled_at = null, created_at = now()
     where id = v_existing.id
     returning id into v_booking_id;
  else
    insert into public.schedule_bookings (studio_id, entry_id, user_id, status)
    values (v_entry.studio_id, p_entry_id, v_user, 'booked')
    returning id into v_booking_id;
  end if;
  update public.schedule_entries
     set booked_count = booked_count + 1
   where id = p_entry_id;
  return jsonb_build_object('ok', true, 'waitlisted', false,
    'booking_id', v_booking_id, 'booked_count', v_entry.booked_count + 1, 'capacity', v_capacity,
    'has_membership', v_has_membership);
end;
$$;
revoke all on function public.book_schedule_entry(uuid) from public;
grant execute on function public.book_schedule_entry(uuid) to authenticated;

notify pgrst, 'reload schema';
