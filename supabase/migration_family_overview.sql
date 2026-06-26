-- ============================================================
--  QuickBudget — family overview (combined budget for a group)
--
--  Returns the SUM of every member's income/savings and ALL their
--  expenses (with who spent each), but only to people in the group.
--  SECURITY DEFINER so it can read members' data, gated by membership.
--
--  Run ALL of this in Supabase → SQL Editor (Cmd+A → Run). Safe to re-run.
-- ============================================================

create or replace function public.group_overview(gid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_group_member(gid) then
    raise exception 'Not allowed';
  end if;

  with members as (
    select gm.email, u.id as uid
    from public.group_members gm
    left join auth.users u on lower(u.email) = lower(gm.email)
    where gm.group_id = gid
  )
  select jsonb_build_object(
    'income',  coalesce((select sum(b.income)  from public.budgets b
                          where b.user_id in (select uid from members where uid is not null)), 0),
    'savings', coalesce((select sum(b.savings) from public.budgets b
                          where b.user_id in (select uid from members where uid is not null)), 0),
    'expenses', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'category', e.category,
                 'amount',   e.amount,
                 'spent_on', e.spent_on,
                 'note',     e.note,
                 'email',    m.email)
                 order by e.spent_on desc)
        from public.expenses e
        join members m on m.uid = e.user_id
      ), '[]'::jsonb)
  ) into res;

  return res;
end; $$;

grant execute on function public.group_overview(uuid) to authenticated;
