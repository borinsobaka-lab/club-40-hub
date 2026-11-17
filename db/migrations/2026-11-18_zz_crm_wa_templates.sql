-- CRM: шаблоны WhatsApp и «написать первым» (решение владельца 2026-11-18;
-- CRM.md, «Каналы»). В WhatsApp вне 24 часов после сообщения клиента (и
-- первым) можно отправить только шаблон, одобренный Meta.
--
--   crm_channel_accounts.waba_id — id аккаунта WhatsApp Business: шаблоны
--     принадлежат ему (Graph API: /{waba-id}/message_templates).
--   crm_wa_templates — шаблоны аккаунта: имя (латиница), язык, категория
--     (MARKETING / UTILITY), текст с {{1}}, {{2}}…, vars — что подставлять в
--     каждую переменную ('name' — имя контакта, 'studio' — клуб, 'text' —
--     вводит сотрудник), status — как у Meta (PENDING / APPROVED / REJECTED /
--     PAUSED / DISABLED…), причина отказа. Пишет только сервер (заявка
--     уходит в Meta его токеном); читают все с правом CRM.
--   crm_messages.template_id — сообщение отправлено шаблоном.
--   crm_conversation_start (service_role) — диалог для исходящего первым:
--     контакт по id в канале, по карточке клиента, по телефону или новый.

alter table public.crm_channel_accounts add column if not exists waba_id text;

create table if not exists public.crm_wa_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_channel_accounts(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512),
  language text not null check (char_length(language) between 2 and 10),
  category text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  body text not null check (char_length(body) between 1 and 1024),
  footer text check (footer is null or char_length(footer) <= 60),
  vars text[] not null default '{}',
  status text not null default 'PENDING',
  rejected_reason text,
  meta_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz,
  unique (account_id, name, language)
);
create index if not exists crm_wa_templates_meta_idx on public.crm_wa_templates (meta_id);

alter table public.crm_wa_templates enable row level security;
grant select on public.crm_wa_templates to authenticated;
grant select, insert, update, delete on public.crm_wa_templates to service_role;
drop policy if exists "crm_wa_templates read" on public.crm_wa_templates;
create policy "crm_wa_templates read" on public.crm_wa_templates for select to authenticated
  using ((select public.auth_crm_can_view()));

alter table public.crm_messages
  add column if not exists template_id uuid references public.crm_wa_templates(id) on delete set null;

-- Диалог для сообщения, которое мы пишем первыми. p_chat — id собеседника в
-- канале (WhatsApp — номер цифрами).
create or replace function public.crm_conversation_start(
  p_account uuid, p_chat text, p_name text, p_phone text, p_client uuid default null
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
  v_chat text := nullif(btrim(coalesce(p_chat, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_identity public.crm_contact_identities;
  v_contact uuid;
  v_conv uuid;
begin
  select * into v_acc from public.crm_channel_accounts where id = p_account;
  if v_acc.id is null or v_acc.status = 'disabled' or v_chat is null then
    raise exception 'crm_account_not_found' using errcode = '23503';
  end if;
  v_channel := public.crm_channel_of(v_acc.kind);
  v_scope := case when v_channel in ('instagram', 'facebook') then v_acc.id end;
  perform pg_advisory_xact_lock(hashtextextended(v_channel || ':' || v_chat, 0));

  select * into v_identity from public.crm_contact_identities i
   where i.channel = v_channel and i.external_id = v_chat
     and i.account_id is not distinct from v_scope;
  if v_identity.id is null then
    if p_client is not null then
      select c.id into v_contact from public.crm_contacts c
       where c.client_id = p_client order by c.created_at limit 1;
    end if;
    if v_contact is null and public.client_phone_key(v_phone) is not null then
      select c.id into v_contact from public.crm_contacts c
       where public.client_phone_key(c.phone) = public.client_phone_key(v_phone)
       order by c.created_at limit 1;
    end if;
    if v_contact is null then
      insert into public.crm_contacts (name, phone, client_id)
      values (coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Без имени'), v_phone, p_client)
      returning id into v_contact;
    end if;
    insert into public.crm_contact_identities (contact_id, channel, account_id, external_id, display_name)
    values (v_contact, v_channel, v_scope, v_chat, nullif(btrim(coalesce(p_name, '')), ''))
    returning * into v_identity;
  else
    v_contact := v_identity.contact_id;
  end if;

  insert into public.crm_conversations (contact_id, account_id, identity_id, external_chat_id)
  values (v_contact, v_acc.id, v_identity.id, v_chat)
  on conflict (account_id, external_chat_id) do update set identity_id = excluded.identity_id
  returning id into v_conv;
  return jsonb_build_object('conversation_id', v_conv, 'contact_id', v_contact);
end;
$$;
revoke all on function public.crm_conversation_start(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.crm_conversation_start(uuid, text, text, text, uuid) to service_role;
