-- ============================================================================
-- Прогрессивная ставка: TRX и гамаки — по своей схеме сразу (замечание
-- владельца 2026-11-26: за TRX — 6 ₾ за человека, а считалось 4 ₾).
--
-- Схемы «TRX» и «Гамаки» заводились без тренировок («выберите тренировки
-- для TRX и гамаков»), и пока их не выбрали руками, занятия шли по схеме
-- «для остальных тренировок» (4 ₾). Теперь схеме без тренировок достаются
-- тренировки каталога с тем же словом в названии: «TRX» — название с «trx»,
-- «Гамаки» — с «гамак» / «hammock». Схемы, где тренировки уже выбраны, и
-- тренировки, уже стоящие в другой схеме тренера, не трогаются. Админка при
-- «Заполнить условиями студии» теперь подбирает их так же.
--
-- Идемпотентно. Выполняет мигратор при старте админки (db/migrate.ts).
-- ============================================================================

insert into public.trainer_pay_scheme_workouts (trainer_id, workout_id, scheme_id)
select sc.trainer_id, w.id, sc.id
  from public.trainer_pay_schemes sc
  join public.workouts w
    on (sc.name ilike '%trx%' and w.name ilike '%trx%')
    or (sc.name ilike '%гамак%' and (w.name ilike '%гамак%' or w.name ilike '%hammock%'))
  join public.studios s on s.id = w.studio_id and s.format = 'packages'
 where not sc.is_default
   and not exists (select 1 from public.trainer_pay_scheme_workouts x where x.scheme_id = sc.id)
on conflict (trainer_id, workout_id) do nothing;
