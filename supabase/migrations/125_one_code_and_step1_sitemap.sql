-- 125_one_code_and_step1_sitemap.sql (PR93 Parts A + C)
--
-- PART A.1 — ONE SMS CODE PER NUMBER, ATOMICALLY. sendOtp / startPendingSignup do
-- a SELECT-then-INSERT to enforce "one live code per number", which is a race:
-- two quick taps both find nothing and both insert + send (SendPK logs showed two
-- codes for one number on 28 Sep). A partial UNIQUE INDEX makes the second insert
-- fail (23505), which the code treats as "already sent" — so at most one SMS goes.
--
--   * phone_otps: one LIVE (unconsumed) code per (phone, purpose). A locked code
--     keeps consumed_at NULL (never replaced), so it still counts as the live one.
--   * pending_signups: one row per mobile (the app deletes expired rows first, so
--     the index only ever guards a live draft).
--
-- Existing duplicates are cleaned up before each index is created.
--
-- PART C — the TUTOR SITEMAP rule is STEP 1, enforced explicitly. listed_tutor_slugs
-- was built on tutor_directory and RELIED on it to guarantee verified mobile, a
-- city, an area and a subject. PR92 (migration 124) relaxed tutor_directory to
-- list every real tutor, so those items are no longer guaranteed there — this
-- recreates the function to enforce the full step-1 rule itself (mobile, CNIC/
-- picture/selfie approved, subject, city, area, fee; not seed), keeping the join
-- to tutor_directory only for the moderation exclusions. The "100% completion"
-- gate stays removed (owner PR89). Mirrors tutorProfileIndexable (lib/seo/indexable).

-- ── Part A.1: phone_otps one-live-code guard ──
update phone_otps set consumed_at = now()
where id in (
  select id from (
    select id, row_number() over (partition by phone, purpose order by created_at asc) as rn
    from phone_otps where consumed_at is null
  ) t where t.rn > 1
);
create unique index if not exists phone_otps_one_live
  on phone_otps (phone, purpose) where consumed_at is null;

-- ── Part A.1: pending_signups one-row-per-mobile guard ──
delete from pending_signups where token in (
  select token from (
    select token, row_number() over (partition by mobile order by created_at desc) as rn
    from pending_signups
  ) t where t.rn > 1
);
create unique index if not exists pending_signups_one_mobile
  on pending_signups (mobile);

-- ── Part C: the tutor sitemap = STEP 1 complete, enforced explicitly ──
create or replace function public.listed_tutor_slugs()
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    -- moderation exclusions come from the (now relaxed) view.
    and coalesce(p.is_seed, false) = false
    -- STEP 1 (owner PR89), enforced here since the view no longer guarantees it:
    -- fee paid
    and tp.verified_fee_paid_at is not null
    -- verified mobile
    and p.phone_verified_at is not null
    -- CNIC approved = deriveCnicStatus(...) === 'approved' (marker + number + image)
    and (p.cnic_verified_at is not null or lower(coalesce(p.verification_state, '')) = 'approved')
    and coalesce(btrim(p.cnic_number), '') <> ''
    and coalesce(btrim(p.cnic_image_path), '') <> ''
    -- profile picture + selfie approved by staff
    and p.profile_pic_status = 'approved'
    and p.selfie_status = 'approved'
    -- at least one subject
    and exists (select 1 from tutor_subjects ts where ts.tutor_id = tp.id)
    -- a city and at least one area
    and tp.city is not null and btrim(tp.city) <> ''
    and (
      (tp.area is not null and btrim(tp.area) <> '')
      or exists (select 1 from tutor_areas ta where ta.tutor_id = tp.id)
    );
$fn$;
revoke all on function public.listed_tutor_slugs() from public;
grant execute on function public.listed_tutor_slugs() to anon, authenticated, service_role;
