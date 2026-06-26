-- ============================================================
--  QuickBudget — shared family budget, allowances & role permissions
--
--  Adds a shared family income/savings, family expenses, per-member
--  allowances, and role-based permissions (owner & parent can edit
--  everything; kids & teens only manage their own allowance spending).
--
--  Run ALL of this in Supabase → SQL Editor (Cmd+A → Run). Safe to re-run.
--  This supersedes migration_family_overview.sql (it redefines group_overview).
-- ============================================================

-- ---- schema additions -------------------------------------------------
alter table public.groups        add column if not exists income  numeric not null default 0;
alter table public.groups        add column if not exists savings numeric not null default 0;
alter table public.group_members add column if not exists allowance numeric not null default 0;

create table if not exists public.group_expenses (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  member_id  uuid references public.group_members (id) on delete set null,
  category   text not null,
  amount     numeric not null check (amount >= 0),
  spent_on   date not null default current_date,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists group_expenses_group_idx on public.group_expenses (group_id);

alter table public.group_expenses enable row level security;
drop policy if exists "group_expenses view" on public.group_expenses;
create policy "group_expenses view" on public.group_expenses
  for select to authenticated using (public.is_group_member(group_id));
grant select on public.group_expenses to authenticated;

-- ---- role helpers -----------------------------------------------------
create or replace function public.group_role(gid uuid)
returns text language sql security definer stable set search_path = public as $$
  select case
    when exists (select 1 from public.groups g where g.id = gid and g.owner_id = auth.uid()) then 'owner'
    else (select m.role from public.group_members m
          where m.group_id = gid
            and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1)
  end;
$$;

create or replace function public.is_group_editor(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.group_role(gid) in ('owner', 'parent');
$$;

create or replace function public.my_member_id(gid uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select id from public.group_members
  where group_id = gid and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1;
$$;

-- ---- writes (SECURITY DEFINER so they bypass the RLS-insert pitfalls) -
create or replace function public.set_family_budget(gid uuid, p_income numeric, p_savings numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_editor(gid) then raise exception 'Only the owner or a parent can edit the family budget'; end if;
  update public.groups set income = greatest(p_income, 0), savings = greatest(p_savings, 0) where id = gid;
end; $$;

create or replace function public.set_member_allowance(p_member uuid, p_allowance numeric)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  select group_id into gid from public.group_members where id = p_member;
  if not public.is_group_editor(gid) then raise exception 'Only the owner or a parent can set allowances'; end if;
  update public.group_members set allowance = greatest(p_allowance, 0) where id = p_member;
end; $$;

create or replace function public.add_family_expense(gid uuid, p_category text, p_amount numeric, p_spent_on date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_member(gid) then raise exception 'Not allowed'; end if;
  insert into public.group_expenses (group_id, member_id, category, amount, spent_on, note)
  values (gid, public.my_member_id(gid), p_category, greatest(p_amount, 0), coalesce(p_spent_on, current_date), p_note);
end; $$;

create or replace function public.delete_family_expense(p_expense uuid)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid; mid uuid;
begin
  select group_id, member_id into gid, mid from public.group_expenses where id = p_expense;
  if gid is null then return; end if;
  if not (public.is_group_editor(gid) or (mid is not null and mid = public.my_member_id(gid))) then
    raise exception 'Not allowed';
  end if;
  delete from public.group_expenses where id = p_expense;
end; $$;

-- ---- combined overview ------------------------------------------------
create or replace function public.group_overview(gid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb; g record;
begin
  if not public.is_group_member(gid) then raise exception 'Not allowed'; end if;
  select * into g from public.groups where id = gid;

  select jsonb_build_object(
    'income',       coalesce(g.income, 0),
    'savings',      coalesce(g.savings, 0),
    'my_role',      public.group_role(gid),
    'my_member_id', public.my_member_id(gid),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'member_id', m.id, 'email', m.email, 'role', m.role,
               'allowance', coalesce(m.allowance, 0),
               'spent', coalesce((select sum(e.amount) from public.group_expenses e where e.member_id = m.id), 0))
             order by m.created_at)
      from public.group_members m where m.group_id = gid), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'category', e.category, 'amount', e.amount,
               'spent_on', e.spent_on, 'note', e.note,
               'member_id', e.member_id, 'email', m.email, 'role', m.role)
             order by e.spent_on desc)
      from public.group_expenses e
      left join public.group_members m on m.id = e.member_id
      where e.group_id = gid), '[]'::jsonb)
  ) into res;
  return res;
end; $$;

grant execute on function public.group_role(uuid)                                   to authenticated;
grant execute on function public.is_group_editor(uuid)                              to authenticated;
grant execute on function public.my_member_id(uuid)                                 to authenticated;
grant execute on function public.set_family_budget(uuid, numeric, numeric)          to authenticated;
grant execute on function public.set_member_allowance(uuid, numeric)               to authenticated;
grant execute on function public.add_family_expense(uuid, text, numeric, date, text) to authenticated;
grant execute on function public.delete_family_expense(uuid)                        to authenticated;
grant execute on function public.group_overview(uuid)                               to authenticated;
