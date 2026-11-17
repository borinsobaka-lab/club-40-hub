-- CRM: источники заявок и сквозная аналитика (решение владельца 2026-11-19;
-- CRM.md, «Источники и сквозная воронка»).
--
-- Откуда пришла заявка:
--   crm_lead_forms — формы сайта: у формы свой адрес приёма
--     (/api/crm/lead/<token> сервера админки), название источника, воронка,
--     клуб (пусто — «Распределение заявок»). Заявку принимает
--     crm_lead_submit (service_role): контакт по телефону или почте,
--     сделка в первом этапе воронки с UTM-метками и страницей; у контакта
--     уже есть открытая сделка — заявка ложится в её ленту, второй сделки нет.
--   crm_links — ссылки и QR-коды с меткой: /l/<code> сервера админки ведёт в
--     WhatsApp (текст с «#код»), к Telegram-боту (?start=код) или на сайт
--     (с utm-метками), считает переходы (crm_link_click, service_role).
--     Первое сообщение с кодом ссылки — источник и кампания сделки
--     (crm_ingest_message — актуальное определение здесь).
--   crm_deals + utm_source / utm_medium / utm_campaign / utm_content /
--     utm_term, page_url, lead_form_id, link_id.
-- Путь сделки: crm_deals.first_reply_at (первый ответ сотрудника),
--   booked_at (клиента записали на занятие), attended_at (пришёл), trial_at
--   (куплено пробное или разовое) — ставят триггеры открытым сделкам клиента;
--   актуальные определения crm_sales_ai и crm_bookings_aiu — здесь.
-- Деньги: crm_ad_spend — расход на рекламу за месяц по источнику (кампании,
--   клубу), вносится вручную (crm.manage).
-- crm_funnel_report(p_from, p_to, p_group, p_pipeline) — сделки-заявки (не
--   сценарии), заведённые за период, по источнику / кампании / клубу /
--   ответственному: заявки → ответили → записаны → пришли → пробное →
--   купили, выручка первой покупки, выручка клиента за всё время после
--   заявки, расход (месячный — по дням периода).

-- 1) Формы, ссылки, расходы -----------------------------------------------------------
create table if not exists public.crm_lead_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  -- Источник сделки; пусто — название формы.
  source text check (source is null or char_length(source) <= 120),
  pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  studio_id uuid references public.studios(id) on delete set null,
  is_active boolean not null default true,
  leads_count integer not null default 0,
  last_lead_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.crm_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
    check (code ~ '^[a-z0-9]{4,16}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Источник и кампания сделки.
  source text not null check (char_length(btrim(source)) between 1 and 120),
  campaign text check (campaign is null or char_length(campaign) <= 200),
  target_kind text not null check (target_kind in ('whatsapp', 'telegram', 'url')),
  -- WhatsApp — номер, Telegram — ник бота, сайт — адрес https://.
  target text not null check (char_length(btrim(target)) between 1 and 1000),
  -- Текст, с которым откроется WhatsApp.
  text text check (text is null or char_length(text) <= 500),
  is_active boolean not null default true,
  clicks integer not null default 0,
  last_click_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint crm_links_url_check check (target_kind <> 'url' or target ~* '^https://')
);

