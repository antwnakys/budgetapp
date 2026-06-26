-- ============================================================
--  QuickBudget — FIX for "row violates row-level security policy"
--  when creating a family group.
--
--  Run ALL of this in Supabase → SQL Editor → New query → Run.
--  Select everything (Cmd+A) before running so nothing is missed.
--  Safe to run multiple times.
-- ============================================================

-- Make sure the helper functions exist (idempotent)
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

-- Make sure RLS is on and the authenticated role can touch the tables
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
grant select, insert, update, delete on public.groups        to authenticated;
grant select, insert, update, delete on public.group_members to authenticated;

-- (Re)create every policy cleanly
drop policy if exists "groups view"   on public.groups;
drop policy if exists "groups insert" on public.groups;
drop policy if exists "groups update" on public.groups;
drop policy if exists "groups delete" on public.groups;

create policy "groups insert" on public.groups
  for insert to authenticated with check (owner_id = auth.uid());
create policy "groups view" on public.groups
  for select to authenticated using (public.is_group_member(id));
create policy "groups update" on public.groups
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "groups delete" on public.groups
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members view"   on public.group_members;
drop policy if exists "members insert" on public.group_members;
drop policy if exists "members update" on public.group_members;
drop policy if exists "members delete" on public.group_members;

create policy "members insert" on public.group_members
  for insert to authenticated with check (public.is_group_owner(group_id));
create policy "members view" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));
create policy "members update" on public.group_members
  for update to authenticated using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));
create policy "members delete" on public.group_members
  for delete to authenticated using (public.is_group_owner(group_id));
