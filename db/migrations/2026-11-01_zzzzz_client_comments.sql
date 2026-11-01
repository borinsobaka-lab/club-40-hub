-- ============================================================================
-- Комментарии по клиенту и его абонементам — одной лентой (решение владельца
-- 2026-11-01).
--
-- Раньше комментарий был одним полем: о клиенте — clients.notes, об
-- абонементе — sales.comment («при продаже») и sales.membership_note
-- (раздел «Абонементы»). Поле переписывалось целиком: ни истории, ни автора,
-- ни даты, а смотреть приходилось в трёх местах. Теперь:
--
--   client_comments — лента комментариев: клиент (client_id) и, если
--     комментарий об абонементе, продажа (sale_id). Автор, имя автора и время
--     ставит триггер (из браузера не подделать), правка — только своего
--     текста (edited_at), удаление — своего.
--   kind: 'note' — обычный комментарий, 'sale' — комментарий при продаже
--     (sales.comment), 'imported' — перенесено из прежних полей этой
--     миграцией (автора и даты нет; created_at — время создания строки
--     клиента / продажи, интерфейс пишет «без даты»).
--
-- Видят и пишут сотрудники клубов, которым видна карточка клиента (сеть —
-- auth_network_studio_ids(): у пакетных клубов база клиентов общая, у
-- подписочных — свой клуб). Клиент в приложении ленту не видит.
-- client_comments.studio_id — клуб карточки (ставит триггер, следует за
-- clients.studio_id): политики — массивом, без подзапроса в clients.
--
-- Сводка для таблиц и списков — RPC client_comment_stats(ids): сколько
-- комментариев у клиента (вместе с абонементами), когда последний, кто
-- оставил, его текст. security invoker — действует RLS.
--
-- Прежние поля остаются (их пишут форма продажи и форма нового клиента):
-- новый непустой текст в clients.notes / sales.comment / sales.membership_note
-- триггер дописывает в ленту. Админка эти поля больше не показывает.
-- Абонемент переоформили на другого клиента — его комментарии переходят
-- вместе с ним. Продажу удалили — комментарии остаются у клиента (sale_id
-- null).
-- Идемпотентно. Выполняет мигратор.
-- ============================================================================