create table if not exists public.crm_ad_spend (
  id uuid primary key default gen_random_uuid(),
  -- Первое число месяца.
  month date not null check (extract(day from month) = 1),
  source text not null check (char_length(btrim(source)) between 1 and 120),
  campaign text check (campaign is null or char_length(campaign) <= 200),
  studio_id uuid references public.studios(id) on delete set null,
  amount numeric(12, 2) not null check (amount >= 0),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists crm_ad_spend_month_idx on public.crm_ad_spend (month);

create or replace function public.crm_sources_biu()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'crm_ad_spend' then
    new.source := btrim(new.source);
    new.campaign := nullif(btrim(coalesce(new.campaign, '')), '');
    new.note := nullif(btrim(coalesce(new.note, '')), '');
  elsif tg_table_name = 'crm_links' then
    new.name := btrim(new.name);
    new.source := btrim(new.source);
    new.campaign := nullif(btrim(coalesce(new.campaign, '')), '');
    new.target := btrim(new.target);
    new.text := nullif(btrim(coalesce(new.text, '')), '');
    if tg_op = 'UPDATE' then
      new.code := old.code;
      if current_user in ('authenticated', 'anon') then
        new.clicks := old.clicks;
        new.last_click_at := old.last_click_at;
      end if;
    end if;
  else
    new.name := btrim(new.name);
    new.source := nullif(btrim(coalesce(new.source, '')), '');
    if tg_op = 'UPDATE' then
      new.token := old.token;
      if current_user in ('authenticated', 'anon') then
        new.leads_count := old.leads_count;
        new.last_lead_at := old.last_lead_at;
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_lead_forms_biu on public.crm_lead_forms;
create trigger crm_lead_forms_biu before insert or update on public.crm_lead_forms
  for each row execute function public.crm_sources_biu();
drop trigger if exists crm_links_biu on public.crm_links;
create trigger crm_links_biu before insert or update on public.crm_links
  for each row execute function public.crm_sources_biu();
drop trigger if exists crm_ad_spend_biu on public.crm_ad_spend;
create trigger crm_ad_spend_biu before insert or update on public.crm_ad_spend
  for each row execute function public.crm_sources_biu();

alter table public.crm_lead_forms enable row level security;
alter table public.crm_links enable row level security;
alter table public.crm_ad_spend enable row level security;
grant select, insert, update, delete on public.crm_lead_forms, public.crm_links, public.crm_ad_spend
  to authenticated, service_role;

-- Формы (с адресом приёма) и расходы — настройке; ссылки читает весь раздел.
drop policy if exists "crm_lead_forms manage" on public.crm_lead_forms;
create policy "crm_lead_forms manage" on public.crm_lead_forms for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));
drop policy if exists "crm_links read" on public.crm_links;
create policy "crm_links read" on public.crm_links for select to authenticated
  using ((select public.auth_crm_can_view()));
drop policy if exists "crm_links manage" on public.crm_links;
create policy "crm_links manage" on public.crm_links for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));
drop policy if exists "crm_ad_spend manage" on public.crm_ad_spend;
create policy "crm_ad_spend manage" on public.crm_ad_spend for all to authenticated
  using ((select public.auth_crm_can_manage())) with check ((select public.auth_crm_can_manage()));

-- 2) Сделка: метки и путь ---------------------------------------------------------------
alter table public.crm_deals
  add column if not exists utm_source text check (utm_source is null or char_length(utm_source) <= 200),
  add column if not exists utm_medium text check (utm_medium is null or char_length(utm_medium) <= 200),
  add column if not exists utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 200),
  add column if not exists utm_content text check (utm_content is null or char_length(utm_content) <= 200),
  add column if not exists utm_term text check (utm_term is null or char_length(utm_term) <= 200),
  add column if not exists page_url text check (page_url is null or char_length(page_url) <= 1000),
  add column if not exists lead_form_id uuid references public.crm_lead_forms(id) on delete set null,
  add column if not exists link_id uuid references public.crm_links(id) on delete set null,
  add column if not exists first_reply_at timestamptz,
  add column if not exists booked_at timestamptz,
  add column if not exists attended_at timestamptz,
  add column if not exists trial_at timestamptz;
create index if not exists crm_deals_created_idx on public.crm_deals (created_at);

-- Путь и привязку к форме или ссылке сотрудник не правит.
create or replace function public.crm_deals_path_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.first_reply_at := null; new.booked_at := null; new.attended_at := null; new.trial_at := null;
      new.lead_form_id := null; new.link_id := null;
    else
      new.first_reply_at := old.first_reply_at; new.booked_at := old.booked_at;
      new.attended_at := old.attended_at; new.trial_at := old.trial_at;
      new.lead_form_id := old.lead_form_id; new.link_id := old.link_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_deals_path_guard_biu on public.crm_deals;
create trigger crm_deals_path_guard_biu before insert or update on public.crm_deals
  for each row execute function public.crm_deals_path_guard();

