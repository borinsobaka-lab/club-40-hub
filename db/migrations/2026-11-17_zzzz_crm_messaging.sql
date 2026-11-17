-- CRM, этап 2 — переписка (CRM.md): подключённые аккаунты мессенджеров,
-- личности контакта в каналах, диалоги и сообщения, шаблоны ответов, файлы.
-- Первый канал — Telegram-бот; остальные (личный Telegram, WhatsApp,
-- Instagram, Facebook) ложатся в эти же таблицы.
--
--   crm_channel_accounts   — подключённый аккаунт: вид, название, клуб (от
--                            него клуб новых сделок и кто видит диалоги;
--                            без клуба — видят все с правом CRM), воронка
--                            для новых обращений. Правит crm.manage.
--   crm_channel_secrets    — токены аккаунта. Только service_role: в браузер
--                            и сотрудникам не отдаются никогда.
--   crm_contact_identities — контакт в канале: внешний id, ник, имя. Один
--                            человек — один контакт и несколько личностей.
--                            Telegram и WhatsApp — id общий для всех наших
--                            аккаунтов (account_id пуст); Instagram и
--                            Facebook — свой у каждого аккаунта.
--   crm_conversations      — диалог: контакт × аккаунт; последнее сообщение,
--                            непрочитанные. Клуб — клуб аккаунта.
--   crm_messages           — сообщения. Пишет только сервер (service_role):
--                            входящие — crm_ingest_message, исходящие —
--                            сервер админки после отправки в канал.
--   crm_reply_templates    — шаблоны ответов.
-- Файлы — закрытый бакет crm-media, папка — id диалога.
--
-- crm_ingest_message (service_role) — входящее сообщение: находит или
-- заводит контакт (по id в канале; Instagram — ещё по нику в другом нашем
-- аккаунте; по телефону), диалог, сообщение (повтор вебхука не задваивает)
-- и, если у контакта нет открытой сделки, — сделку в первом этапе воронки
-- аккаунта.

-- 1) Таблицы ----------------------------------------------------------------------
create table if not exists public.crm_channel_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    check (kind in ('telegram_bot', 'telegram_user', 'whatsapp', 'instagram', 'facebook')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  studio_id uuid references public.studios(id) on delete set null,
  pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  -- Аккаунт в канале: id бота / страницы / номера и ник.
  external_id text,
  username text,
  status text not null default 'active' check (status in ('active', 'error', 'disabled')),
  status_note text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create unique index if not exists crm_channel_accounts_external_uidx
  on public.crm_channel_accounts (kind, external_id) where external_id is not null;

create table if not exists public.crm_channel_secrets (
  account_id uuid primary key references public.crm_channel_accounts(id) on delete cascade,
  token text not null,
  webhook_secret text,
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_contact_identities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp', 'instagram', 'facebook')),
  -- Пусто — id общий для всех наших аккаунтов канала (Telegram, WhatsApp).
  account_id uuid references public.crm_channel_accounts(id) on delete cascade,
  external_id text not null,
  username text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_contact_identities_uidx
  on public.crm_contact_identities
     (channel, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), external_id);
create index if not exists crm_contact_identities_contact_idx
  on public.crm_contact_identities (contact_id);
create index if not exists crm_contact_identities_username_idx
  on public.crm_contact_identities (channel, lower(username)) where username is not null;

create table if not exists public.crm_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  account_id uuid not null references public.crm_channel_accounts(id) on delete cascade,
  identity_id uuid references public.crm_contact_identities(id) on delete set null,
  -- Клуб аккаунта (кто видит диалог); ставит триггер.
  studio_id uuid references public.studios(id) on delete set null,
  external_chat_id text not null,
  last_message_at timestamptz,
  last_message_text text,
  last_direction text check (last_direction in ('in', 'out')),
  -- Когда клиент писал в последний раз: окно ответа 24 ч у Instagram,
  -- Facebook и WhatsApp.
  last_inbound_at timestamptz,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (account_id, external_chat_id)
);
create index if not exists crm_conversations_contact_idx on public.crm_conversations (contact_id);
create index if not exists crm_conversations_recent_idx
  on public.crm_conversations (last_message_at desc nulls last);