create table if not exists public.client_comments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  studio_id uuid not null references public.studios(id) on delete cascade,
  kind text not null default 'note',
  body text not null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_comments_kind_check') then
    alter table public.client_comments
      add constraint client_comments_kind_check check (kind in ('note', 'sale', 'imported'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_comments_body_check') then
    alter table public.client_comments
      add constraint client_comments_body_check
      check (length(btrim(body)) between 1 and 4000);
  end if;
end $$;

create index if not exists client_comments_client_idx
  on public.client_comments (client_id, created_at desc);
create index if not exists client_comments_sale_idx
  on public.client_comments (sale_id) where sale_id is not null;
create index if not exists client_comments_studio_idx on public.client_comments (studio_id);

grant select, insert, update, delete on public.client_comments to authenticated;
grant all on public.client_comments to service_role;
alter table public.client_comments enable row level security;

-- 1. Поля, которые ставит база ------------------------------------------------

create or replace function public.client_comments_biu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
      new.sale_id := old.sale_id;
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
$$;

drop trigger if exists client_comments_biu on public.client_comments;
create trigger client_comments_biu
  before insert or update on public.client_comments
  for each row execute function public.client_comments_biu();

-- 2. Политики ------------------------------------------------------------------

drop policy if exists "client_comments staff read" on public.client_comments;
create policy "client_comments staff read" on public.client_comments
  for select to authenticated
  using (studio_id = any ((select public.auth_network_studio_ids())::uuid[]));

drop policy if exists "client_comments staff insert" on public.client_comments;
create policy "client_comments staff insert" on public.client_comments
  for insert to authenticated
  with check (studio_id = any ((select public.auth_network_studio_ids())::uuid[])
              and author_id = (select auth.uid()));

drop policy if exists "client_comments author update" on public.client_comments;
create policy "client_comments author update" on public.client_comments
  for update to authenticated
  using (author_id = (select auth.uid())
         and studio_id = any ((select public.auth_network_studio_ids())::uuid[]))
  with check (author_id = (select auth.uid()));

-- Свой — автор; без автора (перенесён из прежних полей, записан сервером
-- или переносом из 1С) — любой сотрудник, которому видна карточка: прежнее
-- поле правил кто угодно из них.
drop policy if exists "client_comments author delete" on public.client_comments;
create policy "client_comments author delete" on public.client_comments
  for delete to authenticated
  using ((author_id = (select auth.uid()) or author_id is null)
         and studio_id = any ((select public.auth_network_studio_ids())::uuid[]));

-- Текст без автора правит любой сотрудник карточки (как прежнее поле);
-- своё авторство он при этом не получает.
drop policy if exists "client_comments ownerless update" on public.client_comments;
create policy "client_comments ownerless update" on public.client_comments
  for update to authenticated
  using (author_id is null
         and studio_id = any ((select public.auth_network_studio_ids())::uuid[]))
  with check (author_id is null);

-- 3. Сводка для таблиц -------------------------------------------------------------

create or replace function public.client_comment_stats(p_client_ids uuid[])
returns table (
  client_id uuid,
  comments_count integer,
  last_at timestamptz,
  last_kind text,
  last_author text,
  last_body text,
  last_sale_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (cc.client_id)
         cc.client_id,
         (count(*) over (partition by cc.client_id))::integer,
         cc.created_at,
         cc.kind,
         cc.author_name,
         left(cc.body, 300),
         cc.sale_id
    from public.client_comments cc
   where cc.client_id = any (p_client_ids)
   order by cc.client_id, cc.created_at desc, cc.id desc
$$;

revoke all on function public.client_comment_stats(uuid[]) from public;
grant execute on function public.client_comment_stats(uuid[]) to authenticated, service_role;

-- 4. Клуб карточки и переоформление -----------------------------------------------

create or replace function public.client_comments_follow_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.client_comments set studio_id = new.studio_id
   where client_id = new.id and studio_id is distinct from new.studio_id;
  return new;
end;
$$;

drop trigger if exists clients_comments_studio_au on public.clients;
create trigger clients_comments_studio_au
  after update of studio_id on public.clients
  for each row when (old.studio_id is distinct from new.studio_id)
  execute function public.client_comments_follow_client();

create or replace function public.client_comments_follow_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.client_comments cc
     set client_id = new.client_id,
         studio_id = c.studio_id
    from public.clients c
   where cc.sale_id = new.id and c.id = new.client_id;
  return new;
end;
$$;

drop trigger if exists sales_comments_client_au on public.sales;
create trigger sales_comments_client_au
  after update of client_id on public.sales
  for each row when (old.client_id is distinct from new.client_id)
  execute function public.client_comments_follow_sale();

-- 5. Прежние поля → лента ------------------------------------------------------------

-- Новый непустой текст поля — новый комментарий от того, кто его записал
-- (форма нового клиента, форма продажи). Стёртое поле ленту не трогает.
create or replace function public.clients_notes_to_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(new.notes), '') is not null
     and (tg_op = 'INSERT' or btrim(new.notes) is distinct from btrim(coalesce(old.notes, ''))) then
    insert into public.client_comments (client_id, kind, body, author_id)
    values (new.id, 'note', left(btrim(new.notes), 4000), auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists clients_notes_to_comments_aiu on public.clients;
create trigger clients_notes_to_comments_aiu
  after insert or update of notes on public.clients
  for each row execute function public.clients_notes_to_comments();

create or replace function public.sales_notes_to_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(new.comment), '') is not null
     and (tg_op = 'INSERT' or btrim(new.comment) is distinct from btrim(coalesce(old.comment, ''))) then
    insert into public.client_comments (client_id, sale_id, kind, body, author_id)
    values (new.client_id, new.id, 'sale', left(btrim(new.comment), 4000), auth.uid());
  end if;
  if nullif(btrim(new.membership_note), '') is not null
     and (tg_op = 'INSERT'
          or btrim(new.membership_note) is distinct from btrim(coalesce(old.membership_note, ''))) then
    insert into public.client_comments (client_id, sale_id, kind, body, author_id)
    values (new.client_id, new.id, 'note', left(btrim(new.membership_note), 4000), auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists sales_notes_to_comments_aiu on public.sales;
create trigger sales_notes_to_comments_aiu
  after insert or update of comment, membership_note on public.sales
  for each row execute function public.sales_notes_to_comments();

-- Триггерные функции не вызываются напрямую.
revoke all on function public.client_comments_biu() from public;
revoke all on function public.client_comments_follow_client() from public;
revoke all on function public.client_comments_follow_sale() from public;
revoke all on function public.clients_notes_to_comments() from public;
revoke all on function public.sales_notes_to_comments() from public;

-- 6. Разовый перенос прежних полей ------------------------------------------------------

-- Повторный запуск не задваивает: переносим, только если у строки ещё нет
-- перенесённого комментария с тем же текстом.
insert into public.client_comments (client_id, kind, body, created_at)
select c.id, 'imported', left(btrim(c.notes), 4000), c.created_at
  from public.clients c
 where nullif(btrim(c.notes), '') is not null
   and not exists (select 1 from public.client_comments cc
                    where cc.client_id = c.id and cc.sale_id is null
                      and cc.kind = 'imported' and cc.body = left(btrim(c.notes), 4000));

insert into public.client_comments (client_id, sale_id, kind, body, created_at)
select s.client_id, s.id, 'imported', left(btrim(x.body), 4000), s.created_at
  from public.sales s
  cross join lateral (values (s.comment), (s.membership_note)) as x(body)
 where nullif(btrim(x.body), '') is not null
   and not exists (select 1 from public.client_comments cc
                    where cc.sale_id = s.id and cc.kind = 'imported'
                      and cc.body = left(btrim(x.body), 4000));