-- Шаг пути — открытым сделкам клиента, один раз.
create or replace function public.crm_deal_milestone(_client uuid, _step text, _at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _client is null then
    return;
  end if;
  update public.crm_deals d
     set booked_at = case when _step = 'booked' then coalesce(d.booked_at, _at) else d.booked_at end,
         attended_at = case when _step = 'attended' then coalesce(d.attended_at, _at) else d.attended_at end,
         trial_at = case when _step = 'trial' then coalesce(d.trial_at, _at) else d.trial_at end
    from public.crm_contacts c
   where c.id = d.contact_id and c.client_id = _client and d.closed_at is null
     and case _step when 'booked' then d.booked_at is null
                    when 'attended' then d.attended_at is null
                    else d.trial_at is null end;
end;
$$;
revoke all on function public.crm_deal_milestone(uuid, text, timestamptz) from public, anon, authenticated;

-- Первый ответ сотрудника (не автоматический).
create or replace function public.crm_messages_first_reply_ai()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction = 'out' and not new.auto and new.status <> 'failed' then
    update public.crm_deals d set first_reply_at = new.created_at
      from public.crm_conversations c
     where c.id = new.conversation_id and d.contact_id = c.contact_id
       and d.closed_at is null and d.first_reply_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists crm_messages_first_reply_ai on public.crm_messages;
create trigger crm_messages_first_reply_ai after insert on public.crm_messages
  for each row execute function public.crm_messages_first_reply_ai();

create or replace function public.crm_sales_ai()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_name text;
  d public.crm_deals;
  v_won uuid;
begin
  if new.client_id is null or new.onec_ref is not null or new.carryover_ref is not null
     or new.sale_kind = 'carryover' then
    return null;
  end if;
  select kind, name into v_kind, v_name from public.memberships where id = new.membership_id;
  if v_kind in ('trial', 'single') then
    perform public.crm_deal_milestone(new.client_id, 'trial', now());
    perform public.crm_portal_event(new.client_id, 'trial_sale', 'sale:' || new.id::text);
    return null;
  end if;
  for d in select dl.* from public.crm_deals dl
            join public.crm_contacts c on c.id = dl.contact_id
           where c.client_id = new.client_id and dl.closed_at is null
             and dl.scenario is distinct from 'overdue_payment' loop
    select id into v_won from public.crm_stages where pipeline_id = d.pipeline_id and kind = 'won';
    if v_won is not null then
      update public.crm_deals
         set stage_id = v_won, sale_id = new.id, budget = coalesce(new.total_amount, budget)
       where id = d.id;
      perform public.crm_automation_note(
        d.id, 'Куплен абонемент' || coalesce(' «' || v_name || '»', '') || ' — сделка закрыта');
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.crm_bookings_aiu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'booked' then
      perform public.crm_deal_milestone(new.client_id, 'booked', now());
      perform public.crm_portal_event(new.client_id, 'booked', 'booked:' || new.id::text);
    end if;
  elsif new.status = 'attended' and old.status is distinct from 'attended' then
    perform public.crm_deal_milestone(new.client_id, 'booked', now());
    perform public.crm_deal_milestone(new.client_id, 'attended', now());
    perform public.crm_portal_event(new.client_id, 'attended', 'attended:' || new.id::text);
    perform public.crm_scenario_win(new.client_id, 'inactive', 'Клиент пришёл на занятие — сделка закрыта');
  elsif new.status = 'booked' and old.status = 'waitlist' then
    perform public.crm_deal_milestone(new.client_id, 'booked', now());
    perform public.crm_portal_event(new.client_id, 'booked', 'booked:' || new.id::text);
  end if;
  return null;
end;
$$;

-- 3) Переход по ссылке -------------------------------------------------------------------
create or replace function public.crm_link_click(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.crm_links;
begin
  update public.crm_links set clicks = clicks + 1, last_click_at = now()
   where code = lower(btrim(p_code)) and is_active
  returning * into v_link;
  if v_link.id is null then
    return null;
  end if;
  return jsonb_build_object('code', v_link.code, 'target_kind', v_link.target_kind, 'target', v_link.target,
                            'text', v_link.text, 'source', v_link.source, 'campaign', v_link.campaign);
end;
$$;
revoke all on function public.crm_link_click(text) from public, anon, authenticated;
grant execute on function public.crm_link_click(text) to service_role;

-- 4) Заявка с формы сайта -----------------------------------------------------------------
-- p_data: {name, phone, email, message, utm_source, utm_medium, utm_campaign,
-- utm_content, utm_term, page}. Ответ: {deal_id, contact_id, created}.
create or replace function public.crm_lead_submit(p_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.crm_lead_forms;
  v_name text := nullif(btrim(left(coalesce(p_data->>'name', ''), 200)), '');
  v_phone text := nullif(btrim(left(coalesce(p_data->>'phone', ''), 40)), '');
  v_email text := nullif(lower(btrim(left(coalesce(p_data->>'email', ''), 200))), '');
  v_message text := nullif(btrim(left(coalesce(p_data->>'message', ''), 4000)), '');
  v_page text := nullif(btrim(left(coalesce(p_data->>'page', ''), 1000)), '');
  v_key text;
  v_contact uuid;
  v_deal uuid;
  v_created boolean := false;
  v_pipeline uuid;
  v_stage uuid;
  v_studio uuid;
  v_dist_studio uuid;
  v_responsible uuid;
  v_distributed boolean := false;
  v_source text;
  v_note text;
begin
  select * into v_form from public.crm_lead_forms where token = p_token and is_active;
  if v_form.id is null then
    raise exception 'crm_form_not_found' using errcode = '23503';
  end if;
  v_key := public.client_phone_key(v_phone);
  if v_key is null and v_email is null then
    raise exception 'crm_lead_empty' using errcode = '22023';
  end if;
  v_source := coalesce(v_form.source, v_form.name);

  -- Две заявки одного человека подряд — не два контакта.
  perform pg_advisory_xact_lock(hashtextextended('lead:' || coalesce(v_key, v_email), 0));

  select c.id into v_contact from public.crm_contacts c
   where (v_key is not null and public.client_phone_key(c.phone) = v_key)
      or (v_email is not null and c.email = v_email)
   order by (v_key is not null and public.client_phone_key(c.phone) = v_key) desc, c.created_at
   limit 1;
  if v_contact is null then
    insert into public.crm_contacts (name, phone, email)
    values (coalesce(v_name, v_phone, v_email), v_phone, v_email)
    returning id into v_contact;
  end if;

  v_note := 'Заявка с формы «' || v_form.name || '»'
    || coalesce(E'\n' || v_message, '') || coalesce(E'\nСтраница: ' || v_page, '');

  select d.id into v_deal from public.crm_deals d
   where d.contact_id = v_contact and d.closed_at is null
   order by d.created_at desc limit 1;
  if v_deal is null then
    v_pipeline := coalesce(
      (select p.id from public.crm_pipelines p where p.id = v_form.pipeline_id and not p.is_archived),
      (select p.id from public.crm_pipelines p where not p.is_archived order by p.sort_order, p.created_at limit 1));
    select s.id into v_stage from public.crm_stages s
     where s.pipeline_id = v_pipeline and s.kind = 'open'
     order by s.sort_order, s.created_at limit 1;
    if v_stage is null then
      raise exception 'crm_pipeline_not_found' using errcode = '23503';
    end if;
    v_studio := v_form.studio_id;
    if v_studio is null and not exists (select 1 from public.crm_deals d where d.contact_id = v_contact) then
      select t.studio_id, t.responsible_id, t.distributed
        into v_dist_studio, v_responsible, v_distributed
        from public.crm_distribution_next() t;
      if v_distributed then
        v_studio := v_dist_studio;
      end if;
    end if;
    insert into public.crm_deals (title, pipeline_id, stage_id, contact_id, studio_id, responsible_id, source,
                                  utm_source, utm_medium, utm_campaign, utm_content, utm_term, page_url, lead_form_id)
    values ((select name from public.crm_contacts where id = v_contact), v_pipeline, v_stage, v_contact,
            v_studio, v_responsible, v_source,
            nullif(btrim(left(coalesce(p_data->>'utm_source', ''), 200)), ''),
            nullif(btrim(left(coalesce(p_data->>'utm_medium', ''), 200)), ''),
            nullif(btrim(left(coalesce(p_data->>'utm_campaign', ''), 200)), ''),
            nullif(btrim(left(coalesce(p_data->>'utm_content', ''), 200)), ''),
            nullif(btrim(left(coalesce(p_data->>'utm_term', ''), 200)), ''),
            v_page, v_form.id)
    returning id into v_deal;
    v_created := true;
  end if;
  perform public.crm_automation_note(v_deal, v_note);
  update public.crm_lead_forms set leads_count = leads_count + 1, last_lead_at = now() where id = v_form.id;
  return jsonb_build_object('deal_id', v_deal, 'contact_id', v_contact, 'created', v_created);
end;
$$;
revoke all on function public.crm_lead_submit(text, jsonb) from public, anon, authenticated;
grant execute on function public.crm_lead_submit(text, jsonb) to service_role;

-- 5) Входящее сообщение: + источник по коду ссылки -----------------------------------------
-- Как в 2026-11-18_zzz_crm_tasks_required_distribution.sql; новая сделка
-- получает источник и кампанию ссылки, если в сообщении её код
-- («#код» из текста WhatsApp или «/start код» у бота).
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
  v_studio uuid;
  v_dist_studio uuid;
  v_responsible uuid;
  v_distributed boolean := false;
  v_link public.crm_links;
  v_body text := coalesce(p_message->>'body', '');
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
      -- Человек пишет впервые (сделок у него ещё не было) — распределение
      -- новых заявок, если включено: клуб и ответственный по очереди или
      -- случайно; диалог переходит в тот же клуб — его сотрудники видят
      -- переписку. Иначе — клуб аккаунта, как прежде.
      v_studio := v_acc.studio_id;
      if not exists (select 1 from public.crm_deals d where d.contact_id = v_contact) then
        select t.studio_id, t.responsible_id, t.distributed
          into v_dist_studio, v_responsible, v_distributed
          from public.crm_distribution_next() t;
        if v_distributed then
          v_studio := v_dist_studio;
          update public.crm_conversations set studio_id = v_studio where id = v_conv;
        end if;
      end if;
      -- Пришёл по ссылке с меткой: её код — в первом сообщении.
      if v_body <> '' then
        select l.* into v_link from public.crm_links l
         where l.is_active
           and (lower(v_body) like '%#' || l.code || '%'
                or lower(btrim(v_body)) = '/start ' || l.code)
         order by l.created_at desc limit 1;
      end if;
      insert into public.crm_deals (title, pipeline_id, stage_id, contact_id, studio_id, responsible_id, source,
                                    utm_campaign, link_id)
      values ((select name from public.crm_contacts where id = v_contact), v_pipeline, v_stage,
              v_contact, v_studio, v_responsible,
              coalesce(v_link.source,
                case v_channel when 'telegram' then 'Telegram' when 'whatsapp' then 'WhatsApp'
                               when 'instagram' then 'Instagram' else 'Facebook' end),
              v_link.campaign, v_link.id)
      returning id into v_deal;
    end if;
  end if;

  return jsonb_build_object('duplicate', false, 'conversation_id', v_conv, 'message_id', v_msg,
                            'contact_id', v_contact, 'deal_id', v_deal);
end;
$$;
revoke all on function public.crm_ingest_message(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crm_ingest_message(uuid, text, jsonb, jsonb) to service_role;

-- 6) Сквозная воронка ------------------------------------------------------------------------
-- security definer: выручку клиента (sales) видят не все, кому открыт CRM;
-- сделки — только видимые вызывающему (как RLS crm_deals).
create or replace function public.crm_funnel_report(
  p_from date, p_to date, p_group text default 'source', p_pipeline uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_studios uuid[];
  v_out jsonb;
begin
  if not public.auth_crm_can_view() then
    raise exception 'crm_forbidden' using errcode = '42501';
  end if;
  if p_group not in ('source', 'campaign', 'studio', 'responsible') then
    raise exception 'crm_bad_group' using errcode = '22023';
  end if;
  v_studios := public.auth_crm_studio_ids();

  with d as (
    select dl.*, s.kind as stage_kind, c.client_id,
           case p_group
             when 'source' then lower(coalesce(dl.source, ''))
             when 'campaign' then lower(coalesce(dl.utm_campaign, ''))
             when 'studio' then coalesce(dl.studio_id::text, '')
             else coalesce(dl.responsible_id::text, '') end as gkey,
           case p_group
             when 'source' then coalesce(dl.source, 'Не указан')
             when 'campaign' then coalesce(dl.utm_campaign, 'Без кампании')
             when 'studio' then coalesce((select name from public.studios st where st.id = dl.studio_id), 'Без клуба')
             else coalesce(public.crm_profile_name(dl.responsible_id), 'Без ответственного') end as glabel
      from public.crm_deals dl
      join public.crm_stages s on s.id = dl.stage_id
      left join public.crm_contacts c on c.id = dl.contact_id
     where dl.scenario is null
       and (p_pipeline is null or dl.pipeline_id = p_pipeline)
       and (dl.studio_id is null or dl.studio_id = any (v_studios))
       and dl.created_at >= p_from::timestamptz and dl.created_at < (p_to + 1)::timestamptz
  ),
  ltv as (
    select d.id, coalesce(sum(sl.total_amount), 0) as amount
      from d
      join public.sales sl on sl.client_id = d.client_id
       and sl.created_at >= d.created_at
       and sl.onec_ref is null and sl.carryover_ref is null
       and sl.sale_kind is distinct from 'carryover'
     group by d.id
  ),
  agg as (
    select d.gkey, min(d.glabel) as label,
           count(*) as leads,
           count(*) filter (where d.first_reply_at is not null) as replied,
           count(*) filter (where d.booked_at is not null) as booked,
           count(*) filter (where d.attended_at is not null) as attended,
           count(*) filter (where d.trial_at is not null) as trial,
           count(*) filter (where d.stage_kind = 'won') as won,
           count(*) filter (where d.stage_kind = 'lost') as lost,
           coalesce(sum(d.budget) filter (where d.stage_kind = 'won'), 0) as revenue,
           coalesce(sum(l.amount), 0) as ltv
      from d left join ltv l on l.id = d.id
     group by d.gkey
  ),
  spend as (
    select case p_group
             when 'source' then lower(a.source)
             when 'campaign' then lower(coalesce(a.campaign, ''))
             when 'studio' then coalesce(a.studio_id::text, '') end as gkey,
           min(case p_group
             when 'source' then a.source
             when 'campaign' then coalesce(a.campaign, 'Без кампании')
             when 'studio' then coalesce((select name from public.studios st where st.id = a.studio_id), 'Без клуба')
           end) as label,
           -- Месячный расход — по дням, попавшим в период.
           sum(a.amount
               * greatest(0, least(p_to, (a.month + interval '1 month - 1 day')::date)
                             - greatest(p_from, a.month) + 1)
               / extract(day from a.month + interval '1 month - 1 day')) as amount
      from public.crm_ad_spend a
     where p_group <> 'responsible'
       and a.month <= p_to and (a.month + interval '1 month')::date > p_from
       and (a.studio_id is null or a.studio_id = any (v_studios))
     group by 1
  ),
  rows as (
    select coalesce(a.gkey, s.gkey) as gkey, coalesce(a.label, s.label) as label,
           coalesce(a.leads, 0) as leads, coalesce(a.replied, 0) as replied,
           coalesce(a.booked, 0) as booked, coalesce(a.attended, 0) as attended,
           coalesce(a.trial, 0) as trial, coalesce(a.won, 0) as won, coalesce(a.lost, 0) as lost,
           coalesce(a.revenue, 0) as revenue, coalesce(a.ltv, 0) as ltv,
           round(coalesce(s.amount, 0)::numeric, 2) as spend
      from agg a full join spend s on s.gkey = a.gkey
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.leads desc, r.spend desc, r.label) from rows r), '[]'::jsonb),
    'total', (select jsonb_build_object(
        'leads', coalesce(sum(leads), 0), 'replied', coalesce(sum(replied), 0),
        'booked', coalesce(sum(booked), 0), 'attended', coalesce(sum(attended), 0),
        'trial', coalesce(sum(trial), 0), 'won', coalesce(sum(won), 0), 'lost', coalesce(sum(lost), 0),
        'revenue', coalesce(sum(revenue), 0), 'ltv', coalesce(sum(ltv), 0),
        'spend', coalesce(sum(spend), 0)) from rows))
    into v_out;
  return v_out;
end;
$$;
revoke all on function public.crm_funnel_report(date, date, text, uuid) from public, anon;
grant execute on function public.crm_funnel_report(date, date, text, uuid) to authenticated;
