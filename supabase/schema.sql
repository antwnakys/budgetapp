-- ============================================================
--  Budget Circle — database schema
--  Run this in your Supabase project:
--    Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- One budget row per user (income + savings)
create table if not exists public.budgets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  income     numeric not null default 0,
  savings    numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Expenses (many per user), each tied to the day it was spent
create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null,
  amount     numeric not null check (amount >= 0),
  spent_on   date not null default current_date,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_id_idx on public.expenses (user_id);
create index if not exists expenses_spent_on_idx on public.expenses (user_id, spent_on);

-- ----------------------------------------------------------------
-- Row Level Security: every user can only see/touch their own rows
-- ----------------------------------------------------------------
alter table public.budgets  enable row level security;
alter table public.expenses enable row level security;

-- budgets policies
drop policy if exists "own budget select" on public.budgets;
create policy "own budget select" on public.budgets
  for select using (auth.uid() = user_id);

drop policy if exists "own budget insert" on public.budgets;
create policy "own budget insert" on public.budgets
  for insert with check (auth.uid() = user_id);

drop policy if exists "own budget update" on public.budgets;
create policy "own budget update" on public.budgets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- expenses policies
drop policy if exists "own expenses select" on public.expenses;
create policy "own expenses select" on public.expenses
  for select using (auth.uid() = user_id);

drop policy if exists "own expenses insert" on public.expenses;
create policy "own expenses insert" on public.expenses
  for insert with check (auth.uid() = user_id);

drop policy if exists "own expenses delete" on public.expenses;
create policy "own expenses delete" on public.expenses
  for delete using (auth.uid() = user_id);
