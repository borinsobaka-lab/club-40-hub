-- ============================================================================
-- «Моё расписание» тренера в приложении — все его занятия (решение владельца
-- 2026-11-16: персональные, диагностики и прочая активность — тоже часть
-- расписания тренера).
--
-- 1) trainer_my_entries — ближайшие занятия вызывающего тренера любого вида
--    (group / personal / diagnostic / other; было — только групповые,
--    2026-11-05_zz_trainer_app.sql).
-- 2) trainer_entries_view(p_ids) — сами занятия для карточек «Моего
--    расписания» в том же виде, что приложение читает обычным запросом
--    (PACK_ENTRY_SELECT) + title (название прочей активности). Персональные
--    и прочие RLS клиента не открывает, поэтому — RPC: только занятия,
--    которые ведёт вызывающий тренер. У персонального и диагностики —
--    clients: имена записанных (полностью, как в «Информации для тренера»).
--    Окно занятия, записанные и анкета работают для любого вида:
--    trainer_check_entry / trainer_check_client вид занятия не смотрят.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create or replace function public.trainer_my_entries(p_offset integer default 0, p_limit integer default 6)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
    from public.schedule_entries e
    join public.schedule_entry_trainers et on et.entry_id = e.id
   where et.trainer_id = public.app_trainer_of(auth.uid())
     and e.cancelled_at is null
     and e.ends_at > now()
   order by e.starts_at, e.id
  offset greatest(coalesce(p_offset, 0), 0)
   limit least(greatest(coalesce(p_limit, 6), 1), 50)
$$;

create or replace function public.trainer_entries_view(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', e.id,
             'studio_id', e.studio_id,
             'kind', e.kind,
             'title', e.title,
             'starts_at', e.starts_at,
             'ends_at', e.ends_at,
             'capacity', e.capacity,
             'booked_count', e.booked_count,
             'workout', case when w.id is null then null else jsonb_build_object(
               'id', w.id,
               'name', w.name,
               'color', w.color,
               'description', w.description,
               'photo_url', w.photo_url,
               'capacity', w.capacity,
               'translations', w.translations) end,
             'trainers', (
               select coalesce(jsonb_agg(jsonb_build_object('trainer', jsonb_build_object(
                        'id', t.id,
                        'full_name', t.full_name,
                        'photo_url', t.photo_url,
                        'rating_avg', t.rating_avg,
                        'rating_count', t.rating_count,
                        'translations', t.translations)) order by t.full_name), '[]'::jsonb)
                 from public.schedule_entry_trainers et2
                 join public.trainers t on t.id = et2.trainer_id
                where et2.entry_id = e.id),
             'clients', case when e.kind in ('personal', 'diagnostic') then (
               select coalesce(jsonb_agg(
                        coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.full_name)
                        order by c.last_name, c.first_name), '[]'::jsonb)
                 from public.schedule_bookings b
                 join public.clients c on c.id = b.client_id
                where b.entry_id = e.id
                  and b.status in ('booked', 'attended', 'no_show')) end)
           order by e.starts_at, e.id), '[]'::jsonb)
    from public.schedule_entries e
    left join public.workouts w on w.id = e.workout_id
   where e.id = any (coalesce(p_ids, '{}'::uuid[]))
     and exists (
       select 1 from public.schedule_entry_trainers et
        where et.entry_id = e.id
          and et.trainer_id = public.app_trainer_of(auth.uid()))
$$;

revoke all on function public.trainer_my_entries(integer, integer),
  public.trainer_entries_view(uuid[]) from public, anon;
grant execute on function public.trainer_my_entries(integer, integer),
  public.trainer_entries_view(uuid[]) to authenticated, service_role;
