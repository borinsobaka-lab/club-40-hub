-- ============================================================================
-- Пакетные студии: продление встаёт в очередь, тренировки списываются при
-- записи; способ оплаты у платежей рассрочки (решение владельца 2026-10-11).
--
-- 1. Продление (sales.sale_kind = 'renewal') больше не заменяет действующий
--    абонемент: новый абонемент клиента создаётся со статусом pending («ждёт
--    начала») и флагом starts_on_first_visit — без даты начала и конца. Срок
--    пойдёт с первого посещения по нему (дата занятия по Тбилиси).
--    Остальные продажи — как раньше (activate_membership_from_sale заменяет
--    действующий абонемент).
-- 2. Списание (только пакетные студии, групповые и персональные занятия):
--    запись клиента (booked / attended / no_show) списывает одну тренировку,
--    отмена или лист ожидания — возвращает. С какого абонемента:
--    сначала текущий (active), пока на дату занятия он не истёк и на нём есть
--    тренировки, потом — ждущие по порядку продажи. Абонемент записи —
--    schedule_bookings.client_membership_id. Записи, сделанные до этой
--    миграции, не списываются задним числом.
-- 3. Очередь (packages_settle): текущий закончился (тренировки или срок) и
--    есть ждущий — текущий становится expired, ждущий — active. Нет текущего —
--    ждущий сразу active (тренировки с него можно списывать). Вернули
--    тренировку на исчерпанный текущий, а продление ещё ни разу не
--    использовано — продление обратно ждёт, прежний снова active.
--    Срок вышел без записей — переход случится при следующей записи клиента
--    или при вызове RPC packages_settle_my_memberships (клиентское
--    приложение) / packages_settle_studio (раздел «Абонементы» админки).
-- 4. sale_installments.payment_method — способ оплаты внесённого платежа
--    (как sales.payment_method / other_sales.payment_method). Первому
--    платежу рассрочки — способ оплаты продажи. Вью client_packages_list
--    отдаёт способ в платежах и дату начала абонемента.
--
-- Совместимо с подписочным форматом: списание и очередь — только в студиях
-- format = 'packages', новые колонки с умолчаниями, started_at стал
-- необязательным (у прежних строк он заполнен). Идемпотентно.
-- ============================================================================

-- 1. Схема -----------------------------------------------------------------

alter table public.client_memberships
  add column if not exists starts_on_first_visit boolean not null default false;
alter table public.client_memberships alter column started_at drop not null;

comment on column public.client_memberships.starts_on_first_visit is
  'Пакетный формат: продление — срок (started_at/ends_at) считается от первого посещения по абонементу.';

-- pending — продление ждёт, пока закончится текущий. not valid: старые строки
-- не перепроверяем (в живой базе могли остаться статусы старых версий).
alter table public.client_memberships drop constraint if exists client_memberships_status_check;
alter table public.client_memberships add constraint client_memberships_status_check
  check (status in ('active', 'frozen', 'pending', 'replaced', 'expired', 'cancelled')) not valid;

alter table public.schedule_bookings
  add column if not exists client_membership_id uuid
    references public.client_memberships(id) on delete set null;
create index if not exists schedule_bookings_client_membership_idx
  on public.schedule_bookings(client_membership_id) where client_membership_id is not null;

comment on column public.schedule_bookings.client_membership_id is
  'Пакетный формат: абонемент, с которого списана тренировка за эту запись (null — не списывалась).';

alter table public.sale_installments
  add column if not exists payment_method public.payment_method;

comment on column public.sale_installments.payment_method is
  'Способ оплаты внесённого платежа (наличные / карта / перевод / приложение).';

-- Разово: первый (внесённый в день продажи) платёж — способом оплаты продажи.
update public.sale_installments i
   set payment_method = s.payment_method
  from public.sales s
 where s.id = i.sale_id
   and i.payment_method is null
   and i.paid
   and i.due_date = s.sold_at
   and s.payment_method is not null;

-- 2. Очередь абонементов клиента -------------------------------------------

