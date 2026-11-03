-- «Рабочий день»: кто сегодня на смене (решение владельца 2026-11-03) — в
-- шапке окна после заголовка имя и фото администратора из «Графика»
-- (admin_shifts) клуба на сегодня по Тбилиси.
--
-- admin_shifts читают только с разделом рейки «Сотрудники», а «Рабочий день»
-- открывают все сотрудники клуба — поэтому RPC security definer: проверяет,
-- что вызывающий — сотрудник этого клуба, и отдаёт только имя и фото
-- сегодняшних сменщиков (смены других дней и клубов — нет).

create or replace function public.workday_admins_today(p_studio uuid)
returns table (trainer_id uuid, full_name text, photo_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (p_studio = any (public.auth_staff_studio_ids())) then
    raise exception 'workday_forbidden' using errcode = '42501';
  end if;
  return query
    select t.id, t.full_name, t.photo_url
      from public.admin_shifts s
      join public.trainers t on t.id = s.trainer_id
     where s.studio_id = p_studio
       and s.shift_date = public.workday_today()
     order by t.full_name, t.id;
end;
$$;

revoke all on function public.workday_admins_today(uuid) from public;
grant execute on function public.workday_admins_today(uuid) to authenticated, service_role;
