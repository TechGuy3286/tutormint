-- Reconcile the split suspension state.
--
-- Suspension is one fact with one enforcement point (CLAUDE.md, "Admin, part 1
-- (T7a)"), but two columns could express it and only one had a single writer:
--
--   profiles.is_suspended                 written by lib/moderation.ts
--   tutor_profiles.verification_status    ALSO written by the video moderation
--                                         queue, which set 'suspended' without
--                                         touching the profile flag
--
-- A tutor suspended through the video queue therefore ended up delisted but
-- not suspended. getEntitlements() read only the profile flag, so it saw a
-- normal member: the listing check refused their application and told them to
-- "complete your profile" -- at 100% completion. That is precisely the failure
-- the ordering rule exists to prevent, arriving through the data instead of
-- through the code.
--
-- Fixed in three places, of which this is one:
--   * app/api/admin/tutors/moderate now delegates to suspendMember() /
--     unsuspendMember(), so lib/moderation.ts is the only writer of either
--     column.
--   * getEntitlements() treats EITHER column as suspended, so a row written
--     before this migration cannot slip through a path that reads one of them.
--   * the rows already out of step are reconciled below.
--
-- DIRECTION OF THE FIX. Where the two disagree, the LISTING column wins and the
-- profile flag is raised to match. verification_status='suspended' is only ever
-- set by a moderator making that decision, so the honest reading is "a
-- moderator suspended this person and the second write was missing" -- not "a
-- stray value; let them back in". Reinstating someone a moderator stopped, as a
-- side effect of a migration, is the more expensive mistake of the two.
--
-- The reverse case (is_suspended with a non-suspended listing) is also
-- reconciled, for completeness. It could not be produced by any code path that
-- existed, because suspendMember() always wrote both.

begin;

-- 1. delisted but not suspended -> raise the profile flag
update public.profiles p
set
  is_suspended = true,
  suspended_at = coalesce(p.suspended_at, now()),
  suspension_reason = coalesce(
    p.suspension_reason,
    'Reconciled: this account was suspended through the tutor video queue before '
      || 'that path wrote profiles.is_suspended. The moderation decision stands; '
      || 'only the record of it was incomplete.'
  )
from public.tutor_profiles tp
where tp.id = p.id
  and tp.verification_status = 'suspended'
  and coalesce(p.is_suspended, false) = false;

-- 2. suspended but still carrying a listable status -> match the listing
update public.tutor_profiles tp
set verification_status = 'suspended', is_featured = false
from public.profiles p
where p.id = tp.id
  and coalesce(p.is_suspended, false) = true
  and tp.verification_status <> 'suspended';

-- 3. prove it. Fails the migration rather than leaving a silent mismatch.
do $$
declare
  n integer;
begin
  select count(*) into n
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.id
  where (tp.verification_status = 'suspended') <> coalesce(p.is_suspended, false);

  if n > 0 then
    raise exception 'suspension state still disagrees on % row(s)', n;
  end if;

  raise notice 'suspension state consistent across all tutor rows';
end;
$$;

commit;
