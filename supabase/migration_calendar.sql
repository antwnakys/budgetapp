-- ============================================================
--  QuickBudget — calendar upgrade
--  Adds a date + note to each expense.
--  Run this ONCE in Supabase → SQL Editor → New query → Run.
--  (Safe to re-run; uses "if not exists".)
-- ============================================================

alter table public.expenses
  add column if not exists spent_on date not null default current_date,
  add column if not exists note text;

create index if not exists expenses_spent_on_idx
  on public.expenses (user_id, spent_on);