create or replace function public.packages_settle(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Tbilisi')::date;
  v_live public.client_memberships%rowtype;
  v_old public.client_memberships%rowtype;
begin
  if p_client_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.clients c
      join public.studios st on st.id = c.studio_id and st.format = 'packages'
     where c.id = p_client_id
  ) then
    return;
  end if;

  select * into v_live from public.client_memberships
   where client_id = p_client_id and status in ('active', 'frozen')
   limit 1;

  -- Вернули тренировку на исчерпанный прежний абонемент, а продление ещё не
  -- начато — прежний снова текущий, продление снова ждёт.
  if found and v_live.status = 'active' and v_live.starts_on_first_visit
     and v_live.started_at is null then
    select * into v_old from public.client_memberships
     where client_id = p_client_id
       and status = 'expired'
       and id <> v_live.id
       and started_at is not null
       and (visits_left is null or visits_left > 0)
       and (ends_at is null or ends_at >= v_today)
     order by created_at desc
     limit 1;
    if found then
      update public.client_memberships set status = 'pending' where id = v_live.id;
      update public.client_memberships set status = 'active' where id = v_old.id;
      v_live := v_old;
      v_live.status := 'active';
    end if;
  end if;

  -- Текущий закончился, а продление ждёт — текущий истёк.
  if v_live.id is not null and v_live.status = 'active'
     and ((v_live.visits_left is not null and v_live.visits_left <= 0)
          or (v_live.ends_at is not null and v_live.ends_at < v_today))
     and exists (
       select 1 from public.client_memberships
        where client_id = p_client_id and status = 'pending'
     ) then
    update public.client_memberships set status = 'expired' where id = v_live.id;
    v_live := null;
  end if;

  -- Текущего нет — ждущий (самый ранний по продаже) становится текущим.
  if v_live.id is null then
    update public.client_memberships
       set status = 'active'
     where id = (
       select id from public.client_memberships
        where client_id = p_client_id and status = 'pending'
        order by created_at
        limit 1
     );
  end if;
end;
$$;

revoke all on function public.packages_settle(uuid) from public, anon, authenticated;

-- 3. Списание и возврат тренировки -----------------------------------------

