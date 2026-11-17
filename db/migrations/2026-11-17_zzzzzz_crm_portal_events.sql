-- CRM, связь с порталом (CRM.md): покупка абонемента закрывает сделку
-- «Успешно», события портала запускают правила этапа.
--
-- Сделка — открытая сделка контакта, привязанного к карточке клиента
-- (crm_contacts.client_id).
--   Продажа абонемента клиенту (не пробное, не разовое, не перенос, не
--   заливка из 1С) → сделка переходит в «Успешно реализовано» своей воронки,
--   crm_deals.sale_id — эта продажа, бюджет — сумма продажи.
--   Новые «когда» у правил этапа (crm_automations.trigger):
--     trial_sale — куплено пробное или разовое посещение;
--     booked     — клиента записали на занятие (или записался сам);
--     attended   — клиент посетил занятие.

alter table public.crm_deals
  add column if not exists sale_id uuid references public.sales(id) on delete set null;

alter table public.crm_automations drop constraint if exists crm_automations_trigger_check;
alter table public.crm_automations add constraint crm_automations_trigger_check
  check (trigger in ('enter', 'inbound', 'no_reply', 'trial_sale', 'booked', 'attended'));

-- Правила этапа по событию портала — всем открытым сделкам клиента.
create or replace function public.crm_portal_event(_client uuid, _trigger text, _event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.crm_deals;
  a public.crm_automations;
begin
  if _client is null then
    return;
  end if;
  for d in select dl.* from public.crm_deals dl
            join public.crm_contacts c on c.id = dl.contact_id
           where c.client_id = _client and dl.closed_at is null loop
    for a in select * from public.crm_automations
              where stage_id = d.stage_id and is_active and trigger = _trigger
              order by sort_order, created_at loop
      perform public.crm_automation_enqueue(a, d, _event, null);
    end loop;
  end loop;
end;
$$;
revoke all on function public.crm_portal_event(uuid, text, text) from public, anon, authenticated;

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
    perform public.crm_portal_event(new.client_id, 'trial_sale', 'sale:' || new.id::text);
    return null;
  end if;
  for d in select dl.* from public.crm_deals dl
            join public.crm_contacts c on c.id = dl.contact_id
           where c.client_id = new.client_id and dl.closed_at is null loop
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
drop trigger if exists crm_sales_ai on public.sales;
create trigger crm_sales_ai after insert on public.sales
  for each row execute function public.crm_sales_ai();

create or replace function public.crm_bookings_aiu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'booked' then
      perform public.crm_portal_event(new.client_id, 'booked', 'booked:' || new.id::text);
    end if;
  elsif new.status = 'attended' and old.status is distinct from 'attended' then
    perform public.crm_portal_event(new.client_id, 'attended', 'attended:' || new.id::text);
  elsif new.status = 'booked' and old.status = 'waitlist' then
    perform public.crm_portal_event(new.client_id, 'booked', 'booked:' || new.id::text);
  end if;
  return null;
end;
$$;
drop trigger if exists crm_bookings_aiu on public.schedule_bookings;
create trigger crm_bookings_aiu after insert or update of status on public.schedule_bookings
  for each row execute function public.crm_bookings_aiu();
