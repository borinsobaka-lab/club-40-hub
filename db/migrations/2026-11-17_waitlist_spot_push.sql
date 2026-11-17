-- ============================================================================
-- Лист ожидания: пуш «Освободилось место» (решение владельца 2026-11-17, оба
-- формата).
--
-- 1. Триггерное уведомление `waitlist_spot_open` (push_triggers, строка на
--    формат; правится в админке «Триггеры»). Освободилось место на будущем
--    групповом занятии — пуш ВСЕМ из листа ожидания этого занятия; кто
--    первым записался, тот и занял (автоматического перевода из очереди нет —
--    db/booking_waitlist.sql).
--    «Освободилось» = у занятия уменьшилось `booked_count` (отмена записи
--    клиентом или сотрудником, удаление записи — все пути уменьшают счётчик)
--    или изменилась вместимость, и теперь `booked_count` меньше вместимости.
--    Проверка — отложенным триггером (constraint trigger, initially deferred)
--    при фиксации транзакции: к этому моменту счётчик пересчитан, отменённое
--    или удалённое клубом занятие уже отменено/удалено — пуша нет. Сколько
--    мест освободилось в одной транзакции — один пуш человеку.
--    Не шлётся: занятие начинается меньше чем через 15 минут, отменено, не
--    групповое, без лимита мест, клуб закрыл запись; тому, кому этот пуш по
--    этому занятию уже уходил в последние 10 минут (место освобождают и
--    занимают подряд — не засыпать уведомлениями). Приходит в любое время
--    суток: место до утра не дождётся.
-- 2. book_schedule_entry (актуальное определение — здесь; прежнее —
--    2026-11-11_zz_studio_booking_closed.sql): клиент из листа ожидания
--    записывается, если место есть (раньше ответ был `already_waitlisted` и
--    записаться из очереди было нельзя): запись из «Лист ожидания» →
--    «Записан», счётчики занятия правятся, в ответе `from_waitlist: true`.
--    Мест нет — как раньше, `already_waitlisted`.
-- 0. Журнал записей принимает «Лист ожидания»: `bookings_log_status_check`
--    из db/bookings_statuses_v2.sql не знал `waitlist` (db/booking_hygiene.sql
--    — знал; какой прогнан на живой базе последним — неизвестно), и запись в
--    очередь падала на триггере журнала. Проверка — объединение обоих
--    словарей, только расширяет.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

-- 0. Статус «Лист ожидания» в журнале ----------------------------------------------

alter table public.bookings_log drop constraint if exists bookings_log_status_check;
alter table public.bookings_log
  add constraint bookings_log_status_check
  check (status in ('booked', 'waitlist', 'attended', 'no_show', 'cancelled', 'completed', 'rejected'))
  not valid;

-- 1. Стартовые тексты ---------------------------------------------------------------

insert into public.push_triggers (format, key, title, message, translations, action_url, params)
select f.format, t.key, t.title, t.message, t.translations::jsonb, t.action_url, t.params::jsonb
  from (values ('subscription'), ('packages')) as f(format)
  join (values
    ('waitlist_spot_open', null,
     'Освободилось место',
     '{name}, на «{class}» {when} освободилось место. Успейте записаться в приложении!',
     '{"en": {"title": "A spot opened up", "message": "{name}, a spot opened up in {class} {when}. Book it in the app before someone else does!"},
       "ka": {"title": "ადგილი გათავისუფლდა", "message": "{name}, „{class}“ ვარჯიშზე {when} ადგილი გათავისუფლდა. ჩაეწერეთ აპლიკაციაში, სანამ სხვა დაიკავებს!"}}',
     '/schedule', '{}')
  ) as t(key, _f, title, message, translations, action_url, params)
    on true
on conflict (format, key) do nothing;

-- 2. Рассылка ожидающим ------------------------------------------------------------

