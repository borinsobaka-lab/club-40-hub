-- ============================================================================
-- Смена почты и телефона в карточке клиента — вход по новым (решение
-- владельца 2026-11-12).
--
-- Было: учётная запись приложения привязана к карточке (clients.user_id) и
-- хранит свою почту и телефон (auth.users). Сотрудник меняет почту в карточке —
-- учётная запись остаётся со старой. Вход по новой почте: GoTrue не находит
-- учётную запись, создаёт новую, а handle_new_user не находит свободной
-- карточки с этой почтой (карточка привязана к старой) — «Эта почта не найдена
-- среди клиентов… Обратитесь к администратору». Так же — почту дописали в
-- карточку клиента, входившего по телефону.
--
-- Стало — триггер clients_contact_account_sync_au (почта, телефон карточки):
-- 1) Почта. У учётной записи карточки (не сотрудник) почта становится почтой
--    карточки — тот же человек, те же анкета, записи, история; входит по
--    новой почте, по старой — нет. Если почта занята другой учётной записью,
--    учётная запись — сотрудник (почта служебной части не меняется: решение
--    2026-10-12 «сотрудник и клиент независимо») или у неё есть другая
--    карточка со старой почтой — карточку отвязываем: при входе по новой
--    почте она привяжется к учётной записи этой почты (новой или
--    существующей) — как карточка, заведённая заново.
-- 2) Телефон. Если телефон учётной записи больше не указан ни в одной её
--    карточке — снимаем его с учётной записи (вход по телефону ищет карточку
--    по номеру карточки и сам впишет новый). Иначе старый номер оставался бы
--    за учётной записью, и человек, которому этот номер дадут в карточке,
--    попал бы при входе по телефону в чужую учётную запись
--    (phone_login_account) или получил бы ошибку.
-- Клиент, сам поменявший почту в приложении, учётную запись этим не меняет
-- (почта не подтверждена) — только сотрудник и сервер.
-- Учётную запись GoTrue правим в SQL, как phone_login_clear_password; любая
-- ошибка там — карточку отвязываем, сохранение карточки не ломается.
--
-- phone_login_account: по телефону — только учётная запись без карточек
-- (её создал вход по телефону для карточки без почты, а карточку потом
-- удалили). Учётная запись с карточками по одному лишь номеру к новой
-- карточке не привязывается.
--
-- Разово: тот же пересчёт для всех учётных записей с карточками, где почта
-- или телефон уже расходятся.
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

