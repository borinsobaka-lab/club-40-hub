-- Вход в клиентское приложение по номеру телефона (решение владельца
-- 2026-11-07): второй способ рядом с почтой. Код в SMS шлёт и проверяет
-- Prelude (prelude.so, Verify API) — сервер админки (/api/phone-login, ключ
-- PRELUDE_API_TOKEN). Пускаем, как по почте, только члена клуба: номер должен
-- быть в карточке клиента (phone или phone2) клуба формата приложения.
--
-- Учётная запись — та же, что при входе по почте:
--   * карточка уже привязана к учётной записи — она;
--   * у карточки есть почта — учётная запись этой почты (нет — создаётся,
--     handle_new_user привязывает карточку по почте), сессия — одноразовой
--     ссылкой входа (generate_link), без писем;
--   * почты нет — учётная запись по телефону (раз в жизни создаётся с
--     app_metadata.phone_login_client — handle_new_user привязывает эту
--     карточку), сессия — разовым паролем, который сервер тут же стирает
--     (phone_login_clear_password): паролей у клиентов по-прежнему нет.
--
-- Всё ниже — только service_role (сервер админки). Таблица попыток — для
-- своих пределов частоты поверх антифрода Prelude.

-- 1. Попытки ------------------------------------------------------------------

create table if not exists public.phone_login_attempts (
  id bigserial primary key,
  phone text not null,
  ip text,
  kind text not null check (kind in ('send', 'check')),
  created_at timestamptz not null default now()
);

create index if not exists phone_login_attempts_phone_idx
  on public.phone_login_attempts (phone, kind, created_at desc);
create index if not exists phone_login_attempts_ip_idx
  on public.phone_login_attempts (ip, kind, created_at desc);

alter table public.phone_login_attempts enable row level security;
revoke all on public.phone_login_attempts from public, anon, authenticated;
grant all on public.phone_login_attempts to service_role;
grant usage, select on sequence public.phone_login_attempts_id_seq to service_role;

comment on table public.phone_login_attempts is
  'Вход по телефону: отправки и проверки кода — пределы частоты (2026-11-07_zzz_phone_login.sql).';

