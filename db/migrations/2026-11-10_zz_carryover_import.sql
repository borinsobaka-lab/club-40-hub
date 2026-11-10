-- ============================================================================
-- Импорт клиентов купленной студии с абонементом переноса (решение владельца
-- 2026-11-10; тип абонемента — 2026-11-10_packages_carryover_membership.sql).
-- Владелец загружает выгрузку прежней студии (xlsx: клиент, телефон,
-- абонемент, остаток, срок, долг) в «Управление» → «Импорт переноса»;
-- страница разбирает файл и отдаёт строки этой функции пачками. Данных
-- клиентов в репозитории нет.
--
--   * clients.carryover_ref / sales.carryover_ref — ключ строки выгрузки
--     («<клуб>:<номер абонемента в прежней студии>»): повторная загрузка того
--     же файла ничего не задваивает, «Удалить перенесённое» находит только
--     перенесённое. Карточка, заведённая импортом, — clients.source =
--     'carryover' («Перенос студии» в «Клиентах»); из админки и приложения
--     carryover_ref и source не подделать (clients_source_guard,
--     sales_carryover_ref_guard).
--   * carryover_import_chunk(jsonb) — пачка строк. Только владелец клуба.
--     Клиент: карточка пакетных клубов с тем же телефоном (phone или phone2)
--     — абонемент добавляется к ней; иначе новая карточка в клубе импорта
--     (регистрация — дата продажи в прежней студии). Каждой строке —
--     продажа «Перенос» абонемента переноса: остаток групповых, срок как в
--     прежней студии, долг — невнесённым платежом к дате debt_due;
--     комментарий — что было в прежней студии.
--   * carryover_import_rollback(uuid, text) — удалить перенесённое в клуб;
--     только пока перенесённые не входили в приложение, по их абонементам
--     переноса ничего не списано и долг не вносили.
--   * client_comments_biu: удаление продажи с комментарием сотрудником
--     падало (см. в конце файла) — исправлено.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

alter table public.clients add column if not exists carryover_ref text;
alter table public.sales add column if not exists carryover_ref text;

create unique index if not exists clients_carryover_ref_key
  on public.clients (carryover_ref) where carryover_ref is not null;
create unique index if not exists sales_carryover_ref_key
  on public.sales (carryover_ref) where carryover_ref is not null;

comment on column public.clients.carryover_ref is
  'Импорт переноса: ключ строки выгрузки купленной студии, по которой заведена карточка (2026-11-10_zz_carryover_import.sql).';
comment on column public.sales.carryover_ref is
  'Импорт переноса: ключ строки выгрузки купленной студии («<клуб>:<номер>»).';

-- «Добавлен» в «Клиентах»: carryover — «Перенос студии».
alter table public.clients drop constraint if exists clients_source_check;
alter table public.clients add constraint clients_source_check
  check (source in ('admin', 'import', 'mobile', 'carryover'));

-- Тело — как в 2026-10-18_zzzzzzz_clients_goal_app_seen.sql, плюс
-- carryover_ref.
create or replace function public.clients_source_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Запросы админки и приложения идут от ролей authenticated / anon; функции
  -- с security definer и сервер — от своих ролей.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.source := 'admin';
      new.onec_ref := null;
      new.carryover_ref := null;
      new.app_last_seen_at := null;
    else
      new.source := old.source;
      new.onec_ref := old.onec_ref;
      new.carryover_ref := old.carryover_ref;
      new.app_last_seen_at := old.app_last_seen_at;
    end if;
  end if;
  if new.onec_ref is not null then
    new.source := 'import';
  elsif new.carryover_ref is not null then
    new.source := 'carryover';
  end if;
  return new;
end;
$$;

create or replace function public.sales_carryover_ref_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.carryover_ref := case when tg_op = 'INSERT' then null else old.carryover_ref end;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_carryover_ref_guard_biu on public.sales;
create trigger sales_carryover_ref_guard_biu
  before insert or update of carryover_ref on public.sales
  for each row execute function public.sales_carryover_ref_guard();

