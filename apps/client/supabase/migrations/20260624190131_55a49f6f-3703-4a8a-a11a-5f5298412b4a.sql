
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Authenticated can view trainers" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP TABLE IF EXISTS public.user_roles;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP TYPE IF EXISTS public.app_role;
ALTER TABLE public.clients DROP COLUMN IF EXISTS bio;
