-- 99_seed_fee_consistency.sql (PR32 §3)
--
-- Verification before plan: a tutor is never Premium/Featured without the
-- one-time Rs 199 verification fee. Two SEED accounts drifted out of that rule —
-- they hold an active paid plan (seed+featured-ali = featured, seed+premium-sara
-- = premium) while tutor_profiles.verified_fee_paid_at is null. This records the
-- fee on those seed rows so plan and verification agree.
--
-- SCOPED TO FIXTURES ONLY. `p.is_seed = true` — real accounts are never touched
-- by this migration (there are none in this state anyway; the SQL check found 0
-- real, 2 seed). Stamping the fee does NOT relist a seed tutor: the is_seed
-- fixture gate in tutor_directory / tutor_visible_profiles (migration 87/94)
-- keeps them out of Browse regardless of the fee.
--
-- Idempotent: only rows still null are stamped, so a re-run changes nothing.

update tutor_profiles tp
set verified_fee_paid_at = now()
from profiles p
where p.id = tp.id
  and p.is_seed = true
  and tp.verified_fee_paid_at is null
  and exists (
    select 1 from subscriptions s
    where s.user_id = tp.id
      and s.plan_code in ('premium', 'featured')
      and s.status = 'active'
  );