create or replace function public.carryover_import_chunk(p_chunk jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_studio uuid := nullif(p_chunk->>'studio_id', '')::uuid;
  v_membership uuid := nullif(p_chunk->>'membership_id', '')::uuid;
  v_due date := nullif(p_chunk->>'debt_due', '')::date;
  v_today date := (now() at time zone 'Asia/Tbilisi')::date;
  r jsonb;
  v_ref text;
  v_phone text;
  v_client uuid;
  v_sale uuid;
  v_debt numeric;
  r_created int := 0;
  r_reused int := 0;
  r_sales int := 0;
  r_skipped int := 0;
begin
  if not exists (select 1 from public.studios s where s.id = v_studio and s.format = 'packages') then
    raise exception 'Клуб с пакетами тренировок для переноса не найден';
  end if;
  if v_uid is not null and not public.has_role(v_uid, v_studio, 'owner') then
    raise exception 'Переносить клиентов может только владелец клуба' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
      join public.studios s on s.id = m.studio_id and s.format = 'packages'
     where m.id = v_membership and m.kind = 'carryover'
  ) then
    raise exception 'Абонемент переноса не найден — заведите его в «Номенклатурах»';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_chunk->'rows', '[]'::jsonb)) loop
    v_ref := v_studio::text || ':' || (r->>'ref');
    if coalesce(r->>'ref', '') = '' then
      raise exception 'Строка без номера абонемента (%)', r->>'last_name';
    end if;
    if exists (select 1 from public.sales where carryover_ref = v_ref) then
      r_skipped := r_skipped + 1;
      continue;
    end if;

    v_phone := nullif(btrim(coalesce(r->>'phone', '')), '');
    v_client := null;
    if v_phone is not null then
      select c.id into v_client
        from public.clients c
        join public.studios s on s.id = c.studio_id and s.format = 'packages'
       where c.phone = v_phone or c.phone2 = v_phone
       order by c.created_at
       limit 1;
    end if;
    if v_client is not null then
      r_reused := r_reused + 1;
    else
      insert into public.clients (
        studio_id, first_name, last_name, phone, registration_date, carryover_ref
      ) values (
        v_studio,
        nullif(btrim(coalesce(r->>'first_name', '')), ''),
        nullif(btrim(coalesce(r->>'last_name', '')), ''),
        v_phone,
        coalesce(nullif(r->>'registered_on', '')::date, v_today),
        v_ref
      )
      returning id into v_client;
      r_created := r_created + 1;
    end if;

    v_debt := greatest(coalesce((r->>'debt')::numeric, 0), 0);
    if v_debt > 0 and v_due is null then
      raise exception 'Укажите, до какого дня внести долг';
    end if;
    insert into public.sales (
      studio_id, client_id, membership_id, admin_id, sold_at,
      total_amount, down_payment_amount, remaining_installments, source, sale_kind,
      carryover_visits, carryover_personal, carryover_diagnostics,
      carryover_starts_on, carryover_ends_on, comment, carryover_ref
    ) values (
      v_studio, v_client, v_membership, v_uid, v_today,
      v_debt, 0, case when v_debt > 0 then 1 else 0 end, 'admin', 'carryover',
      coalesce((r->>'visits')::int, 0), coalesce((r->>'personal')::int, 0),
      coalesce((r->>'diagnostics')::int, 0),
      (r->>'starts_on')::date, (r->>'ends_on')::date,
      nullif(btrim(coalesce(r->>'comment', '')), ''), v_ref
    )
    returning id into v_sale;
    if v_debt > 0 then
      insert into public.sale_installments (sale_id, due_date, amount, paid)
      values (v_sale, v_due, v_debt, false);
    end if;
    r_sales := r_sales + 1;
  end loop;

  return jsonb_build_object(
    'clients_created', r_created,
    'clients_reused', r_reused,
    'sales_created', r_sales,
    'sales_skipped', r_skipped
  );
end;
$$;

revoke all on function public.carryover_import_chunk(jsonb) from public, anon;
grant execute on function public.carryover_import_chunk(jsonb) to authenticated, service_role;