create or replace function public.waitlist_spot_push(p_entry uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.schedule_entries%rowtype;
  v_format text;
  v_closed boolean;
  v_capacity int;
  v_trigger public.push_triggers;
  v_ref text := p_entry::text || ':' || txid_current()::text;
  v_sent integer := 0;
  r record;
begin
  select * into v_entry from public.schedule_entries where id = p_entry;
  if not found
     or v_entry.kind is distinct from 'group'
     or v_entry.cancelled_at is not null
     or v_entry.starts_at <= now() + interval '15 minutes' then
    return 0;
  end if;

  select s.format, s.booking_closed into v_format, v_closed
    from public.studios s where s.id = v_entry.studio_id;
  if v_format is null or coalesce(v_closed, false) then
    return 0;
  end if;

  -- Вместимость — как в book_schedule_entry (пусто/0 — без лимита).
  v_capacity := nullif(coalesce(
    v_entry.capacity,
    (select w.capacity from public.workouts w where w.id = v_entry.workout_id),
    0
  ), 0);
  if v_capacity is null or v_entry.booked_count >= v_capacity then
    return 0;
  end if;

  select * into v_trigger from public.push_triggers
   where format = v_format and key = 'waitlist_spot_open' and enabled;
  if not found then
    return 0;
  end if;

  for r in
    select distinct b.user_id
      from public.schedule_bookings b
     where b.entry_id = p_entry
       and b.status = 'waitlist'
       and b.user_id is not null
       and not exists (
         select 1 from public.push_trigger_log l
          where l.trigger_key = 'waitlist_spot_open'
            and l.user_id = b.user_id
            and l.ref like p_entry::text || ':%'
            and l.created_at > now() - interval '10 minutes'
       )
  loop
    if public.push_trigger_send(
         v_trigger, r.user_id, v_entry.studio_id, v_ref,
         public.push_trigger_vars(
           (select c.id from public.clients c
             where c.user_id = r.user_id
             order by (c.studio_id = v_entry.studio_id) desc, c.created_at
             limit 1),
           v_entry.studio_id, p_entry, null, null, '{}'::jsonb, now())
       ) then
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end;
$$;

revoke all on function public.waitlist_spot_push(uuid) from public, anon, authenticated;

create or replace function public.schedule_entries_waitlist_spot_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.waitlist_spot_push(new.id);
  return null;
end;
$$;

revoke all on function public.schedule_entries_waitlist_spot_push() from public, anon, authenticated;

drop trigger if exists schedule_entries_waitlist_spot_push_au on public.schedule_entries;
create constraint trigger schedule_entries_waitlist_spot_push_au
  after update of booked_count, capacity on public.schedule_entries
  deferrable initially deferred
  for each row
  when (new.booked_count < old.booked_count or new.capacity is distinct from old.capacity)
  execute function public.schedule_entries_waitlist_spot_push();

-- 3. Запись из листа ожидания ------------------------------------------------------

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
  v_found boolean;
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
  v_found := found;

  -- Посещение и «Не посетил» уже отмечены сотрудником: повторная запись
  -- вернула бы списанную тренировку.
  if v_found and v_existing.status in ('booked', 'attended', 'no_show') then
    return jsonb_build_object('ok', false, 'reason', 'already_booked',
      'booking_id', v_existing.id, 'booked_count', v_entry.booked_count, 'capacity', v_capacity);
  end if;

  if v_found and v_existing.status = 'waitlist' then
    -- Место освободилось — из очереди в «Записан» (2026-11-17).
    if v_capacity is null or v_entry.booked_count < v_capacity then
      update public.schedule_bookings
         set status = 'booked', cancelled_at = null, created_at = now()
       where id = v_existing.id;
      update public.schedule_entries
         set booked_count = booked_count + 1,
             waitlist_count = greatest(0, waitlist_count - 1)
       where id = p_entry_id;
      return jsonb_build_object('ok', true, 'waitlisted', false, 'from_waitlist', true,
        'booking_id', v_existing.id, 'booked_count', v_entry.booked_count + 1, 'capacity', v_capacity,
        'has_membership', v_has_membership);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_waitlisted', 'waitlisted', true,
      'booking_id', v_existing.id, 'booked_count', v_entry.booked_count, 'capacity', v_capacity);
  end if;

  if v_capacity is not null and v_entry.booked_count >= v_capacity then
    if v_found then
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

  if v_found then
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
