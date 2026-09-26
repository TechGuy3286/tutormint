-- 112_paypro_provider_and_name_sync.sql (PR66)
--
-- 1) BLOCKER (PR66 §1): payments_provider_check did not allow 'paypro', so the
--    PR65 PayPro checkout insert failed. Widen it — additive, the existing values
--    are kept. The other payments constraints already accept the PayPro values PR65
--    writes: status uses 'pending'/'approved' (payments_status_check allows both)
--    and method is left NULL (payments_method_check permits NULL). plan_code has no
--    CHECK (it is an FK to plans). So only the provider constraint changes.
--
-- 2) One name (PR66 §5): profiles.full_name and tutor_profiles.full_name had drifted
--    for some tutors (Settings writes one, onboarding the other). The canonical name
--    is the one the member sees on their dashboard — profiles.full_name when set —
--    so this syncs the two columns for tutors WITHOUT ever wiping a name: it fills
--    a blank from the other side and prefers a non-blank profiles.full_name.

-- ── provider constraint ──────────────────────────────────────────────────────
alter table payments drop constraint if exists payments_provider_check;
alter table payments
  add constraint payments_provider_check
  check (provider = any (array['assanpay'::text, 'manual'::text, 'simulator'::text, 'paypro'::text]));

-- ── name sync (tutors) ───────────────────────────────────────────────────────
-- Where profiles.full_name is blank but tutor_profiles has one, fill profiles.
update profiles p
set full_name = tp.full_name
from tutor_profiles tp
where tp.id = p.id
  and p.role = 'tutor'
  and coalesce(nullif(btrim(p.full_name), ''), '') = ''
  and coalesce(nullif(btrim(tp.full_name), ''), '') <> '';

-- Then make tutor_profiles.full_name match the canonical profiles.full_name
-- (preferred when non-blank), so admin / public profile / CV read the same name
-- the dashboard shows. Never overwrites with a blank.
update tutor_profiles tp
set full_name = coalesce(nullif(btrim(p.full_name), ''), tp.full_name)
from profiles p
where p.id = tp.id
  and p.role = 'tutor'
  and coalesce(tp.full_name, '') <> coalesce(nullif(btrim(p.full_name), ''), tp.full_name);