create or replace function public.carryover_import_rollback(p_studio uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text := p_studio::text || ':%';
  v_sales int;
  v_clients int;
begin
  if p_confirm is distinct from 'УДАЛИТЬ' then
    raise exception 'Для удаления перенесённого введите УДАЛИТЬ';
  end if;
  if v_uid is not null and not public.has_role(v_uid, p_studio, 'owner') then
    raise exception 'Удалить перенесённое может только владелец клуба' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.clients c
     where c.carryover_ref like v_prefix and c.user_id is not null
  ) then
    raise exception 'Перенесённые клиенты уже входили в приложение — удалить перенос целиком нельзя';
  end if;
  if exists (
    select 1 from public.schedule_bookings b
      join public.client_memberships cm on cm.id = b.charged_membership_id
      join public.sales s on s.id = cm.sale_id
     where s.carryover_ref like v_prefix
  ) then
    raise exception 'По перенесённым абонементам уже списывали тренировки — удалить перенос целиком нельзя';
  end if;
  if exists (
    select 1 from public.sale_installments i
      join public.sales s on s.id = i.sale_id
     where s.carryover_ref like v_prefix and i.paid
  ) then
    raise exception 'По перенесённым абонементам уже вносили долг — удалить перенос целиком нельзя';
  end if;

  -- Продажа удаляет и выданный по ней абонемент (sales_delete_client_memberships).
  delete from public.sales where carryover_ref like v_prefix;
  get diagnostics v_sales = row_count;
  -- Карточки, заведённые импортом, — если других продаж и записей у них нет.
  delete from public.clients c
   where c.carryover_ref like v_prefix
     and not exists (select 1 from public.sales s where s.client_id = c.id)
     and not exists (select 1 from public.schedule_bookings b where b.client_id = c.id);
  get diagnostics v_clients = row_count;

  return jsonb_build_object('sales', v_sales, 'clients', v_clients);
end;
$$;

revoke all on function public.carryover_import_rollback(uuid, text) from public, anon;
grant execute on function public.carryover_import_rollback(uuid, text) to authenticated, service_role;

-- Удаление продажи с комментарием сотрудником (и «Удалить перенесённое»)
-- падало: on delete set null у client_comments.sale_id — это update строки
-- ленты, а client_comments_biu от имени вошедшего возвращал прежний sale_id
-- (меняется только текст) — нарушение внешнего ключа. Тело — как в
-- 2026-11-01_zzzzz_client_comments.sql, кроме отвязки от удалённой продажи.

CREATE OR REPLACE FUNCTION public.client_comments_biu()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_sale_client uuid;
begin
  new.body := btrim(new.body);

  if tg_op = 'UPDATE' then
    -- Меняется только текст; остальное — как было (переоформление и смену
    -- клуба карточки пишут триггеры ниже, от владельца базы).
    if v_uid is not null then
      new.id := old.id;
      new.client_id := old.client_id;
      -- Удалили продажу — внешний ключ сам отвязывает комментарий (on delete
      -- set null); вернуть sale_id значило бы сломать удаление продажи.
      new.sale_id := case when new.sale_id is null then null else old.sale_id end;
      new.studio_id := old.studio_id;
      new.kind := old.kind;
      new.author_id := old.author_id;
      new.author_name := old.author_name;
      new.created_at := old.created_at;
      if new.body is distinct from old.body then
        new.edited_at := clock_timestamp();
      else
        new.edited_at := old.edited_at;
      end if;
    end if;
    return new;
  end if;

  -- INSERT
  select c.studio_id into new.studio_id from public.clients c where c.id = new.client_id;
  if new.studio_id is null then
    raise exception 'Клиент не найден' using errcode = 'P0002';
  end if;

  if new.sale_id is not null then
    select s.client_id into v_sale_client from public.sales s where s.id = new.sale_id;
    if v_sale_client is distinct from new.client_id then
      raise exception 'Абонемент не принадлежит этому клиенту' using errcode = '22023';
    end if;
  end if;

  if v_uid is not null then
    -- Из админки: автор — вошедший, время — сейчас, перенос — только миграцией.
    new.author_id := v_uid;
    select nullif(btrim(p.full_name), '') into new.author_name
      from public.profiles p where p.id = v_uid;
    -- clock_timestamp: несколько комментариев одной транзакцией (продажа с
    -- комментарием и заметкой) идут по порядку, а не с одним временем.
    new.created_at := clock_timestamp();
    new.edited_at := null;
    if new.kind = 'imported' then
      new.kind := 'note';
    end if;
  end if;
  return new;
end;
$function$;

notify pgrst, 'reload schema';
