-- Абонемент «ожидает посещения» без даты окончания (2026-11-07).
--
-- У абонемента пакетного клуба со сроком от первого посещения
-- (starts_on_first_visit) до первого посещения нет ни начала, ни конца:
-- конец считает первое списание (schedule_bookings_charge_balance —
-- от даты занятия, прежний конец оно и так не учитывает). Но «Изменить» в
-- карточке клиента сохраняло поле «Действует до» целиком — на iPhone пустое
-- поле даты при касании заполняется сегодняшним числом, и правка одного
-- остатка ставила абонементу конец срока. Наутро он «кончался»: списание
-- ищет абонемент с ends_at >= даты занятия — «Посетил» не отмечался
-- («сначала оформите продажу»), а карточка по-прежнему писала «Ожидает
-- посещения».
--
-- Правило: пока срок не начат (starts_on_first_visit и started_at is null),
-- ends_at — null. Держит триггер; разово исправлены такие строки.

create or replace function public.client_memberships_awaiting_no_end()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.starts_on_first_visit and new.started_at is null then
    new.ends_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists client_memberships_awaiting_no_end_biu on public.client_memberships;
create trigger client_memberships_awaiting_no_end_biu
  before insert or update of ends_at, started_at, starts_on_first_visit
  on public.client_memberships
  for each row execute function public.client_memberships_awaiting_no_end();

update public.client_memberships
   set ends_at = null
 where starts_on_first_visit
   and started_at is null
   and ends_at is not null;
