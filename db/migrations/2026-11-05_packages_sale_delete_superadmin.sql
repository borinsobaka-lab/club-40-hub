-- Удаление абонемента в «Абонементах» пакетных клубов — только
-- суперадминистратору (решение владельца 2026-11-05).
--
-- Строка «Абонементов» — продажа (`sales`); удаление продажи удаляет и
-- выданный по ней абонемент (2026-10-11_zzzzzz_sale_membership_delete.sql).
-- Прежде удалить мог любой сотрудник клуба продажи («sales studio rw»).
-- Теперь в пакетном клубе DELETE из браузера проходит только у:
--   * суперадминистратора — сетевое право `portal.admin`;
--   * человека вне модели прав (нет строки `access_user_rights`) — владельца
--     клуба продажи: по прежним правилам он администратор сети, как и в
--     интерфейсе (`useAdminAccess`, legacyOwner);
--   * того, кто внёс продажу, в первые 15 минут — форма продажи откатывает
--     продажу, если не записался график платежей (`sale-dialog.tsx`).
-- Подписочные клубы («Продажи») — как были.
--
-- Ограничивающая (restrictive) политика: складывается по И с разрешающими.
-- Каскады по внешним ключам (удаление клиента, клуба) и функции владельца
-- базы (перенос из 1С, слияние дублей) RLS не проходят — их это не трогает.

drop policy if exists "sales packages delete superadmin" on public.sales;
create policy "sales packages delete superadmin" on public.sales
  as restrictive
  for delete to authenticated
  using (
    not exists (
      select 1 from public.studios st
       where st.id = sales.studio_id and st.format = 'packages')
    or 'portal.admin' = any ((select public.auth_access_rights())::text[])
    or (not (select public.access_is_managed(auth.uid()))
        and studio_id = any ((select public.auth_owner_studio_ids())::uuid[]))
    or (admin_id = (select auth.uid()) and created_at > now() - interval '15 minutes')
  );
