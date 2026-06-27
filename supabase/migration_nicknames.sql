-- ============================================================
--  QuickBudget — member nicknames
--  Adds a nickname to each group member and surfaces it in the
--  combined overview. Run ALL of this in Supabase SQL Editor (Cmd+A → Run).
--  Safe to re-run.
-- ============================================================

alter table public.group_members add column if not exists nickname text;

-- redefine the overview to include nicknames on members and expenses
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
               'nickname', m.nickname,
               'allowance', coalesce(m.allowance, 0),
               'spent', coalesce((select sum(e.amount) from public.group_expenses e where e.member_id = m.id), 0))
             order by m.created_at)
      from public.group_members m where m.group_id = gid), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'category', e.category, 'amount', e.amount,
               'spent_on', e.spent_on, 'note', e.note,
               'member_id', e.member_id, 'email', m.email,
               'nickname', m.nickname, 'role', m.role)
             order by e.spent_on desc)
      from public.group_expenses e
      left join public.group_members m on m.id = e.member_id
      where e.group_id = gid), '[]'::jsonb)
  ) into res;
  return res;
end; $$;
