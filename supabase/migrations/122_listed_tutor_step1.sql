-- 122_listed_tutor_step1.sql (PR89 Part A — owner's step-1 indexing rule)
--
-- The TUTOR SITEMAP rule changes from "100% complete + fee paid" to STEP 1
-- COMPLETE: verified mobile, CNIC approved, profile picture approved, selfie
-- approved, at least one subject, a city, at least one area, and the verification
-- fee paid. Seed/fixture accounts stay noindex everywhere.
--
-- listed_tutor_slugs() is built on tutor_directory, which ALREADY enforces the
-- non-approval half of step 1 (mobile verified, city, area, >=1 subject, gender,
-- not suspended/banned/seed/team, verification not suspended/rejected, claimed if
-- imported). So this only ADDS the three staff-approval gates + the fee and DROPS
-- the profile_completion >= 100 gate. It stays a strict subset of tutor_directory,
-- so who appears in /browse/tutors is unchanged (that switch is a separate PR).
--
-- The TS mirror is tutorProfileIndexable() in lib/seo/indexable.ts; the CNIC test
-- here mirrors lib/cnicStatus deriveCnicStatus() === 'approved' (the approval
-- marker AND a CNIC number AND a CNIC image on file). They must stay in lockstep.
--
-- CREATE OR REPLACE only — no view or type changes, grants restored exactly as in
-- migration 94.

create or replace function public.listed_tutor_slugs()
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    -- seed/fixture accounts stay noindex everywhere (owner, 10 Sep 2026).
    and coalesce(p.is_seed, false) = false
    -- the one-time verification fee is paid.
    and tp.verified_fee_paid_at is not null
    -- CNIC approved = deriveCnicStatus(...) === 'approved': the approval marker
    -- AND a CNIC number AND a CNIC image on file (lib/cnicStatus).
    and (p.cnic_verified_at is not null or lower(coalesce(p.verification_state, '')) = 'approved')
    and coalesce(btrim(p.cnic_number), '') <> ''
    and coalesce(btrim(p.cnic_image_path), '') <> ''
    -- profile picture + selfie approved by staff (PR60).
    and p.profile_pic_status = 'approved'
    and p.selfie_status = 'approved';
  -- mobile verified, city, area and >=1 subject are guaranteed by tutor_directory.
$fn$;
revoke all on function public.listed_tutor_slugs() from public;
grant execute on function public.listed_tutor_slugs() to anon, authenticated, service_role;
