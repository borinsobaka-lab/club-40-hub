-- ============================================================================
-- Комментарии клиентов о тренерах (решение владельца 2026-11-14).
--
-- В карточке тренера пакетного приложения (под оценкой звёздами) клиент
-- оставляет текстовый комментарий — от своего имени или анонимно. Комментарий
-- сначала уходит на модерацию в раздел «Обратная связь» админки (вкладка
-- «Комментарии о тренерах»): сотрудник публикует его или отклоняет. В
-- карточке тренера видны только опубликованные — так по каждому тренеру
-- копятся отзывы клиентов.
--
-- Не путать с trainer_comments (2026-11-05_zz_trainer_app.sql) — это заметки
-- тренера о клиенте в «Тренере в приложении», обратное направление.
--
-- client_trainer_comments:
--   * user_id — автор. Нужен, чтобы клиент видел статус своего комментария и
--     чтобы при удалении учётной записи её комментарии ушли вместе с ней.
--     Другим клиентам не отдаётся никогда — опубликованные они читают через
--     client_trainer_comments_published, где автора нет.
--   * is_anonymous — «Анонимно»: имя не сохраняется вовсе (author_name и
--     author_public пустые), ни в приложении, ни в админке его не видно.
--   * author_name — полное имя из карточки клиента (видит модератор),
--     author_public — «Анна К.» для карточки тренера. Заполняет триггер,
--     клиент имя не присылает.
--   * studio_id — клуб, в котором оставлен комментарий (клуб клиента, если
--     тренер там работает, иначе первый клуб тренера, который клиент видит):
--     по нему фильтрует и ограничивает доступ раздел «Обратная связь».
--   * status: pending — на модерации, approved — опубликован, rejected —
--     отклонён. Модерацию (кто и когда) пишет триггер.
--
-- Права — как у обратной связи (db/security_hardening.sql): читают,
-- модерируют и удаляют сотрудники (is_staff); клиент пишет новый комментарий
-- о тренере, которого видит в приложении (client_can_rate_trainer — то же
-- правило, что у оценки), и читает свои.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create table if not exists public.client_trainer_comments (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  is_anonymous boolean not null default false,
  author_name text,
  author_public text,
  message text not null,
  status text not null default 'pending',
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_by_name text,
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.client_trainer_comments drop constraint if exists client_trainer_comments_status_check;
alter table public.client_trainer_comments add constraint client_trainer_comments_status_check
  check (status in ('pending', 'approved', 'rejected'));

alter table public.client_trainer_comments drop constraint if exists client_trainer_comments_lengths_check;
alter table public.client_trainer_comments add constraint client_trainer_comments_lengths_check check (
  char_length(btrim(message)) between 1 and 2000
  and coalesce(char_length(author_name), 0) <= 200
  and coalesce(char_length(author_public), 0) <= 200
  and coalesce(char_length(moderated_by_name), 0) <= 200
);

alter table public.client_trainer_comments drop constraint if exists client_trainer_comments_anonymous_check;
alter table public.client_trainer_comments add constraint client_trainer_comments_anonymous_check
  check (not is_anonymous or (author_name is null and author_public is null));

comment on table public.client_trainer_comments is
  'Текстовые комментарии клиентов о тренерах: модерация в «Обратной связи», опубликованные — в карточке тренера.';

-- Карточка тренера: опубликованные тренера, новые сверху.
create index if not exists client_trainer_comments_trainer_idx
  on public.client_trainer_comments (trainer_id, status, created_at desc);
-- Раздел «Обратная связь»: на модерации сверху, по клубам.
create index if not exists client_trainer_comments_status_idx
  on public.client_trainer_comments (status, created_at desc);
create index if not exists client_trainer_comments_studio_idx on public.client_trainer_comments (studio_id);
create index if not exists client_trainer_comments_user_idx on public.client_trainer_comments (user_id);

grant select, insert, update, delete on public.client_trainer_comments to authenticated;
grant all on public.client_trainer_comments to service_role;

alter table public.client_trainer_comments enable row level security;

-- 1. Имя для карточки тренера --------------------------------------------------

-- «Анна Курочкина» → «Анна К.»: имя и первая буква фамилии. Без фамилии —
-- одно имя.
create or replace function public.client_trainer_comment_public_name(_first text, _last text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    btrim(
      coalesce(nullif(btrim(_first), ''), '')
      || case
           when nullif(btrim(_first), '') is not null and nullif(btrim(_last), '') is not null
             then ' ' || upper(left(btrim(_last), 1)) || '.'
           else ''
         end
    ),
    ''
  )
$$;

-- 2. Новый комментарий ---------------------------------------------------------

-- Новый комментарий — всегда «на модерации», от имени вошедшего. Клуб и имя
-- ставятся здесь: клиент присылает только тренера, текст и «Анонимно».
-- BEFORE-триггер срабатывает до проверки RLS — политика видит уже
-- исправленную строку. Сотрудник (service_role, миграции) пишет как есть.
create or replace function public.client_trainer_comments_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _client record;
  _meta jsonb;
  _first text;
  _last text;
begin
  if _uid is null then
    -- service_role и прямые вставки владельцем базы — без подмен.
    return new;
  end if;

  new.user_id := _uid;
  new.message := btrim(coalesce(new.message, ''));
  new.status := 'pending';
  new.moderated_by := null;
  new.moderated_by_name := null;
  new.moderated_at := null;
  new.created_at := now();

  -- Один комментарий на модерации на тренера: следующий — после решения
  -- модератора. Защищает раздел от повторных отправок одного и того же.
  if exists (
    select 1 from public.client_trainer_comments c
     where c.trainer_id = new.trainer_id
       and c.user_id = _uid
       and c.status = 'pending'
  ) then
    raise exception 'client_trainer_comment_pending'
      using hint = 'Предыдущий комментарий об этом тренере ещё на модерации.';
  end if;

  -- Клуб: клиента, если тренер в нём работает; иначе первый клуб тренера,
  -- который клиент видит в приложении.
  select ts.studio_id into new.studio_id
    from public.trainer_studios ts
   where ts.trainer_id = new.trainer_id
     and (
       ts.studio_id = public.current_studio_id(_uid)
       or public.client_can_browse_studio(ts.studio_id)
     )
   order by (ts.studio_id = public.current_studio_id(_uid)) desc, ts.studio_id
   limit 1;

  if new.is_anonymous then
    new.author_name := null;
    new.author_public := null;
    return new;
  end if;

  -- Имя — из карточки клиента (сначала в клубе комментария), иначе из
  -- анкеты входа.
  select c.full_name, c.first_name, c.last_name into _client
    from public.clients c
   where c.user_id = _uid
   order by (c.studio_id is not distinct from new.studio_id) desc, c.created_at desc
   limit 1;

  _first := nullif(btrim(coalesce(_client.first_name, '')), '');
  _last := nullif(btrim(coalesce(_client.last_name, '')), '');
  if _first is null and nullif(btrim(coalesce(_client.full_name, '')), '') is not null then
    -- В карточке только полное имя: первое слово — имя, остальное — фамилия.
    _first := split_part(btrim(_client.full_name), ' ', 1);
    _last := nullif(btrim(substr(btrim(_client.full_name), char_length(_first) + 1)), '');
  end if;
  if _first is null then
    select u.raw_user_meta_data into _meta from auth.users u where u.id = _uid;
    _first := nullif(btrim(coalesce(_meta->>'first_name', '')), '');
    _last := nullif(btrim(coalesce(_meta->>'last_name', '')), '');
  end if;

  new.author_name := left(
    nullif(coalesce(nullif(btrim(coalesce(_client.full_name, '')), ''), concat_ws(' ', _first, _last)), ''),
    200
  );
  new.author_public := left(public.client_trainer_comment_public_name(_first, _last), 200);
  return new;
end;
$$;

drop trigger if exists client_trainer_comments_insert_guard_bi on public.client_trainer_comments;
create trigger client_trainer_comments_insert_guard_bi
  before insert on public.client_trainer_comments
  for each row execute function public.client_trainer_comments_insert_guard();

-- 3. Модерация -------------------------------------------------------------------

-- Модератор меняет только статус: текст, автор, тренер и анонимность — то,
-- что написал клиент, — неизменны. Кто и когда принял решение — здесь, по
-- вошедшему сотруднику.
create or replace function public.client_trainer_comments_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _name text;
begin
  new.id := old.id;
  new.trainer_id := old.trainer_id;
  new.user_id := old.user_id;
  new.is_anonymous := old.is_anonymous;
  new.author_name := old.author_name;
  new.author_public := old.author_public;
  new.message := old.message;
  new.created_at := old.created_at;

  if new.studio_id is distinct from old.studio_id and auth.uid() is not null then
    new.studio_id := old.studio_id;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      new.moderated_by := null;
      new.moderated_by_name := null;
      new.moderated_at := null;
    else
      new.moderated_by := auth.uid();
      if auth.uid() is not null then
        select nullif(btrim(p.full_name), '') into _name
          from public.profiles p where p.id = auth.uid();
      end if;
      new.moderated_by_name := left(coalesce(_name, new.moderated_by_name), 200);
      new.moderated_at := now();
    end if;
  else
    new.moderated_by := old.moderated_by;
    new.moderated_by_name := old.moderated_by_name;
    new.moderated_at := old.moderated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists client_trainer_comments_update_guard_bu on public.client_trainer_comments;
create trigger client_trainer_comments_update_guard_bu
  before update on public.client_trainer_comments
  for each row execute function public.client_trainer_comments_update_guard();

-- 4. Доступ ----------------------------------------------------------------------

drop policy if exists "client_trainer_comments own or staff select" on public.client_trainer_comments;
create policy "client_trainer_comments own or staff select" on public.client_trainer_comments
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff(auth.uid()));

