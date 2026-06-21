
ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS capacity int;
ALTER TABLE public.workouts DROP CONSTRAINT IF EXISTS workouts_capacity_positive;
ALTER TABLE public.workouts ADD CONSTRAINT workouts_capacity_positive CHECK (capacity IS NULL OR capacity >= 0);

ALTER TABLE public.schedule_entries ADD COLUMN IF NOT EXISTS booked_count int NOT NULL DEFAULT 0;
ALTER TABLE public.schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_booked_le_capacity;
ALTER TABLE public.schedule_entries ADD CONSTRAINT schedule_entries_booked_le_capacity CHECK (capacity IS NULL OR booked_count <= capacity);

DO $$ BEGIN
  CREATE TYPE public.booking_status AS ENUM ('booked','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.schedule_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.schedule_entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.booking_status NOT NULL DEFAULT 'booked',
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE (entry_id, user_id)
);

CREATE INDEX IF NOT EXISTS schedule_bookings_entry_idx ON public.schedule_bookings(entry_id);
CREATE INDEX IF NOT EXISTS schedule_bookings_user_idx ON public.schedule_bookings(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_bookings TO authenticated;
GRANT ALL ON public.schedule_bookings TO service_role;

ALTER TABLE public.schedule_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_bookings select own" ON public.schedule_bookings;
CREATE POLICY "schedule_bookings select own" ON public.schedule_bookings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.book_schedule_entry(p_entry_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_entry public.schedule_entries%rowtype;
  v_capacity int;
  v_booking_id uuid;
  v_existing public.schedule_bookings%rowtype;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  SELECT * INTO v_entry FROM public.schedule_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_entry.starts_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'past');
  END IF;

  SELECT COALESCE(v_entry.capacity, w.capacity, 0) INTO v_capacity
  FROM public.workouts w WHERE w.id = v_entry.workout_id;

  SELECT * INTO v_existing FROM public.schedule_bookings
    WHERE entry_id = p_entry_id AND user_id = v_user;

  IF FOUND AND v_existing.status = 'booked' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_booked',
      'booking_id', v_existing.id, 'booked_count', v_entry.booked_count, 'capacity', v_capacity);
  END IF;

  IF v_capacity > 0 AND v_entry.booked_count >= v_capacity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'full',
      'booked_count', v_entry.booked_count, 'capacity', v_capacity);
  END IF;

  IF FOUND THEN
    UPDATE public.schedule_bookings
      SET status = 'booked', cancelled_at = NULL, created_at = now()
      WHERE id = v_existing.id RETURNING id INTO v_booking_id;
  ELSE
    INSERT INTO public.schedule_bookings (entry_id, user_id, status)
    VALUES (p_entry_id, v_user, 'booked') RETURNING id INTO v_booking_id;
  END IF;

  UPDATE public.schedule_entries SET booked_count = booked_count + 1 WHERE id = p_entry_id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id,
    'booked_count', v_entry.booked_count + 1, 'capacity', v_capacity);
END $$;

REVOKE ALL ON FUNCTION public.book_schedule_entry(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.book_schedule_entry(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_schedule_booking(p_entry_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_entry public.schedule_entries%rowtype;
  v_booking public.schedule_bookings%rowtype;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  SELECT * INTO v_entry FROM public.schedule_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_booking FROM public.schedule_bookings
    WHERE entry_id = p_entry_id AND user_id = v_user;

  IF NOT FOUND OR v_booking.status <> 'booked' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_booked');
  END IF;

  UPDATE public.schedule_bookings SET status = 'cancelled', cancelled_at = now() WHERE id = v_booking.id;
  UPDATE public.schedule_entries SET booked_count = GREATEST(0, booked_count - 1) WHERE id = p_entry_id;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.cancel_schedule_booking(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_schedule_booking(uuid) TO authenticated;
