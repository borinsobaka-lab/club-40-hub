-- CRM: объединение дублей контактов (CRM.md, «одна карточка на человека»).
-- Автоматически контакты склеиваются при входящем (crm_ingest_message: id в
-- канале, ник Instagram, телефон); остальное — вручную из карточки сделки.
--
-- crm_contacts_merge(p_keep, p_merge) — всё от p_merge переходит к p_keep:
-- личности в каналах, диалоги, сделки; пустые телефон, почта и связь с
-- клиентом портала дополняются; p_merge удаляется. Любой с правом CRM, но
-- только если ему видны все сделки и диалоги обоих контактов (иначе
-- объединение увело бы чужое из-под чужого клуба молча).
-- crm_contact_search(p_query) — поиск контакта для объединения.

create or replace function public.crm_contacts_merge(p_keep uuid, p_merge uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.crm_contacts;
  m public.crm_contacts;
  v_studios uuid[] := public.auth_crm_studio_ids();
begin
  if not public.auth_crm_can_view() then
    raise exception 'crm_forbidden' using errcode = '42501';
  end if;
  if p_keep = p_merge then
    raise exception using errcode = '22023', message = 'Это один и тот же контакт';
  end if;
  -- Порядок блокировки — по id: два встречных объединения не зависнут.
  perform 1 from public.crm_contacts where id in (p_keep, p_merge) order by id for update;
  select * into k from public.crm_contacts where id = p_keep;
  select * into m from public.crm_contacts where id = p_merge;
  if k.id is null or m.id is null then
    raise exception using errcode = '23503', message = 'Контакт не найден';
  end if;
  if exists (select 1 from public.crm_deals d
              where d.contact_id in (p_keep, p_merge)
                and d.studio_id is not null and not (d.studio_id = any (v_studios)))
     or exists (select 1 from public.crm_conversations c
                 where c.contact_id in (p_keep, p_merge)
                   and c.studio_id is not null and not (c.studio_id = any (v_studios))) then
    raise exception using errcode = '42501',
      message = 'У контакта есть сделки или диалоги другого клуба — объединить может сотрудник с доступом к ним';
  end if;
  if k.client_id is not null and m.client_id is not null and k.client_id <> m.client_id then
    raise exception using errcode = '23514',
      message = 'Контакты привязаны к разным клиентам клуба — сначала отвяжите одного';
  end if;

  update public.crm_contact_identities set contact_id = p_keep where contact_id = p_merge;
  update public.crm_conversations set contact_id = p_keep where contact_id = p_merge;
  update public.crm_deals set contact_id = p_keep where contact_id = p_merge;
  delete from public.crm_contacts where id = p_merge;
  update public.crm_contacts
     set phone = coalesce(phone, m.phone),
         email = coalesce(email, m.email),
         client_id = coalesce(client_id, m.client_id)
   where id = p_keep;
end;
$$;
revoke all on function public.crm_contacts_merge(uuid, uuid) from public, anon;
grant execute on function public.crm_contacts_merge(uuid, uuid) to authenticated;

create or replace function public.crm_contact_search(p_query text, p_exclude uuid default null)
returns table (id uuid, name text, phone text, email text, channels text[], deals integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
begin
  if not public.auth_crm_can_view() or char_length(v_q) < 2 then
    return;
  end if;
  return query
  select c.id, c.name, c.phone, c.email,
         coalesce((select array_agg(distinct i.channel) from public.crm_contact_identities i
                    where i.contact_id = c.id), '{}'),
         (select count(*)::int from public.crm_deals d where d.contact_id = c.id)
    from public.crm_contacts c
   where c.id is distinct from p_exclude
     and (lower(c.name) like '%' || v_q || '%'
          or lower(coalesce(c.email, '')) like '%' || v_q || '%'
          or (char_length(v_digits) >= 3
              and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || v_digits || '%')
          or exists (select 1 from public.crm_contact_identities i
                      where i.contact_id = c.id and lower(i.username) like '%' || ltrim(v_q, '@') || '%'))
   order by c.updated_at desc
   limit 20;
end;
$$;
revoke all on function public.crm_contact_search(text, uuid) from public, anon;
grant execute on function public.crm_contact_search(text, uuid) to authenticated;
