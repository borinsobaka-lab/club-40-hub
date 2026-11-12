-- ============================================================================
-- Почта и телефон клиента — не у двух карточек (решение владельца 2026-11-12).
--
-- Форма клиента в админке (новый клиент, правка) не сохраняет карточку,
-- если такая почта или такой номер (основной или второй) уже есть у другой
-- карточки той же базы клиентов: у пакетных клубов база общая (все пакетные
-- клубы сети), у подписочного клуба — своя. Карточки одного человека в
-- клубах разных форматов (два приложения) — разрешены, как и раньше.
--
-- 1) client_phone_key — номер для сравнения: только цифры, грузинский
--    мобильный без кода страны (5XX XX XX XX) — с 995. «+995 591 09 97 19»,
--    «591099719» и «995591099719» — один номер.
-- 2) client_contact_conflicts (внутренняя) — чужие карточки базы с этой
--    почтой или этими номерами.
-- 3) client_contact_check — та же проверка для формы (подсказка под полем
--    до сохранения): только сотрудник клуба / сети.
-- 4) Триггер clients_contacts_unique_guard_biu — не даёт сохранить, ошибка
--    23505 с текстом для администратора (hint client_contact_taken; форма
--    показывает текст ошибки 23505 как есть). Проверяется только новое
--    значение: уже существующие совпадения не мешают править другие поля.
--    Действует на правки из админки (роль authenticated, не сам клиент):
--    переносы из 1С и прежней студии (функции владельца базы) ищут карточку
--    по телефону сами, клиент в приложении правит свою карточку — его не
--    останавливаем (почта у пакетных — по-прежнему clients_network_unique_guard).
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create or replace function public.client_phone_key(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when d is null or length(d) < 6 then null
           when length(d) = 9 and d like '5%' then '995' || d
           else d
         end
    from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) x
$$;

grant execute on function public.client_phone_key(text) to authenticated, service_role;

create index if not exists clients_phone_key_idx
  on public.clients (public.client_phone_key(phone)) where phone is not null;
create index if not exists clients_phone2_key_idx
  on public.clients (public.client_phone_key(phone2)) where phone2 is not null;

create or replace function public.client_contact_conflicts(
  p_studio uuid,
  p_client uuid,
  p_email text,
  p_phones text[]
)
returns table (field text, value text, client_id uuid, full_name text, studio_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_packages boolean;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_keys text[];
begin
  select s.format = 'packages' into v_packages from public.studios s where s.id = p_studio;
  if not found then
    return;
  end if;
  select coalesce(array_agg(distinct k), '{}') into v_keys
    from unnest(coalesce(p_phones, '{}')) p, lateral (select public.client_phone_key(p) as k) x
   where k is not null;

  if v_email is not null then
    return query
      select 'email'::text, v_email, c.id, c.full_name, s.name
        from public.clients c
        join public.studios s on s.id = c.studio_id
       where lower(btrim(c.email)) = v_email
         and c.id is distinct from p_client
         and (c.studio_id = p_studio or (v_packages and s.format = 'packages'))
       order by c.created_at
       limit 1;
  end if;

  if cardinality(v_keys) > 0 then
    return query
      select distinct on (k.key) 'phone'::text, k.key, c.id, c.full_name, s.name
        from unnest(v_keys) as k(key)
        join public.clients c
          on public.client_phone_key(c.phone) = k.key
          or public.client_phone_key(c.phone2) = k.key
        join public.studios s on s.id = c.studio_id
       where c.id is distinct from p_client
         and (c.studio_id = p_studio or (v_packages and s.format = 'packages'))
       order by k.key, c.created_at;
  end if;
end;
$$;

revoke all on function public.client_contact_conflicts(uuid, uuid, text, text[]) from public, anon, authenticated;

-- Для формы: [{field: 'email'|'phone', value, client_id, full_name, studio_name}].
create or replace function public.client_contact_check(
  p_studio uuid,
  p_client uuid,
  p_email text,
  p_phone text,
  p_phone2 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_network_staff(auth.uid(), p_studio) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'field', x.field, 'value', x.value, 'client_id', x.client_id,
             'full_name', x.full_name, 'studio_name', x.studio_name))
      from public.client_contact_conflicts(p_studio, p_client, p_email,
                                           array[p_phone, p_phone2]) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.client_contact_check(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.client_contact_check(uuid, uuid, text, text, text) to authenticated;

-- Без security definer: current_user — роль того, кто сохраняет (у функции
-- владельца базы — владелец). Проверку зовёт через client_contact_check.
create or replace function public.clients_contacts_unique_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_email text;
  v_phone text;
  v_phone2 text;
  v_old_keys text[] := '{}';
  v_moved boolean := tg_op = 'INSERT' or new.studio_id is distinct from old.studio_id;
  v_hit jsonb;
begin
  -- Только правки из админки: не сервер, не функции владельца базы, не сам клиент.
  if current_user <> 'authenticated'
     or auth.uid() is null or auth.uid() is not distinct from new.user_id then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_keys := array_remove(array[public.client_phone_key(old.phone),
                                     public.client_phone_key(old.phone2)], null);
  end if;

  v_email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  if not v_moved
     and v_email is not distinct from nullif(lower(btrim(coalesce(old.email, ''))), '') then
    v_email := null;
  end if;
  if v_moved or not coalesce(public.client_phone_key(new.phone) = any (v_old_keys), true) then
    v_phone := new.phone;
  end if;
  if v_moved or not coalesce(public.client_phone_key(new.phone2) = any (v_old_keys), true) then
    v_phone2 := new.phone2;
  end if;

  if v_email is null and public.client_phone_key(v_phone) is null
     and public.client_phone_key(v_phone2) is null then
    return new;
  end if;

  v_hit := public.client_contact_check(new.studio_id, new.id, v_email, v_phone, v_phone2) -> 0;
  if v_hit is not null then
    raise exception '% % уже указан у клиента «%» (клуб «%»). Сохранить нельзя: у двух клиентов не может быть одинаковой почты или телефона.',
      case v_hit->>'field' when 'email' then 'Email' else 'Телефон' end,
      case v_hit->>'field' when 'email' then v_hit->>'value' else '+' || (v_hit->>'value') end,
      coalesce(nullif(btrim(v_hit->>'full_name'), ''), 'без имени'),
      v_hit->>'studio_name'
      using errcode = '23505', hint = 'client_contact_taken', detail = v_hit->>'client_id';
  end if;
  return new;
end;
$$;

revoke all on function public.clients_contacts_unique_guard() from public, anon;

drop trigger if exists clients_contacts_unique_guard_biu on public.clients;
create trigger clients_contacts_unique_guard_biu
  before insert or update of email, phone, phone2, studio_id on public.clients
  for each row execute function public.clients_contacts_unique_guard();
