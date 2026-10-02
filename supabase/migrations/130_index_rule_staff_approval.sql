-- 130_index_rule_staff_approval.sql (PR105 §3)
--
-- The tutor index/sitemap rule gains STAFF APPROVAL. A tutor page is indexable
-- (index meta + sitemap + structured data) only when ALL hold: completion = 100
-- (PR100), the Rs 199 fee is paid (PR100), AND staff have approved the CNIC, the
-- profile photo and the selfie (PR105). Otherwise the page is still visible on
-- TutorMint but noindex and out of the sitemap. The TS twin is
-- lib/seo/indexable.ts tutorProfileIndexable; they must stay in lockstep.
--
-- CREATE OR REPLACE keeps the signature and the existing grants.

create or replace function public.listed_tutor_slugs()
returns table(slug text, updated_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    and coalesce(p.is_seed, false) = false
    and coalesce(p.profile_completion, 0) >= 100   -- same % as the dashboard
    and tp.verified_fee_paid_at is not null          -- Rs 199 fee paid
    -- STAFF APPROVALS (PR105 §3):
    -- CNIC approved = deriveCnicStatus(...) === 'approved' (marker + number + image)
    and (p.cnic_verified_at is not null or lower(coalesce(p.verification_state, '')) = 'approved')
    and coalesce(btrim(p.cnic_number), '') <> ''
    and coalesce(btrim(p.cnic_image_path), '') <> ''
    and p.profile_pic_status = 'approved'
    and p.selfie_status = 'approved';
$function$;
