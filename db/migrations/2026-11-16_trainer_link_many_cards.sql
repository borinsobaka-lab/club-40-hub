-- ============================================================================
-- Один тренер — у нескольких пользователей приложения (решение владельца
-- 2026-11-16: для проверки тренерского приложения сотрудник ставит себе
-- тренера, который уже указан у другой карточки).
--
-- Было (2026-11-05_zz_trainer_app.sql): уникальный индекс
-- app_trainer_links_trainer_key — один тренер, одна карточка. Теперь у
-- карточки по-прежнему один тренер (client_id — ключ), а один тренер может
-- быть у нескольких карточек: каждая видит «Моё расписание» этого тренера,
-- его записанных и комментарии тренеров.
--
-- Пуши тренеру (отмена занятия, замена) уходят на все учётные записи
-- приложения с этим тренером: app_trainer_user отдаёт их все (было — одну),
-- trainer_push шлёт каждой (повтор — push_trigger_log, как раньше).
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

drop index if exists public.app_trainer_links_trainer_key;

create index if not exists app_trainer_links_trainer_idx
  on public.app_trainer_links (trainer_id);

comment on table public.app_trainer_links is
  'Пользователь мобильного приложения — тренер: карточка клиента ↔ тренер справочника; один тренер может быть у нескольких карточек (2026-11-05_zz_trainer_app.sql, 2026-11-16_trainer_link_many_cards.sql).';

-- Учётные записи приложения тренера (для пушей): все, по одной на учётную запись.
create or replace function public.app_trainer_user(p_trainer uuid)
returns table (user_id uuid, client_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (c.user_id) c.user_id, c.id
    from public.app_trainer_links l
    join public.clients c on c.id = l.client_id
   where l.trainer_id = p_trainer and c.user_id is not null
   order by c.user_id, l.created_at
$$;

revoke all on function public.app_trainer_user(uuid) from public, anon, authenticated;
grant execute on function public.app_trainer_user(uuid) to service_role;

-- Пуш тренеру о занятии — каждой его учётной записи приложения.
create or replace function public.trainer_push(
  p_key text,
  p_trainer uuid,
  p_entry uuid,
  p_ref text,
  p_extra jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trigger public.push_triggers;
  v_studio uuid;
  v_vars jsonb;
  v_sent boolean := false;
  u record;
  l text;
begin
  select * into v_trigger from public.push_triggers
   where format = 'packages' and key = p_key and enabled;
  if not found then
    return false;
  end if;
  select e.studio_id into v_studio from public.schedule_entries e where e.id = p_entry;
  for u in select * from public.app_trainer_user(p_trainer) loop
    v_vars := public.push_trigger_vars(u.client_id, v_studio, p_entry, null, null, '{}'::jsonb, now());
    -- Имена тренеров — на языке приложения (переводы справочника).
    foreach l in array array['ru', 'en', 'ka'] loop
      v_vars := jsonb_set(v_vars, array[l], (v_vars -> l) || coalesce(p_extra -> l, '{}'::jsonb));
    end loop;
    if public.push_trigger_send(v_trigger, u.user_id, v_studio, p_ref, v_vars) then
      v_sent := true;
    end if;
  end loop;
  return v_sent;
end;
$$;

revoke all on function public.trainer_push(text, uuid, uuid, text, jsonb) from public, anon, authenticated;