create index if not exists crm_conversations_unread_idx
  on public.crm_conversations (studio_id) where unread_count > 0;

create table if not exists public.crm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text check (body is null or char_length(body) <= 20000),
  -- [{kind: image|video|audio|file, path, name, mime, size}] — path в crm-media.
  attachments jsonb not null default '[]',
  external_id text,
  status text not null default 'received'
    check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  error text,
  -- Кто из сотрудников отправил (исходящее); автоматизация — auto.
  sent_by uuid references auth.users(id) on delete set null,
  sent_by_name text,
  auto boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_messages_conversation_idx
  on public.crm_messages (conversation_id, created_at);
create unique index if not exists crm_messages_external_uidx
  on public.crm_messages (conversation_id, external_id) where external_id is not null;

create table if not exists public.crm_reply_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Триггеры ---------------------------------------------------------------------
create or replace function public.crm_channel_accounts_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.kind := old.kind;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_channel_accounts_biu on public.crm_channel_accounts;
create trigger crm_channel_accounts_biu before insert or update on public.crm_channel_accounts
  for each row execute function public.crm_channel_accounts_biu();

-- Клуб аккаунта сменили — диалоги идут за ним.
create or replace function public.crm_channel_accounts_studio_au()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.studio_id is distinct from old.studio_id then
    update public.crm_conversations set studio_id = new.studio_id where account_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists crm_channel_accounts_studio_au on public.crm_channel_accounts;
create trigger crm_channel_accounts_studio_au after update on public.crm_channel_accounts
  for each row execute function public.crm_channel_accounts_studio_au();

create or replace function public.crm_conversations_bi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.studio_id := (select studio_id from public.crm_channel_accounts where id = new.account_id);
  return new;
end;
$$;
drop trigger if exists crm_conversations_bi on public.crm_conversations;
create trigger crm_conversations_bi before insert on public.crm_conversations
  for each row execute function public.crm_conversations_bi();

-- Сообщение — в сводку диалога: входящее добавляет непрочитанное, ответ
-- сотрудника их снимает.
create or replace function public.crm_messages_ai()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_conversations c
     set last_message_at = new.created_at,
         last_message_text = left(coalesce(nullif(btrim(new.body), ''),
           case when jsonb_array_length(new.attachments) > 0 then '📎 Вложение' else '' end), 300),
         last_direction = new.direction,
         last_inbound_at = case when new.direction = 'in' then new.created_at else c.last_inbound_at end,
         unread_count = case when new.direction = 'in' then c.unread_count + 1
                             when new.auto then c.unread_count
                             else 0 end
   where c.id = new.conversation_id
     and (c.last_message_at is null or c.last_message_at <= new.created_at);
  -- Сообщение пришло раньше последнего (повтор, история) — только счётчик.
  if not found and new.direction = 'in' then
    update public.crm_conversations set unread_count = unread_count + 1 where id = new.conversation_id;
  end if;
  return null;
end;
$$;
drop trigger if exists crm_messages_ai on public.crm_messages;
create trigger crm_messages_ai after insert on public.crm_messages
  for each row execute function public.crm_messages_ai();

create or replace function public.crm_reply_templates_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.title := btrim(new.title);
  new.body := btrim(new.body);
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists crm_reply_templates_biu on public.crm_reply_templates;
create trigger crm_reply_templates_biu before insert or update on public.crm_reply_templates
  for each row execute function public.crm_reply_templates_biu();

-- 3) RLS --------------------------------------------------------------------------
alter table public.crm_channel_accounts enable row level security;
alter table public.crm_channel_secrets enable row level security;
alter table public.crm_contact_identities enable row level security;
alter table public.crm_conversations enable row level security;
alter table public.crm_messages enable row level security;
alter table public.crm_reply_templates enable row level security;

-- Сотруднику — только чтение (аккаунты и шаблоны правит crm.manage);
-- диалоги и сообщения пишет сервер.
revoke all on public.crm_channel_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.crm_channel_secrets to service_role;
grant select, insert, update, delete on public.crm_channel_accounts, public.crm_reply_templates
  to authenticated, service_role;