drop policy if exists "client_trainer_comments client insert" on public.client_trainer_comments;
create policy "client_trainer_comments client insert" on public.client_trainer_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and public.client_can_rate_trainer(trainer_id)
  );

drop policy if exists "client_trainer_comments staff update" on public.client_trainer_comments;
create policy "client_trainer_comments staff update" on public.client_trainer_comments
  for update to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

drop policy if exists "client_trainer_comments staff delete" on public.client_trainer_comments;
create policy "client_trainer_comments staff delete" on public.client_trainer_comments
  for delete to authenticated
  using (public.is_staff(auth.uid()));

-- 5. Опубликованные — для карточки тренера ---------------------------------------

-- Без user_id и полного имени: другим клиентам автор не отдаётся, у
-- анонимного — вовсе ничего. Видит тот, кому виден тренер (то же правило,
-- что у оценки), и сотрудник.
create or replace function public.client_trainer_comments_published(_trainer_id uuid)
returns table (id uuid, message text, author text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.message, c.author_public, c.created_at
    from public.client_trainer_comments c
   where c.trainer_id = _trainer_id
     and c.status = 'approved'
     and (public.is_staff(auth.uid()) or public.client_can_rate_trainer(_trainer_id))
   order by c.created_at desc
   limit 200
$$;

revoke all on function public.client_trainer_comments_published(uuid) from public, anon;
grant execute on function public.client_trainer_comments_published(uuid) to authenticated;

-- 6. Удаление учётной записи приложения -------------------------------------------

-- Комментарии — данные клиента: уходят вместе с его клиентской частью, как
-- оценки. У обычного клиента их и так удалит каскад от auth.users, а у
-- сотрудника-клиента учётная запись остаётся — поэтому явно. Актуальное
-- определение wipe_client_app_account — здесь (прежнее —
-- 2026-10-12_client_account_wipe.sql, отличие — одна строка).
create or replace function public.wipe_client_app_account(_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if _user_id is null then
    return null;
  end if;

  -- Карточки — история клуба: остаются, но без учётной записи (при следующем
  -- входе по этой почте привяжутся заново). Сначала карточки, потом записи:
  -- триггер записей (schedule_bookings_link_person_biu) иначе вернул бы
  -- user_id из карточки.
  update public.clients set user_id = null where user_id = _user_id;

  update public.schedule_bookings set user_id = null
   where user_id = _user_id and client_id is not null;
  delete from public.schedule_bookings where user_id = _user_id;

  update public.bookings_log set user_id = null
   where user_id = _user_id and client_id is not null;
  delete from public.bookings_log where user_id = _user_id;

  delete from public.member_profiles where user_id = _user_id;
  delete from public.trainer_reviews where user_id = _user_id;
  delete from public.client_trainer_comments where user_id = _user_id;

  if public.client_account_is_staff(_user_id) then
    return 'staff';
  end if;

  begin
    delete from auth.users where id = _user_id;
  exception when others then
    raise warning 'wipe_client_app_account: учётная запись % не удалена: %', _user_id, sqlerrm;
    return 'kept';
  end;
  return 'deleted';
end;
$$;

revoke all on function public.wipe_client_app_account(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