-- Только цифры номера: «+995 591 09 97 19» → 995591099719.
create or replace function public.phone_login_digits(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g')
$$;

-- Можно ли сейчас (и запись попытки, если можно). null — можно, иначе причина:
--   send  — на номер не чаще 5 раз в час и 10 в сутки, с адреса — 20 в час;
--   check — по номеру не чаще 10 проверок за 15 минут.
create or replace function public.phone_login_throttle(p_phone text, p_ip text, p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := public.phone_login_digits(p_phone);
begin
  if p_kind not in ('send', 'check') then
    raise exception 'bad kind %', p_kind;
  end if;
  -- Номер не чаще — в одной транзакции с подсчётом (две вкладки разом).
  perform pg_advisory_xact_lock(hashtext('phone_login:' || v_phone));

  -- Старое не нужно: сутки — самый длинный предел.
  delete from public.phone_login_attempts where created_at < now() - interval '2 days';

  if p_kind = 'send' then
    if (select count(*) from public.phone_login_attempts
         where phone = v_phone and kind = 'send' and created_at > now() - interval '1 hour') >= 5
       or (select count(*) from public.phone_login_attempts
         where phone = v_phone and kind = 'send' and created_at > now() - interval '1 day') >= 10 then
      return 'phone_limit';
    end if;
    if p_ip is not null and (select count(*) from public.phone_login_attempts
         where ip = p_ip and kind = 'send' and created_at > now() - interval '1 hour') >= 20 then
      return 'ip_limit';
    end if;
  else
    if (select count(*) from public.phone_login_attempts
         where phone = v_phone and kind = 'check' and created_at > now() - interval '15 minutes') >= 10 then
      return 'check_limit';
    end if;
  end if;

  insert into public.phone_login_attempts (phone, ip, kind) values (v_phone, p_ip, p_kind);
  return null;
end;
$$;

-- 2. Чей номер ----------------------------------------------------------------

-- Карточки клиентов клубов формата приложения с этим номером (phone или
-- phone2; давний номер без кода страны — как грузинский) и их учётные
-- записи. Сервер решает: одна учётная запись — пускает, несколько разных
-- людей на одном номере — просит войти по почте.
create or replace function public.phone_login_lookup(p_phone text, p_format text)
returns table (
  client_id uuid,
  studio_id uuid,
  user_id uuid,
  email text,
  account_email text,
  account_phone text
)
language sql
stable
security definer
set search_path = public
as $$
  with d as (select public.phone_login_digits(p_phone) as v)
  select c.id, c.studio_id, c.user_id,
         nullif(lower(trim(c.email)), ''),
         u.email, u.phone
    from public.clients c
    join public.studios s on s.id = c.studio_id and s.format = p_format
    left join auth.users u on u.id = c.user_id
   cross join d
   where length(d.v) >= 8
     and (public.phone_login_digits(c.phone) in (d.v, substr(d.v, 4))
          and (public.phone_login_digits(c.phone) = d.v or d.v like '995%')
       or public.phone_login_digits(c.phone2) in (d.v, substr(d.v, 4))
          and (public.phone_login_digits(c.phone2) = d.v or d.v like '995%'))
   order by c.created_at
$$;

-- Учётная запись по почте или телефону (GoTrue хранит телефон без «+»).
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
          and public.phone_login_digits(u.phone) = public.phone_login_digits(p_phone))
   order by u.created_at
   limit 1
$$;

-- Привязать свободную карточку к учётной записи (как ensure_client_profile при
-- входе по почте): карточка, роль member в клубе карточки, профиль, если его
-- нет. Карточка уже чужая — false.
create or replace function public.phone_login_link_client(p_client uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
begin
  select * into v_client from public.clients where id = p_client for update;
  if not found then
    return false;
  end if;
  if v_client.user_id is not null then
    return v_client.user_id = p_user;
  end if;
  update public.clients set user_id = p_user where id = p_client;
  insert into public.profiles (id, studio_id, full_name, email)
  select p_user, v_client.studio_id, coalesce(nullif(trim(v_client.full_name), ''), ''), u.email
    from auth.users u where u.id = p_user
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, studio_id, role)
  values (p_user, v_client.studio_id, 'member')
  on conflict (user_id, studio_id, role) do nothing;
  return true;
end;
$$;

-- Разовый пароль учётной записи без почты — сразу после входа стираем (как
-- у сотрудников: пустой encrypted_password — вход по паролю невозможен).
create or replace function public.phone_login_clear_password(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update auth.users set encrypted_password = ''
   where id = p_user and coalesce(encrypted_password, '') <> ''
$$;

-- Сотрудник (роль в клубе, права в админке или человек портала) по телефону
-- не входит: учётная запись у сотрудника-клиента общая с админкой, а SMS
-- подтверждает только номер — пусть входит по почте, как в админку.
create or replace function public.phone_login_is_staff(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.client_account_is_staff(p_user) or public.is_portal_user(p_user)
$$;

revoke all on function public.phone_login_is_staff(uuid) from public, anon, authenticated;
grant execute on function public.phone_login_is_staff(uuid) to service_role;

revoke all on function public.phone_login_throttle(text, text, text) from public, anon, authenticated;
revoke all on function public.phone_login_lookup(text, text) from public, anon, authenticated;
revoke all on function public.phone_login_account(text, text) from public, anon, authenticated;
revoke all on function public.phone_login_link_client(uuid, uuid) from public, anon, authenticated;
revoke all on function public.phone_login_clear_password(uuid) from public, anon, authenticated;
grant execute on function public.phone_login_throttle(text, text, text) to service_role;
grant execute on function public.phone_login_lookup(text, text) to service_role;
grant execute on function public.phone_login_account(text, text) to service_role;
grant execute on function public.phone_login_link_client(uuid, uuid) to service_role;
grant execute on function public.phone_login_clear_password(uuid) to service_role;

-- 3. Новая учётная запись по телефону ------------------------------------------
-- Как в 2026-10-11_zzzzzzzzz_client_signin_only.sql, плюс: учётную запись без
-- почты сервер входа создаёт с app_metadata.phone_login_client — id карточки,
-- которую он нашёл по номеру. app_metadata задаёт только service_role (из
-- браузера — нет), поэтому подделать привязку нельзя.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _studio_id uuid;
  _client_id uuid;
  _client_name text;
  _first text := nullif(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), '');
  _last  text := nullif(trim(coalesce(new.raw_user_meta_data->>'last_name', '')), '');
  _full  text;
  _phone text := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
  _format text := nullif(new.raw_user_meta_data->>'app_format', '');
  _phone_client uuid := nullif(coalesce(new.raw_app_meta_data->>'phone_login_client', ''), '')::uuid;
begin
  -- Сотрудник из «Доступов»: профиль и роль member в его студии, карточку
  -- клиента не заводим (существующую с той же почтой — привязываем).
  if coalesce(new.raw_user_meta_data->>'staff_account', '') = 'true' then
    _studio_id := nullif(new.raw_user_meta_data->>'studio_id', '')::uuid;
    if _studio_id is null then
      select id into _studio_id from public.studios order by created_at asc limit 1;
    end if;
    if _studio_id is null then
      raise exception 'No studio available for new user %', new.id;
    end if;

    _full := nullif(
      trim(coalesce(new.raw_user_meta_data->>'full_name', concat_ws(' ', _last, _first))),
      ''
    );

    insert into public.profiles (id, studio_id, full_name, email)
    values (new.id, _studio_id, coalesce(_full, ''), new.email)
    on conflict (id) do nothing;

    insert into public.user_roles (user_id, studio_id, role)
    values (new.id, _studio_id, 'member')
    on conflict (user_id, studio_id, role) do nothing;

    update public.clients
       set user_id = new.id
     where user_id is null
       and email is not null
       and lower(trim(email)) = lower(trim(new.email))
       and studio_id = _studio_id;

    return new;
  end if;

  -- Клиент: только по карточке, заведённой на портале. Вход по телефону —
  -- карточка, найденная сервером по номеру.
  if _phone_client is not null then
    select c.id, c.studio_id, c.full_name
      into _client_id, _studio_id, _client_name
      from public.clients c
     where c.id = _phone_client and c.user_id is null;
  else
    select c.id, c.studio_id, c.full_name
      into _client_id, _studio_id, _client_name
      from public.clients c
      join public.studios s on s.id = c.studio_id
     where c.user_id is null
       and c.email is not null
       and new.email is not null
       and lower(trim(c.email)) = lower(trim(new.email))
     order by (s.format = _format) desc nulls last, c.created_at desc
     limit 1;
  end if;

  if _client_id is null then
    raise exception 'Нет карточки клиента с почтой %: войти в приложение может только член клуба, добавленный на портале', new.email
      using errcode = 'P0001';
  end if;

  insert into public.profiles (id, studio_id, full_name, email)
  values (new.id, _studio_id, coalesce(nullif(trim(_client_name), ''), ''), new.email)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, studio_id, role)
  values (new.id, _studio_id, 'member')
  on conflict (user_id, studio_id, role) do nothing;

  update public.clients
     set user_id = new.id,
         phone = coalesce(phone, _phone),
         first_name = coalesce(first_name, _first),
         last_name = coalesce(last_name, _last)
   where id = _client_id;

  return new;
end;
$$;