grant select on public.crm_contact_identities, public.crm_conversations, public.crm_messages
  to authenticated;
grant select, insert, update, delete on public.crm_contact_identities, public.crm_conversations,
  public.crm_messages to service_role;

drop policy if exists "crm_channel_accounts read" on public.crm_channel_accounts;
create policy "crm_channel_accounts read" on public.crm_channel_accounts for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_channel_accounts manage" on public.crm_channel_accounts;
create policy "crm_channel_accounts manage" on public.crm_channel_accounts for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

drop policy if exists "crm_reply_templates read" on public.crm_reply_templates;
create policy "crm_reply_templates read" on public.crm_reply_templates for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_reply_templates manage" on public.crm_reply_templates;
create policy "crm_reply_templates manage" on public.crm_reply_templates for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

drop policy if exists "crm_contact_identities read" on public.crm_contact_identities;
create policy "crm_contact_identities read" on public.crm_contact_identities for select to authenticated
  using ((select public.auth_crm_can_view()));

-- Диалог: аккаунт своего клуба или без клуба.
drop policy if exists "crm_conversations read" on public.crm_conversations;
create policy "crm_conversations read" on public.crm_conversations for select to authenticated
  using ((select public.auth_crm_can_view())
         and (studio_id is null or studio_id = any ((select public.auth_crm_studio_ids())::uuid[])));

drop policy if exists "crm_messages read" on public.crm_messages;
create policy "crm_messages read" on public.crm_messages for select to authenticated
  using (exists (select 1 from public.crm_conversations c where c.id = conversation_id));

-- 4) Файлы ------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-media', 'crm-media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Читать — файлы диалогов, которые видит сотрудник (папка — id диалога);
-- пишет только сервер.
drop policy if exists "crm-media read" on storage.objects;
create policy "crm-media read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'crm-media'
    and exists (select 1 from public.crm_conversations c
                 where c.id::text = (storage.foldername(name))[1])
  );

-- 5) RPC --------------------------------------------------------------------------
create or replace function public.crm_channel_of(_kind text)
returns text
language sql
immutable
as $$
  select case when _kind in ('telegram_bot', 'telegram_user') then 'telegram' else _kind end
$$;

