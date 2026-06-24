CREATE TABLE IF NOT EXISTS public.club_settings (
  id boolean PRIMARY KEY DEFAULT true,
  write_url text,
  call_url text,
  feedback_url text,
  cancel_booking_minutes integer NOT NULL DEFAULT 180,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_settings_singleton CHECK (id = true)
);

GRANT SELECT ON public.club_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_settings TO authenticated;
GRANT ALL ON public.club_settings TO service_role;

ALTER TABLE public.club_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "club_settings readable by everyone"
  ON public.club_settings FOR SELECT
  USING (true);

CREATE POLICY "club_settings updatable by authenticated"
  ON public.club_settings FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "club_settings insertable by authenticated"
  ON public.club_settings FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE TRIGGER club_settings_updated_at
  BEFORE UPDATE ON public.club_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.club_settings (id) VALUES (true) ON CONFLICT DO NOTHING;