-- Тот же номер (как в phone_login_lookup: «995…» ↔ местный без кода страны).
create or replace function public.phone_login_same(p_card text, p_account text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select length(public.phone_login_digits(p_account)) >= 8
     and (public.phone_login_digits(p_card) = public.phone_login_digits(p_account)
          or (public.phone_login_digits(p_account) like '995%'
              and public.phone_login_digits(p_card) = substr(public.phone_login_digits(p_account), 4)))
$$;

revoke all on function public.phone_login_same(text, text) from public, anon, authenticated;

-- Отвязать карточку от учётной записи (её записи — тоже: при новой привязке
-- clients_link_bookings впишет новую). Сначала карточка, потом записи —
-- иначе триггер записей вернул бы user_id из карточки.
create or replace function public.client_unlink_account(p_client uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clients set user_id = null where id = p_client and user_id = p_user;
  update public.schedule_bookings set user_id = null
   where client_id = p_client and user_id = p_user;
  update public.bookings_log set user_id = null
   where client_id = p_client and user_id = p_user;
end;
$$;

revoke all on function public.client_unlink_account(uuid, uuid) from public, anon, authenticated;

-- Почта и телефон учётной записи — по её карточкам. p_prefer — карточка,
-- которую только что изменили (её почта — главная, если почт несколько).
create or replace function public.client_account_contact_sync(p_user uuid, p_prefer uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_phone text;
  v_staff boolean;
  v_target text;
  v_card record;
begin
  if p_user is null then
    return;
  end if;
  select nullif(lower(btrim(u.email)), ''), nullif(btrim(u.phone), '')
    into v_email, v_phone
    from auth.users u where u.id = p_user;
  if not found then
    return;
  end if;
  v_staff := public.client_account_is_staff(p_user) or public.is_portal_user(p_user);

  -- 1. Почта ------------------------------------------------------------------
  if not v_staff and (
       v_email is null
       or not exists (
         select 1 from public.clients c
          where c.user_id = p_user and lower(btrim(c.email)) = v_email
       )
     ) then
    -- Почта учётной записи ни в одной её карточке — берём почту карточки.
    select lower(btrim(c.email)) into v_target
      from public.clients c
     where c.user_id = p_user and nullif(btrim(c.email), '') is not null
     order by (c.id = p_prefer) desc, c.created_at desc
     limit 1;
    if v_target is not null and not exists (
         select 1 from auth.users u
          where u.id <> p_user and lower(btrim(u.email)) = v_target
       ) then
      begin
        update auth.users
           set email = v_target,
               email_confirmed_at = coalesce(email_confirmed_at, now()),
               updated_at = now()
         where id = p_user;
        v_email := v_target;
      exception when others then
        raise warning 'client_account_contact_sync: почта учётной записи % не изменена: %',
          p_user, sqlerrm;
      end;
      if v_email = v_target then
        -- Учётная запись GoTrue с почтой — и вход по почте (identity «email»).
        begin
          update auth.identities
             set identity_data = coalesce(identity_data, '{}'::jsonb)
                                 || jsonb_build_object('email', v_target)
           where user_id = p_user and provider = 'email';
          if not found then
            insert into auth.identities (provider_id, user_id, identity_data, provider,
                                         created_at, updated_at)
            values (p_user::text, p_user,
                    jsonb_build_object('sub', p_user::text, 'email', v_target,
                                       'email_verified', true),
                    'email', now(), now());
          end if;
        exception when others then
          raise warning 'client_account_contact_sync: identity учётной записи %: %',
            p_user, sqlerrm;
        end;
        update public.profiles set email = v_target where id = p_user;
      end if;
    end if;
  end if;

  -- Карточки с другой почтой — свободны: войдут по своей почте.
  for v_card in
    select c.id from public.clients c
     where c.user_id = p_user
       and nullif(btrim(c.email), '') is not null
       and lower(btrim(c.email)) is distinct from v_email
  loop
    perform public.client_unlink_account(v_card.id, p_user);
  end loop;

  -- 2. Телефон ----------------------------------------------------------------
  if not v_staff and v_phone is not null and not exists (
       select 1 from public.clients c
        where c.user_id = p_user
          and (public.phone_login_same(c.phone, v_phone)
               or public.phone_login_same(c.phone2, v_phone))
     ) then
    begin
      update auth.users
         set phone = null, phone_confirmed_at = null, updated_at = now()
       where id = p_user;
    exception when undefined_column then
      update auth.users set phone = null where id = p_user;
    when others then
      raise warning 'client_account_contact_sync: телефон учётной записи % не снят: %',
        p_user, sqlerrm;
    end;
  end if;
end;
$$;

revoke all on function public.client_account_contact_sync(uuid, uuid) from public, anon, authenticated;

create or replace function public.clients_contact_account_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    return new;
  end if;
  if nullif(lower(btrim(new.email)), '') is not distinct from nullif(lower(btrim(old.email)), '')
     and new.phone is not distinct from old.phone
     and new.phone2 is not distinct from old.phone2 then
    return new;
  end if;
  -- Клиент правит свою карточку сам (почта не подтверждена) — учётную запись
  -- не трогаем; меняет сотрудник или сервер — пересчитываем.
  if auth.uid() is not null and auth.uid() = new.user_id then
    return new;
  end if;
  perform public.client_account_contact_sync(new.user_id, new.id);
  return new;
end;
$$;

revoke all on function public.clients_contact_account_sync() from public, anon, authenticated;

drop trigger if exists clients_contact_account_sync_au on public.clients;
create trigger clients_contact_account_sync_au
  after update of email, phone, phone2 on public.clients
  for each row execute function public.clients_contact_account_sync();

-- Учётная запись по почте или телефону — по телефону только без карточек.
create or replace function public.phone_login_account(p_email text, p_phone text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from auth.users u
   where (p_email is not null and lower(trim(u.email)) = lower(trim(p_email)))
      or (p_email is null and p_phone is not null
          and public.phone_login_digits(u.phone) = public.phone_login_digits(p_phone)
          and not exists (select 1 from public.clients c where c.user_id = u.id))
   order by u.created_at
   limit 1
$$;

revoke all on function public.phone_login_account(text, text) from public, anon, authenticated;
grant execute on function public.phone_login_account(text, text) to service_role;

-- Разово: учётные записи, у которых почта или телефон уже разошлись с карточками.
do $$
declare
  r record;
begin
  for r in
    select distinct c.user_id
      from public.clients c
      join auth.users u on u.id = c.user_id
     where (nullif(btrim(c.email), '') is not null
            and lower(btrim(c.email)) is distinct from nullif(lower(btrim(u.email)), ''))
        or (nullif(btrim(u.phone), '') is not null and not exists (
              select 1 from public.clients c2
               where c2.user_id = u.id
                 and (public.phone_login_same(c2.phone, u.phone)
                      or public.phone_login_same(c2.phone2, u.phone))))
  loop
    perform public.client_account_contact_sync(r.user_id);
  end loop;
end;
$$;