-- Входящее сообщение канала. p_sender: {external_id, username, name, phone};
-- p_message: {external_id, body, attachments, sent_at}.
create or replace function public.crm_ingest_message(
  p_account uuid, p_chat text, p_sender jsonb, p_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acc public.crm_channel_accounts;
  v_channel text;
  v_scope uuid;
  v_ext text := nullif(btrim(coalesce(p_sender->>'external_id', '')), '');
  v_username text := nullif(btrim(coalesce(p_sender->>'username', '')), '');
  v_name text := nullif(btrim(coalesce(p_sender->>'name', '')), '');
  v_phone text := nullif(btrim(coalesce(p_sender->>'phone', '')), '');
  v_identity public.crm_contact_identities;
  v_contact uuid;
  v_conv uuid;
  v_msg uuid;
  v_deal uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_at timestamptz := coalesce((p_message->>'sent_at')::timestamptz, now());
begin
  select * into v_acc from public.crm_channel_accounts where id = p_account;
  if v_acc.id is null or v_acc.status = 'disabled' then
    raise exception 'crm_account_not_found' using errcode = '23503';
  end if;
  if v_ext is null or nullif(btrim(coalesce(p_chat, '')), '') is null then
    raise exception 'crm_bad_message' using errcode = '22023';
  end if;
  v_channel := public.crm_channel_of(v_acc.kind);
  v_scope := case when v_channel in ('instagram', 'facebook') then v_acc.id end;

  -- Один и тот же человек пишет впервые двумя сообщениями подряд — не два контакта.
  perform pg_advisory_xact_lock(hashtextextended(v_channel || ':' || v_ext, 0));

  select * into v_identity from public.crm_contact_identities i
   where i.channel = v_channel and i.external_id = v_ext
     and i.account_id is not distinct from v_scope;

  if v_identity.id is null then
    -- Instagram: тот же ник уже писал в другой наш аккаунт.
    if v_channel = 'instagram' and v_username is not null then
      select i.contact_id into v_contact from public.crm_contact_identities i
       where i.channel = 'instagram' and lower(i.username) = lower(v_username)
       order by i.created_at limit 1;
    end if;
    if v_contact is null and public.client_phone_key(v_phone) is not null then
      select c.id into v_contact from public.crm_contacts c
       where public.client_phone_key(c.phone) = public.client_phone_key(v_phone)
       order by c.created_at limit 1;
    end if;
    if v_contact is null then
      insert into public.crm_contacts (name, phone)
      values (coalesce(v_name, v_username, 'Без имени'), v_phone)
      returning id into v_contact;
    end if;
    insert into public.crm_contact_identities (contact_id, channel, account_id, external_id, username, display_name)
    values (v_contact, v_channel, v_scope, v_ext, v_username, v_name)
    returning * into v_identity;
  else
    v_contact := v_identity.contact_id;
    if v_identity.username is distinct from v_username or v_identity.display_name is distinct from v_name then
      update public.crm_contact_identities
         set username = coalesce(v_username, username),
             display_name = coalesce(v_name, display_name),
             updated_at = now()
       where id = v_identity.id;
    end if;
  end if;

  insert into public.crm_conversations (contact_id, account_id, identity_id, external_chat_id)
  values (v_contact, v_acc.id, v_identity.id, p_chat)
  on conflict (account_id, external_chat_id) do update set identity_id = excluded.identity_id
  returning id into v_conv;

  insert into public.crm_messages (conversation_id, direction, body, attachments, external_id, status, created_at)
  values (v_conv, 'in', nullif(p_message->>'body', ''),
          coalesce(p_message->'attachments', '[]'::jsonb),
          nullif(p_message->>'external_id', ''), 'received', v_at)
  on conflict (conversation_id, external_id) where external_id is not null do nothing
  returning id into v_msg;

  update public.crm_channel_accounts set last_event_at = now() where id = v_acc.id;

  if v_msg is null then
    return jsonb_build_object('duplicate', true, 'conversation_id', v_conv, 'contact_id', v_contact);
  end if;

  -- Нет открытой сделки — новое обращение в первом этапе воронки аккаунта.
  select d.id into v_deal from public.crm_deals d
   where d.contact_id = v_contact and d.closed_at is null
   order by d.created_at desc limit 1;
  if v_deal is null then
    v_pipeline := coalesce(
      (select p.id from public.crm_pipelines p where p.id = v_acc.pipeline_id and not p.is_archived),
      (select p.id from public.crm_pipelines p where not p.is_archived order by p.sort_order, p.created_at limit 1));
    select s.id into v_stage from public.crm_stages s
     where s.pipeline_id = v_pipeline and s.kind = 'open'
     order by s.sort_order, s.created_at limit 1;
    if v_stage is not null then
      insert into public.crm_deals (title, pipeline_id, stage_id, contact_id, studio_id, source)
      values ((select name from public.crm_contacts where id = v_contact), v_pipeline, v_stage,
              v_contact, v_acc.studio_id,
              case v_channel when 'telegram' then 'Telegram' when 'whatsapp' then 'WhatsApp'
                             when 'instagram' then 'Instagram' else 'Facebook' end)
      returning id into v_deal;
    end if;
  end if;

  return jsonb_build_object('duplicate', false, 'conversation_id', v_conv, 'message_id', v_msg,
                            'contact_id', v_contact, 'deal_id', v_deal);
end;
$$;
revoke all on function public.crm_ingest_message(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crm_ingest_message(uuid, text, jsonb, jsonb) to service_role;

-- «Прочитано»: сотрудник открыл диалог.
create or replace function public.crm_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.crm_conversations c
     where c.id = p_conversation
       and public.auth_crm_can_view()
       and (c.studio_id is null or c.studio_id = any (public.auth_crm_studio_ids()))) then
    return;
  end if;
  update public.crm_conversations set unread_count = 0
   where id = p_conversation and unread_count > 0;
end;
$$;
revoke all on function public.crm_conversation_read(uuid) from public, anon;
grant execute on function public.crm_conversation_read(uuid) to authenticated;
