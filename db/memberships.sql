-- Memberships (Номенклатуры) — run on Supabase after db/schema.sql.

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  description text,
  benefits text[] not null default '{}',
  visits_count int,             -- null = безлимит
  duration_days int,            -- срок действия в днях
  auto_renew boolean not null default false,
  price numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- If the table existed before this file was updated, CREATE TABLE IF NOT EXISTS
-- does not add new columns. Keep this block so re-running the SQL repairs the
-- schema and refreshes the API cache.
alter table public.memberships
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists benefits text[] not null default '{}',
  add column if not exists visits_count int,
  add column if not exists duration_days int,
  add column if not exists auto_renew boolean not null default false,
  add column if not exists price numeric(12,2) not null default 0,
  add column if not exists created_at timestamptz not null default now();

notify pgrst, 'reload schema';

create index if not exists memberships_studio_idx on public.memberships(studio_id);

grant select, insert, update, delete on public.memberships to authenticated;
grant all on public.memberships to service_role;

alter table public.memberships enable row level security;

drop policy if exists "memberships studio select" on public.memberships;
create policy "memberships studio select" on public.memberships
  for select to authenticated
  using (studio_id = public.current_studio_id(auth.uid()));

drop policy if exists "memberships trainer write" on public.memberships;
create policy "memberships trainer write" on public.memberships
  for all to authenticated
  using (public.is_trainer(auth.uid(), studio_id))
  with check (public.is_trainer(auth.uid(), studio_id));
