
-- RPC: возвращает персональную статистику клиента по факту проведённых (прошедших) бронирований со статусом 'booked'.
CREATE OR REPLACE FUNCTION public.get_my_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_total int := 0;
  v_this_month int := 0;
  v_best_month int := 0;
  v_streak int := 0;
  v_cohort int := 0;
  v_percentile numeric := NULL;
  v_sparkline jsonb := '[]'::jsonb;
  v_by_type jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  -- База: прошедшие "booked" записи пользователя
  WITH my_visits AS (
    SELECT se.starts_at, w.type
    FROM public.schedule_bookings sb
    JOIN public.schedule_entries se ON se.id = sb.entry_id
    LEFT JOIN public.workouts w ON w.id = se.workout_id
    WHERE sb.user_id = v_user
      AND sb.status = 'booked'
      AND se.starts_at <= now()
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE date_trunc('month', starts_at) = date_trunc('month', now()))::int
  INTO v_total, v_this_month
  FROM my_visits;

  -- Лучший месяц (макс. число тренировок за один календарный месяц)
  SELECT COALESCE(MAX(cnt), 0)::int INTO v_best_month FROM (
    SELECT COUNT(*) AS cnt
    FROM public.schedule_bookings sb
    JOIN public.schedule_entries se ON se.id = sb.entry_id
    WHERE sb.user_id = v_user AND sb.status = 'booked' AND se.starts_at <= now()
    GROUP BY date_trunc('month', se.starts_at)
  ) m;

  -- Недельный стрик: подряд идущие недели с >=1 тренировкой, заканчивая текущей или прошлой неделей
  WITH weeks AS (
    SELECT DISTINCT date_trunc('week', se.starts_at)::date AS wk
    FROM public.schedule_bookings sb
    JOIN public.schedule_entries se ON se.id = sb.entry_id
    WHERE sb.user_id = v_user AND sb.status = 'booked' AND se.starts_at <= now()
  ),
  series AS (
    SELECT generate_series(0, 520) AS i
  ),
  back AS (
    SELECT i,
           (date_trunc('week', now())::date - (i * 7)) AS wk,
           EXISTS (SELECT 1 FROM weeks WHERE weeks.wk = (date_trunc('week', now())::date - (i * 7))) AS has
    FROM series
  ),
  -- Разрешаем "пропустить" текущую неделю, если в ней ещё нет тренировки
  adj AS (
    SELECT i, has,
      CASE
        WHEN i = 0 AND NOT has THEN NULL
        ELSE has
      END AS h
    FROM back
  ),
  trimmed AS (
    SELECT * FROM adj WHERE h IS NOT NULL ORDER BY i
  ),
  run AS (
    SELECT h,
           SUM(CASE WHEN h THEN 0 ELSE 1 END) OVER (ORDER BY i) AS grp,
           i
    FROM trimmed
  )
  SELECT COUNT(*)::int INTO v_streak FROM run WHERE grp = 0 AND h = true;

  -- Спарклайн: последние 8 недель (старые -> новые)
  SELECT jsonb_agg(jsonb_build_object('week', wk, 'count', cnt) ORDER BY wk)
  INTO v_sparkline
  FROM (
    SELECT (date_trunc('week', now())::date - (i * 7)) AS wk,
           (
             SELECT COUNT(*)
             FROM public.schedule_bookings sb
             JOIN public.schedule_entries se ON se.id = sb.entry_id
             WHERE sb.user_id = v_user AND sb.status = 'booked'
               AND date_trunc('week', se.starts_at)::date = (date_trunc('week', now())::date - (i * 7))
           )::int AS cnt
    FROM generate_series(0, 7) AS g(i)
  ) s;

  -- Распределение по типам за последние 90 дней
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', type, 'count', cnt)), '[]'::jsonb)
  INTO v_by_type
  FROM (
    SELECT COALESCE(w.type, 'unknown') AS type, COUNT(*)::int AS cnt
    FROM public.schedule_bookings sb
    JOIN public.schedule_entries se ON se.id = sb.entry_id
    LEFT JOIN public.workouts w ON w.id = se.workout_id
    WHERE sb.user_id = v_user AND sb.status = 'booked'
      AND se.starts_at <= now()
      AND se.starts_at >= now() - interval '90 days'
    GROUP BY COALESCE(w.type, 'unknown')
  ) t;

  -- Бенчмарк за текущий месяц: процентиль (CUME_DIST) среди клиентов c >=1 тренировкой в этом месяце.
  -- Подавляем если когорта < 11 или клиент уникальный максимум.
  WITH per_user AS (
    SELECT sb.user_id, COUNT(*)::int AS cnt
    FROM public.schedule_bookings sb
    JOIN public.schedule_entries se ON se.id = sb.entry_id
    WHERE sb.status = 'booked'
      AND se.starts_at <= now()
      AND date_trunc('month', se.starts_at) = date_trunc('month', now())
    GROUP BY sb.user_id
  ),
  ranked AS (
    SELECT user_id, cnt, CUME_DIST() OVER (ORDER BY cnt) AS cd
    FROM per_user
  )
  SELECT COUNT(*)::int,
         (SELECT cd FROM ranked WHERE user_id = v_user)
  INTO v_cohort, v_percentile
  FROM per_user;

  IF v_cohort < 11 THEN
    v_percentile := NULL;
  ELSIF v_percentile IS NOT NULL AND v_percentile >= 1.0 THEN
    -- подавляем уникальный максимум
    IF (SELECT COUNT(*) FROM (
        WITH pu AS (
          SELECT sb.user_id, COUNT(*)::int AS cnt
          FROM public.schedule_bookings sb
          JOIN public.schedule_entries se ON se.id = sb.entry_id
          WHERE sb.status = 'booked' AND se.starts_at <= now()
            AND date_trunc('month', se.starts_at) = date_trunc('month', now())
          GROUP BY sb.user_id
        )
        SELECT 1 FROM pu WHERE cnt = (SELECT MAX(cnt) FROM pu)
       ) x) = 1 THEN
      v_percentile := 0.99;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'total', v_total,
    'this_month', v_this_month,
    'best_month', v_best_month,
    'streak_weeks', v_streak,
    'sparkline', COALESCE(v_sparkline, '[]'::jsonb),
    'by_type', v_by_type,
    'benchmark', jsonb_build_object(
      'cohort', v_cohort,
      'percentile', v_percentile
    )
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.get_my_stats() TO authenticated;
