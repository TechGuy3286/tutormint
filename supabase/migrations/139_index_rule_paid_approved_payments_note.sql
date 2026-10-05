-- 139_index_rule_paid_approved_payments_note.sql (owner, 5 Oct 2026)
--
-- 1. TUTOR INDEX RULE = PAID + APPROVED. listed_tutor_slugs() (the tutor
--    sitemap) no longer requires profile_completion >= 100: a tutor is in the
--    sitemap when in tutor_directory (which already excludes paused/suspended,
--    banned, hidden, under-review, seed/team and any rejected document), the
--    Rs 199 fee is paid, and staff have approved CNIC, profile photo and selfie.
--    The TypeScript mirror is lib/seo/indexable tutorProfileIndexable; the live
--    test scripts/test-directory-live.ts asserts the two agree for every account.
--    CREATE OR REPLACE, same signature, grants kept.
--
-- 2. PAYMENTS SURVIVE A DELETED TEST ACCOUNT (one-time exception, approved by
--    Alee): payments.user_id becomes NULLABLE so a payment can outlive its
--    account (amount, PayPro reference and dates untouched — finance totals and
--    PayPro reconciliation still match), and an additive nullable `note` column
--    carries the plain reason ("deleted test account"). The RLS policies keep
--    reading `user_id = auth.uid() OR is_admin()`: a null user_id row is visible
--    to admins only, which is exactly who reads the Payments queue.

create or replace function public.listed_tutor_slugs()
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    and coalesce(p.is_seed, false) = false
    -- paid + approved (owner, 5 Oct 2026); 100% completion no longer required.
    and tp.verified_fee_paid_at is not null
    -- CNIC approved = deriveCnicStatus(...) === 'approved' (marker + number + image)
    and (p.cnic_verified_at is not null or lower(coalesce(p.verification_state, '')) = 'approved')
    and coalesce(btrim(p.cnic_number), '') <> ''
    and coalesce(btrim(p.cnic_image_path), '') <> ''
    and p.profile_pic_status = 'approved'
    and p.selfie_status = 'approved';
$fn$;
revoke all on function public.listed_tutor_slugs() from public;
grant execute on function public.listed_tutor_slugs() to anon, authenticated, service_role;

alter table public.payments alter column user_id drop not null;
alter table public.payments add column if not exists note text;
comment on column public.payments.note is
  'Plain-English note shown on the admin Payments queue, e.g. "deleted test account" when the payer account was hard-deleted and user_id set to null (owner, 5 Oct 2026).';
