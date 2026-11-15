-- Тренер в приложении: кто сегодня администратор в студии (решение владельца
-- 2026-11-15). На главной пакетного приложения тренеру под плашкой выбранной
-- студии — администратор из «Графика» (admin_shifts) этой студии на сегодня по
-- Тбилиси; нажатие открывает его Telegram (trainers.telegram — ник или ссылка).
--
-- admin_shifts читают только сотрудники с разделом «Сотрудники», а тренер в
-- приложении — клиент: RPC security definer. Отвечает только тренеру
-- (app_trainer_of) и только про пакетную студию; отдаёт имя, фото, Telegram
-- сегодняшних сменщиков — смены других дней нет. Не тренер — пусто.

create or replace function public.trainer_studio_admins_today(p_studio uuid)
returns table (trainer_id uuid, full_name text, photo_url text, telegram text, translations jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.full_name, t.photo_url, nullif(btrim(t.telegram), ''), t.translations
    from public.admin_shifts s
    join public.trainers t on t.id = s.trainer_id
    join public.studios st on st.id = s.studio_id and st.format = 'packages'
   where s.studio_id = p_studio
     and s.shift_date = public.workday_today()
     and public.app_trainer_of(auth.uid()) is not null
   order by t.full_name, t.id
$$;

revoke all on function public.trainer_studio_admins_today(uuid) from public, anon;
grant execute on function public.trainer_studio_admins_today(uuid) to authenticated, service_role;
