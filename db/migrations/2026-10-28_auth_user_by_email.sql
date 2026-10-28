-- «Пользователи и роли» → «Добавить»: учётная запись по почте.
-- Сервер админки искал человека только в profiles.email. Если учётная
-- запись GoTrue с этой почтой есть, а профиля с ней нет (почта в профиле
-- пустая или старая, профиля нет), он пытался создать её заново, и GoTrue
-- отвечал «уже зарегистрирован», хотя в портале человека не видно.
-- Ищем в auth.users; только service_role (сервер после проверки прав).

create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from auth.users u
   where lower(trim(u.email)) = lower(trim(p_email))
   order by u.created_at
   limit 1
$$;

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;
