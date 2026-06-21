-- Sales (Продажи) — run on Supabase after db/schema.sql, db/clients.sql, db/memberships.sql.

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  admin_id uuid references auth.users(id) on delete set null,
  admin_name text,
  sold_at date not null default current_date,
  total_amount numeric(12,2) not null check (total_amount >= 0),
  installments smallint not null default 1 check (installments in (1,2,3)),
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.sale_installments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  due_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  paid boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists sales_studio_sold_idx on public.sales(studio_id, sold_at desc);
create index if not exists sales_client_idx on public.sales(client_id);
create index if not exists sale_installments_sale_idx on public.sale_installments(sale_id);

notify pgrst, 'reload schema';

grant select, insert, update, delete on public.sales to authenticated;
grant all on public.sales to service_role;

grant select, insert, update, delete on public.sale_installments to authenticated;
grant all on public.sale_installments to service_role;

alter table public.sales enable row level security;
alter table public.sale_installments enable row level security;

drop policy if exists "sales studio rw" on public.sales;
create policy "sales studio rw" on public.sales
  for all to authenticated
  using (public.is_trainer(auth.uid(), studio_id))
  with check (public.is_trainer(auth.uid(), studio_id));

drop policy if exists "sale_installments via sale" on public.sale_installments;
create policy "sale_installments via sale" on public.sale_installments
  for all to authenticated
  using (
    exists (
      select 1 from public.sales s
      where s.id = sale_installments.sale_id
        and public.is_trainer(auth.uid(), s.studio_id)
    )
  )
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_installments.sale_id
        and public.is_trainer(auth.uid(), s.studio_id)
    )
  );