-- Списать тренировку за занятие p_date: текущий абонемент, пока он годен на
-- дату занятия и на нём есть тренировки, иначе ждущие по порядку продажи.
-- Возвращает абонемент или null (подходящего нет — запись без списания).
create or replace function public.packages_charge_visit(p_client_id uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_start date;
begin
  for r in
    select cm.id, cm.visits_left, cm.started_at, cm.ends_at, cm.starts_on_first_visit,
           m.duration_days
      from public.client_memberships cm
      left join public.memberships m on m.id = cm.membership_id
     where cm.client_id = p_client_id
       and cm.status in ('active', 'pending')
     order by (cm.status = 'active') desc, cm.created_at
  loop
    continue when r.visits_left is not null and r.visits_left <= 0;
    if r.starts_on_first_visit then
      -- Срок от первого посещения: занятие раньше уже начатого срока сдвигает
      -- начало назад; позже конца срока — абонемент уже не подходит.
      v_start := least(coalesce(r.started_at, p_date), p_date);
      continue when r.started_at is not null and r.ends_at is not null and p_date > r.ends_at;
      update public.client_memberships
         set visits_left = case when visits_left is null then null else visits_left - 1 end,
             started_at = v_start,
             ends_at = case when r.duration_days is null then null
                            else v_start + r.duration_days end
       where id = r.id;
    else
      continue when r.ends_at is not null and p_date > r.ends_at;
      update public.client_memberships
         set visits_left = case when visits_left is null then null else visits_left - 1 end
       where id = r.id;
    end if;
    return r.id;
  end loop;
  return null;
end;
$$;

revoke all on function public.packages_charge_visit(uuid, date) from public, anon, authenticated;

-- Вернуть тренировку за запись p_booking_id на абонемент p_cm_id. У продления
-- срок пересчитывается от первого из оставшихся посещений (нет их — срок
-- снова «с первого посещения»).
create or replace function public.packages_refund_visit(p_cm_id uuid, p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cm public.client_memberships%rowtype;
  v_first date;
  v_days int;
begin
  select * into v_cm from public.client_memberships where id = p_cm_id;
  if not found then
    return;
  end if;
  update public.client_memberships
     set visits_left = case when visits_left is null then null else visits_left + 1 end
   where id = p_cm_id;
  if v_cm.starts_on_first_visit then
    select min((se.starts_at at time zone 'Asia/Tbilisi')::date) into v_first
      from public.schedule_bookings b
      join public.schedule_entries se on se.id = b.entry_id
     where b.client_membership_id = p_cm_id
       and b.id <> p_booking_id
       and b.status in ('booked', 'attended', 'no_show');
    select m.duration_days into v_days from public.memberships m where m.id = v_cm.membership_id;
    update public.client_memberships
       set started_at = v_first,
           ends_at = case when v_first is null or v_days is null then null else v_first + v_days end
     where id = p_cm_id;
  end if;
end;
$$;

revoke all on function public.packages_refund_visit(uuid, uuid) from public, anon, authenticated;

-- Триггер записи. Имя — после schedule_bookings_link_person_biu (триггеры
-- одного события идут по имени): к этому моменту client_id уже заполнен.
create or replace function public.schedule_bookings_packages_visits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_date date;
  v_counts boolean;
begin
  if not exists (
    select 1 from public.studios where id = new.studio_id and format = 'packages'
  ) then
    return new;
  end if;

  select se.kind, (se.starts_at at time zone 'Asia/Tbilisi')::date
    into v_kind, v_date
    from public.schedule_entries se where se.id = new.entry_id;

  v_counts := new.status in ('booked', 'attended', 'no_show')
              and coalesce(v_kind, 'group') in ('group', 'personal')
              and new.client_id is not null;

  -- Была списана, а теперь не должна (отмена, лист ожидания, другой клиент).
  if tg_op = 'UPDATE' and old.client_membership_id is not null
     and (not v_counts or new.client_id is distinct from old.client_id) then
    perform public.packages_refund_visit(old.client_membership_id, old.id);
    new.client_membership_id := null;
    perform public.packages_settle(old.client_id);
  end if;

  if v_counts and new.client_membership_id is null then
    new.client_membership_id := public.packages_charge_visit(new.client_id, v_date);
    perform public.packages_settle(new.client_id);
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_bookings_packages_visits_biu on public.schedule_bookings;
create trigger schedule_bookings_packages_visits_biu
  before insert or update of status, client_id, entry_id on public.schedule_bookings
  for each row execute function public.schedule_bookings_packages_visits();

create or replace function public.schedule_bookings_packages_visits_del()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.client_membership_id is not null then
    perform public.packages_refund_visit(old.client_membership_id, old.id);
    perform public.packages_settle(old.client_id);
  end if;
  return old;
end;
$$;

drop trigger if exists schedule_bookings_packages_visits_ad on public.schedule_bookings;
create trigger schedule_bookings_packages_visits_ad
  after delete on public.schedule_bookings
  for each row execute function public.schedule_bookings_packages_visits_del();

-- 4. Продажа: продление встаёт в очередь -----------------------------------
-- Тело — как в db/membership_freeze.sql (последняя версия), плюс ветка
-- продления пакетной студии.

create or replace function public.activate_membership_from_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  computed_ends date;
begin
  select duration_days, visits_count, auto_renew
    into m
    from public.memberships
    where id = new.membership_id;

  if new.sale_kind = 'renewal' and exists (
    select 1 from public.studios st where st.id = new.studio_id and st.format = 'packages'
  ) then
    insert into public.client_memberships (
      studio_id, client_id, membership_id, sale_id, source,
      started_at, ends_at, visits_left, status, auto_renew, starts_on_first_visit
    ) values (
      new.studio_id, new.client_id, new.membership_id, new.id,
      coalesce(new.source, 'admin'),
      null, null, m.visits_count, 'pending', false, true
    );
    perform public.packages_settle(new.client_id);
    return new;
  end if;

  update public.client_memberships
     set status = 'replaced'
   where client_id = new.client_id and status in ('active','frozen');

  computed_ends := case
    when m.duration_days is not null
      then (new.sold_at + (m.duration_days || ' days')::interval)::date
    else null
  end;

  insert into public.client_memberships (
    studio_id, client_id, membership_id, sale_id, source,
    started_at, ends_at, visits_left, status, auto_renew
  ) values (
    new.studio_id, new.client_id, new.membership_id, new.id,
    coalesce(new.source, 'admin'),
    new.sold_at, computed_ends, m.visits_count, 'active',
    coalesce(m.auto_renew, false)
  );

  return new;
end
$$;

-- 5. RPC: досчитать очередь (срок текущего вышел без записей) ---------------

create or replace function public.packages_settle_my_memberships()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
begin
  for v_client in
    select c.id from public.clients c where c.user_id = auth.uid()
  loop
    perform public.packages_settle(v_client);
  end loop;
end;
$$;

revoke all on function public.packages_settle_my_memberships() from public, anon;
grant execute on function public.packages_settle_my_memberships() to authenticated;

create or replace function public.packages_settle_studio(p_studio_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
begin
  if not public.is_trainer(auth.uid(), p_studio_id) then
    raise exception 'forbidden';
  end if;
  for v_client in
    select distinct cm.client_id from public.client_memberships cm
     where cm.studio_id = p_studio_id and cm.status = 'pending'
  loop
    perform public.packages_settle(v_client);
  end loop;
end;
$$;

revoke all on function public.packages_settle_studio(uuid) from public, anon;
grant execute on function public.packages_settle_studio(uuid) to authenticated;

-- 6. Вью раздела «Абонементы»: способ оплаты платежей, начало абонемента -----
-- Определение — как в 2026-10-11_packages_client_memberships.sql, плюс
-- payment_method в платежах и две колонки в конце.

drop view if exists public.client_packages_list;
create view public.client_packages_list
with (security_invoker = true) as
select
  s.id,
  s.studio_id,
  s.client_id,
  s.membership_id,
  s.admin_name,
  s.trainer_id,
  s.trainer_name,
  s.sold_at,
  s.total_amount,
  s.sale_kind,
  s.comment,
  s.membership_note,
  s.created_at,
  coalesce(cl.last_name, '') || ' ' ||
  coalesce(cl.first_name, '') || ' ' ||
  coalesce(cl.full_name, '') || ' ' ||
  coalesce(cl.phone, '') || ' ' ||
  coalesce(m.name, '') || ' ' ||
  coalesce(s.trainer_name, '') || ' ' ||
  coalesce(s.admin_name, '') as search_text,
  case
    when cl.id is null then null
    else json_build_object(
      'id', cl.id,
      'full_name', cl.full_name,
      'first_name', cl.first_name,
      'last_name', cl.last_name,
      'phone', cl.phone
    )
  end as clients,
  case
    when m.id is null then null
    else json_build_object(
      'id', m.id,
      'name', m.name,
      'kind', m.kind,
      'visits_count', m.visits_count
    )
  end as memberships,
  cm.status as membership_status,
  cm.visits_left,
  cm.ends_at,
  pay.payments,
  pay.paid_amount,
  pay.next_due_date,
  case
    when pay.unpaid_count = 0 then 'paid'
    when pay.next_due_date < (now() at time zone 'Asia/Tbilisi')::date then 'overdue'
    else 'pending'
  end as payment_state,
  cm.started_at as membership_started_at,
  coalesce(cm.starts_on_first_visit, false) as starts_on_first_visit
from public.sales s
join public.studios st on st.id = s.studio_id and st.format = 'packages'
left join public.clients cl on cl.id = s.client_id
left join public.memberships m on m.id = s.membership_id
left join lateral (
  select c.status, c.visits_left, c.ends_at, c.started_at, c.starts_on_first_visit
    from public.client_memberships c
   where c.sale_id = s.id
   order by c.created_at desc
   limit 1
) cm on true
cross join lateral (
  select
    case
      when count(i.id) = 0 then json_build_array(json_build_object(
        'id', null,
        'amount', s.total_amount,
        'due_date', s.sold_at,
        'paid', true,
        'paid_at', s.sold_at,
        'payment_method', s.payment_method
      ))
      else json_agg(json_build_object(
        'id', i.id,
        'amount', i.amount,
        'due_date', i.due_date,
        'paid', i.paid,
        'paid_at', i.paid_at,
        'payment_method', i.payment_method
      ) order by i.due_date, i.created_at)
    end as payments,
    case
      when count(i.id) = 0 then s.total_amount
      else coalesce(sum(i.amount) filter (where i.paid), 0)
    end as paid_amount,
    min(i.due_date) filter (where not i.paid) as next_due_date,
    count(i.id) filter (where not i.paid) as unpaid_count
  from public.sale_installments i
  where i.sale_id = s.id
) pay;

grant select on public.client_packages_list to authenticated;

notify pgrst, 'reload schema';
