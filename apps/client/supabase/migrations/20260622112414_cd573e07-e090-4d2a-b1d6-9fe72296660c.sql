CREATE TABLE IF NOT EXISTS public.member_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_goal text,
  goal_motivation text,
  target_timeframe text,
  experience_level text,
  current_weekly_activity integer,
  tried_group_hiit boolean,
  health_flags text[] NOT NULL DEFAULT '{}',
  health_notes text,
  height_cm numeric,
  weight_kg numeric,
  birth_year integer,
  gender text,
  desired_frequency integer,
  preferred_times text[] NOT NULL DEFAULT '{}',
  referral_source text,
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_profiles TO authenticated;
GRANT ALL ON public.member_profiles TO service_role;

ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_profiles select own" ON public.member_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "member_profiles insert own" ON public.member_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "member_profiles update own" ON public.member_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "member_profiles delete own" ON public.member_profiles
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_member_profiles_updated_at
  BEFORE UPDATE ON public.member_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();