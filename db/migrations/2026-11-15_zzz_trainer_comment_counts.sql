-- ============================================================================
-- Число опубликованных комментариев клиентов о тренерах — для списка
-- «Тренеры» / «Массажисты» пакетного приложения (решение владельца
-- 2026-11-15): в скобках у звёзд — число оценок, строкой ниже — «N отзывов
-- клиентов» (текстовые отзывы, client_trainer_comments со status approved).
--
-- Одним вызовом на список: client_trainer_comment_counts(ids) — тренер и
-- число опубликованных. Право то же, что у client_trainer_comments_published:
-- сотрудник или клиент, который видит тренера (client_can_rate_trainer);
-- остальные тренеры в ответ не попадают. До 200 id за вызов.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

create or replace function public.client_trainer_comment_counts(_trainer_ids uuid[])
returns table (trainer_id uuid, comments_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, (
           select count(*)::int
             from public.client_trainer_comments c
            where c.trainer_id = t.id
              and c.status = 'approved'
         )
    from (select distinct unnest(_trainer_ids[1:200]) as id) t
   where public.is_staff(auth.uid()) or public.client_can_rate_trainer(t.id)
$$;

revoke all on function public.client_trainer_comment_counts(uuid[]) from public, anon;
grant execute on function public.client_trainer_comment_counts(uuid[]) to authenticated;
