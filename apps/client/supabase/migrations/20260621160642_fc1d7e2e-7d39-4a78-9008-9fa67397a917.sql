ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS trainer_name text;
ALTER TABLE public.schedule_entries DROP COLUMN IF EXISTS trainer_name;