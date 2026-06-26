-- ============================================================
--  QuickBudget — family / group feature
--  Owner creates a group, invites people by email, assigns roles.
--  Run ONCE in Supabase → SQL Editor → New query → Run.
--  (Safe to re-run.)
-- ============================================================

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  email      text not null,
  user_id    uuid references auth.users (id) on delete set null,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  unique (group_id, email)
);

create index if not exists group_members_group_idx on public.group_members (group_id);

-- ----------------------------------------------------------------
-- Helper functions (SECURITY DEFINER → bypass RLS internally so the
-- policies below don't recurse).
-- ----------------------------------------------------------------
create or replace function public.is_group_owner(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = gid and g.owner_id = auth.uid());
$$;

create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = gid and g.owner_id = auth.uid())
      or exists (select 1 from public.group_members m
                 where m.group_id = gid
                   and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- ----------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "groups view"   on public.groups;
create policy "groups view"   on public.groups for select using (public.is_group_member(id));
drop policy if exists "groups insert" on public.groups;
create policy "groups insert" on public.groups for insert with check (owner_id = auth.uid());
drop policy if exists "groups update" on public.groups;
create policy "groups update" on public.groups for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "groups delete" on public.groups;
create policy "groups delete" on public.groups for delete using (owner_id = auth.uid());

drop policy if exists "members view"   on public.group_members;
create policy "members view"   on public.group_members for select using (public.is_group_member(group_id));
drop policy if exists "members insert" on public.group_members;
create policy "members insert" on public.group_members for insert with check (public.is_group_owner(group_id));
drop policy if exists "members update" on public.group_members;
create policy "members update" on public.group_members for update using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));
drop policy if exists "members delete" on public.group_members;
create policy "members delete" on public.group_members for delete using (public.is_group_owner(group_id));
