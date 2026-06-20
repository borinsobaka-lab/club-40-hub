-- Trainers section — run this on your Supabase project after db/schema.sql.

create table if not exists public.trainers (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  full_name text not null,
  photo_url text,
  gender text check (gender in ('male','female') or gender is null),
  specialization text,
  bio text,
  created_at timestamptz not null default now()
);
create index if not exists trainers_studio_idx on public.trainers(studio_id);

grant select, insert, update, delete on public.trainers to authenticated;
grant all on public.trainers to service_role;

alter table public.trainers enable row level security;

drop policy if exists "trainers studio select" on public.trainers;
create policy "trainers studio select" on public.trainers
  for select to authenticated
  using (studio_id = public.current_studio_id(auth.uid()));

drop policy if exists "trainers trainer write" on public.trainers;
create policy "trainers trainer write" on public.trainers
  for all to authenticated
  using (public.is_trainer(auth.uid(), studio_id))
  with check (public.is_trainer(auth.uid(), studio_id));

-- Storage bucket for trainer photos
insert into storage.buckets (id, name, public)
values ('trainer-photos', 'trainer-photos', true)
on conflict (id) do nothing;

drop policy if exists "trainer-photos public read" on storage.objects;
create policy "trainer-photos public read" on storage.objects
  for select using (bucket_id = 'trainer-photos');

drop policy if exists "trainer-photos auth insert" on storage.objects;
create policy "trainer-photos auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'trainer-photos');

drop policy if exists "trainer-photos auth update" on storage.objects;
create policy "trainer-photos auth update" on storage.objects
  for update to authenticated using (bucket_id = 'trainer-photos');

drop policy if exists "trainer-photos auth delete" on storage.objects;
create policy "trainer-photos auth delete" on storage.objects
  for delete to authenticated using (bucket_id = 'trainer-photos');
