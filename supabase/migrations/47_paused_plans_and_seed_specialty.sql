-- 47: paused subscriptions, and the last fabricated seed specialty.
--
-- Two unrelated-but-small changes, one migration.
--
-- (a) THE PAUSED PLAN. A tutor may buy a plan while under 100%. The month must
--     not start counting until they go live (become listed), so the
--     subscription is created 'paused' with a NULL expires_at, and a go-live
--     hook flips it to 'active' with a fresh 30-day window on the day the
--     tutor becomes listed. getEntitlements grants no powers or badge while
--     paused; the expiry sweep already filters status='active' and so ignores
--     a paused row. This only widens the CHECK to admit the new value.
--
-- (b) THE FABRICATED "Physics (Advance)" SPECIALTY. Same sample-default origin
--     as the credentials cleared in migration 46 -- the tutor settings page
--     seeded its state with a "Physics at Advance" specialty, and Save wrote it
--     to a tutor who never chose it. Two seed tutors carry it. Removed by exact
--     value from both the display string and the jsonb list; their other,
--     genuinely-set specialties are left untouched. Real browse/matching
--     subjects come from the tutor_subjects join, not these legacy display
--     fields, so this is cosmetic -- but a fabricated subject on a card is
--     still a fabricated claim. Idempotent.

-- (a) ------------------------------------------------------------------------
alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in ('active', 'expired', 'cancelled', 'paused'));

-- (b) ------------------------------------------------------------------------
-- The display string: strip the exact ", Physics (Advance)" / "Physics (Advance), "
-- fragment, and the bare value if it were ever alone.
update public.tutor_profiles
set specialty_subjects = nullif(
  btrim(
    regexp_replace(
      replace(replace(specialty_subjects, 'Physics (Advance), ', ''), ', Physics (Advance)', ''),
      '^Physics \(Advance\)$', ''
    ),
    ', '
  ),
  ''
)
where specialty_subjects like '%Physics (Advance)%';

-- The jsonb list: drop the {level:'Advance', subject:'Physics'} object, keep the rest.
update public.tutor_profiles
set specialty_list = coalesce(
      (select jsonb_agg(e)
         from jsonb_array_elements(specialty_list) e
        where not (e->>'subject' = 'Physics' and e->>'level' = 'Advance')),
      '[]'::jsonb)
where specialty_list @> '[{"subject":"Physics","level":"Advance"}]'::jsonb;
