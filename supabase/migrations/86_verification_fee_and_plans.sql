-- 86_verification_fee_and_plans.sql
--
-- Rs 199 becomes a ONE-TIME PROFILE VERIFICATION FEE, not a monthly plan
-- (owner, 15 Sep 2026). After it, the three tutor plans are Basic (free),
-- Premium (Rs 499/mo) and Featured (Rs 999/mo).
--
-- WHY THIS SHAPE. payments.plan_code and subscriptions.plan_code are FK'd to
-- plans.code, so the old 'verified' row cannot be deleted. Instead it is kept
-- as the verification-FEE marker: a payment with plan_code='verified' is the
-- one-time fee (activate.ts sets verified_fee_paid_at and creates NO
-- subscription), and it is flagged active=false so it never shows as a
-- purchasable tier. The free entry tier is a brand-new 'basic' row.
--
-- LISTING. Visibility used to require an active PAID tutor plan. It now requires
-- the one-time fee (tutor_profiles.verified_fee_paid_at) — "pay once to become
-- verified and visible". The two directory views swap the paid-plan EXISTS for
-- the fee flag; ranking (rank_tutors reads tutor_directory) is unchanged — a
-- free Basic tutor has no subscription, so tier 0, below Premium/Featured.

-- 1. Which plan rows are selectable/purchasable tiers.
alter table public.plans
  add column if not exists active boolean not null default true;

-- 2. The one-time fee flag on the tutor.
alter table public.tutor_profiles
  add column if not exists verified_fee_paid_at timestamptz;

-- 3. Backfill: every currently admin-verified tutor, and anyone who ever held
--    the old 199 'verified' plan, has effectively paid the fee — so the live
--    listed set is preserved and verified-but-lapsed tutors relist (free) under
--    the new "fee = visible" rule.
update public.tutor_profiles
  set verified_fee_paid_at = now()
  where verified_fee_paid_at is null and verification_status = 'verified';
update public.tutor_profiles tp
  set verified_fee_paid_at = now()
  where tp.verified_fee_paid_at is null
    and exists (select 1 from public.subscriptions s where s.user_id = tp.id and s.plan_code = 'verified');

-- 4. 'verified' is no longer a subscription tier — it is the fee marker.
update public.plans set active = false where code = 'verified';
-- The fee is one-time; Basic is free — cancel any live 'verified' subscription.
update public.subscriptions
  set status = 'cancelled'
  where plan_code = 'verified' and status in ('active', 'paused');

-- 5. The free Basic tier. Apply 10/mo (shown as "10"); message yes; NO contact,
--    NO WhatsApp, NO viewer identity; rank 1 (lowest). Shows the Verified badge
--    (they paid the fee).
insert into public.plans (
  code, audience, name, price_pkr, duration_days, monthly_quota, displayed_quota,
  can_view_contact, can_whatsapp, can_initiate_message, can_hire, can_see_viewer_identity,
  search_rank, badges, tag_label, active
) values (
  'basic', 'tutor', 'Basic', 0, 30, 10, '10',
  false, false, true, false, false,
  1, ARRAY['Verified']::text[], null, true
)
on conflict (code) do update set
  audience = excluded.audience, name = excluded.name, price_pkr = excluded.price_pkr,
  duration_days = excluded.duration_days, monthly_quota = excluded.monthly_quota,
  displayed_quota = excluded.displayed_quota, can_view_contact = excluded.can_view_contact,
  can_whatsapp = excluded.can_whatsapp, can_initiate_message = excluded.can_initiate_message,
  can_hire = excluded.can_hire, can_see_viewer_identity = excluded.can_see_viewer_identity,
  search_rank = excluded.search_rank, badges = excluded.badges, active = excluded.active;

-- 6. Premium (Rs 499): 100/mo shown "Unlimited"; contact + WhatsApp + viewer
--    identity; rank 2. Featured (Rs 999): 150/mo "Unlimited"; everything +
--    top rank (3).
update public.plans set
  monthly_quota = 100, displayed_quota = 'Unlimited',
  can_view_contact = true, can_whatsapp = true, can_initiate_message = true,
  can_see_viewer_identity = true, search_rank = 2,
  badges = ARRAY['Verified','Premium']::text[], active = true
  where code = 'premium';
update public.plans set
  monthly_quota = 150, displayed_quota = 'Unlimited',
  can_view_contact = true, can_whatsapp = true, can_initiate_message = true,
  can_see_viewer_identity = true, search_rank = 3,
  badges = ARRAY['Verified','Premium','Featured']::text[], active = true
  where code = 'featured';

-- 7. The listing rule: the one-time fee, not an active paid plan. Same columns,
--    same order (CREATE OR REPLACE requires it) — only the WHERE changes.
create or replace view public.tutor_directory as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url, tp.subjects,
    tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms, tp.city, tp.area,
    tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured, tp.created_at,
    tp.gender, p.profile_completion, tp.job_types
  from tutor_profiles tp
  join profiles p on p.id = tp.id
  where tp.verified_fee_paid_at is not null
    and p.phone_verified_at is not null
    and coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and coalesce(tp.under_review, false) = false
    and (tp.verification_status <> all (array['suspended','rejected']::verification_status[]))
    and (tp.imported = false or tp.claimed_at is not null);

create or replace view public.tutor_visible_profiles as
  select tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url, tp.subjects,
    tp.class_levels, tp.degrees, tp.teaching_mode, tp.online_platforms, tp.city, tp.area,
    tp.hourly_rate_pkr, tp.experience_years, tp.video_youtube_id, tp.video_status,
    tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured, tp.created_at,
    tp.gender, p.profile_completion, tp.job_types
  from tutor_profiles tp
  join profiles p on p.id = tp.id
  where coalesce(p.is_suspended, false) = false
    and coalesce(p.is_banned, false) = false
    and (tp.verification_status <> all (array['suspended','rejected']::verification_status[]))
    and (
      (tp.verified_fee_paid_at is not null
        and p.phone_verified_at is not null
        and (tp.imported = false or tp.claimed_at is not null))
      or (tp.imported = true and tp.claimed_at is null)
    );
