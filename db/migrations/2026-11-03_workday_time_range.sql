-- «Рабочий день»: промежуток времени и показ описания (решение владельца
-- 2026-11-03).
--
--   workday_items.start_time       — «с HH:MM» (null — только «до»); конец
--                                    промежутка — прежний due_time («до»), по
--                                    нему считается «просрочено». Начало без
--                                    конца не бывает, начало не позже конца.
--   workday_items.details_expanded — описание показано у пункта сразу
--                                    (true) или свёрнуто под стрелкой (false,
--                                    как было).
--
-- workday_copy копирует и новые колонки (актуальное определение — здесь).

alter table public.workday_items add column if not exists start_time time;
alter table public.workday_items
  add column if not exists details_expanded boolean not null default false;

alter table public.workday_items drop constraint if exists workday_items_time_range_check;
alter table public.workday_items
  add constraint workday_items_time_range_check
  check (start_time is null or (due_time is not null and start_time <= due_time));

create or replace function public.workday_copy(p_from uuid, p_to uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  s record;
  v_new uuid;
  v_count integer := 0;
  v_added integer;
begin
  if p_from = p_to then
    raise exception 'workday_same_studio' using errcode = '22023';
  end if;
  if not (p_to = any (public.auth_owner_studio_ids())) then
    raise exception 'workday_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workday_sections where studio_id = p_from) then
    raise exception 'workday_source_empty' using errcode = '22023';
  end if;
  delete from public.workday_sections where studio_id = p_to;
  for s in select * from public.workday_sections where studio_id = p_from order by sort_order, created_at loop
    insert into public.workday_sections (studio_id, title, sort_order)
    values (p_to, s.title, s.sort_order)
    returning id into v_new;
    insert into public.workday_items
      (studio_id, section_id, title, details, details_expanded, start_time, due_time, sort_order)
    select p_to, v_new, i.title, i.details, i.details_expanded, i.start_time, i.due_time, i.sort_order
      from public.workday_items i
     where i.section_id = s.id;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.workday_copy(uuid, uuid) to authenticated;
