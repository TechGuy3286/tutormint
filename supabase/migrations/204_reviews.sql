-- 204_reviews.sql — parent reviews that work (owner, 27 Oct 2026).
--
-- /review saved nothing. From now:
--   - only a parent whose application with a tutor is at stage Hired may
--     review that tutor, once per hire (one review per application);
--   - a review is a 1–5 rating and a short text, saved as PENDING;
--   - the site Owner approves or rejects it (Trust → Reviews; the server route
--     writes with the service role and logs it in Audit);
--   - only APPROVED reviews are public, appear on the tutor's profile and
--     count in tutor_profiles.rating_avg / rating_count.
--
-- The table holds 0 rows today, so the new NOT NULL status with default
-- 'pending' changes nothing that exists. Additive apart from two policies that
-- are replaced (insert: the hire rule; select: approved only, or your own, or
-- staff) and two functions recreated from their live definitions with one
-- change each (the rating trigger and tutor_public_page count / show approved
-- reviews only). No row is deleted.

alter table public.reviews
  add column if not exists status text not null default 'pending',
  add column if not exists application_id uuid references public.applications(id) on delete set null,
  add column if not exists decided_by uuid references auth.users(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_reason text;

alter table public.reviews drop constraint if exists reviews_status_check;
alter table public.reviews add constraint reviews_status_check check (status in ('pending', 'approved', 'rejected'));

-- One review per hire.
create unique index if not exists reviews_application_uniq on public.reviews (application_id) where application_id is not null;
create index if not exists reviews_status_idx on public.reviews (status, created_at desc);

-- ------------------------------------------------------------ eligibility --
-- True when this parent posted the tuition and this tutor's application to it
-- is at stage Hired. SECURITY DEFINER so it can back an RLS policy; returns a
-- boolean and never a row.
create or replace function public.can_review_hire(p_parent uuid, p_tutor uuid, p_application uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from applications a
      join jobs j on j.id = a.job_id
     where a.id = p_application
       and a.tutor_id = p_tutor
       and a.stage = 'hired'
       and coalesce(a.status, '') <> 'withdrawn'
       and j.parent_id = p_parent
  );
$fn$;
revoke all on function public.can_review_hire(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_review_hire(uuid, uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------- policies ----
drop policy if exists reviews_eligible_parent_insert on public.reviews;
drop policy if exists reviews_hired_parent_insert on public.reviews;
create policy reviews_hired_parent_insert on public.reviews
  for insert to authenticated
  with check (
    parent_id = auth.uid()
    and tutor_id is not null
    and tutor_id <> auth.uid()
    and reviewer_type = 'parent'
    and status = 'pending'
    and decided_by is null
    and decided_at is null
    and application_id is not null
    and public.can_review_hire(auth.uid(), tutor_id, application_id)
  );

drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews
  for select
  using (status = 'approved' or parent_id = auth.uid() or public.is_admin());

-- No UPDATE or DELETE policy, as before: only the server (service role)
-- changes a review's status.

-- -------------------------------------------------------- rating rollup ----
create or replace function public.recompute_tutor_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid := coalesce(new.tutor_id, old.tutor_id);
begin
  if target is null then
    return coalesce(new, old);
  end if;

  update tutor_profiles tp
     set rating_avg = coalesce(agg.avg_rating, 0),
         rating_count = coalesce(agg.n, 0)
    from (
      select round(avg(r.rating)::numeric, 2) as avg_rating, count(*) as n
      from reviews r
      where r.tutor_id = target and r.rating is not null and r.status = 'approved'
    ) agg
   where tp.id = target;

  return coalesce(new, old);
end;
$fn$;

-- ------------------------------------------------ the public tutor page ----
-- The live definition, with `and r.status = 'approved'` on the reviews list.
CREATE OR REPLACE FUNCTION public.tutor_public_page(p_slug text)
 RETURNS TABLE(id uuid, slug text, full_name text, headline text, bio text, avatar_url text, city text, area text, areas text[], cities text[], teaching_mode text, job_types text[], online_platforms text[], gender text, hourly_rate_pkr integer, fee_min_pkr integer, fee_max_pkr integer, experience_years integer, degrees text[], video_youtube_id text, video_status text, rating_avg numeric, rating_count integer, created_at timestamp with time zone, plan_code text, subjects jsonb, slots jsonb, reviews jsonb, degree_documents jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    d.id, d.slug, d.full_name, d.headline, d.bio, d.avatar_url, d.city, d.area, d.areas, d.cities,
    d.teaching_mode, d.job_types, d.online_platforms, d.gender, d.hourly_rate_pkr,
    d.fee_min_pkr, d.fee_max_pkr,
    d.experience_years, d.degrees,
    case when d.video_status = 'approved' then d.video_youtube_id end,
    d.video_status, d.rating_avg, d.rating_count, d.created_at,
    ap.plan_code,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'master_id', tm.id, 'category', cat.name,
               'level', lv.name, 'subject', sub.name
             ) order by cat.sort_order, lv.sort_order, sub.name)
      from tutor_subjects ts
      join taxonomy_master tm      on tm.id    = ts.master_id
      join taxonomy_categories cat on cat.slug = tm.category_slug
      join taxonomy_levels lv      on lv.slug  = tm.level_slug
      left join taxonomy_subjects sub on sub.slug = tm.subject_slug
      where ts.tutor_id = d.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', sl.id, 'text', sl.slot_text, 'booked', sl.is_booked)
                       order by sl.created_at)
      from tutor_slots sl where sl.tutor_id = d.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'rating', r.rating, 'comment', r.comment,
               'created_at', r.created_at,
               'reviewer', split_part(coalesce(rp.full_name, 'A parent'), ' ', 1)
             ) order by r.created_at desc)
      from reviews r
      left join profiles rp on rp.id = r.parent_id
      where r.tutor_id = d.id and r.status = 'approved'
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', ud.id, 'label', ud.label) order by ud.created_at)
      from user_documents ud
      where ud.user_id = d.id and ud.kind = 'degree' and ud.preview_path is not null
    ), '[]'::jsonb)
  from tutor_visible_profiles d
  left join (
    select distinct on (s.user_id) s.user_id, s.plan_code, pl.search_rank
    from subscriptions s
    join plans pl on pl.code = s.plan_code and pl.audience = 'tutor'
    where s.status = 'active' and s.expires_at > now()
    order by s.user_id, pl.search_rank desc, s.expires_at desc
  ) ap on ap.user_id = d.id
  where d.slug = p_slug;
$function$;

-- ------------------------------------------- the "Tutor hired" message -----
-- Add the review link, only where the stored body is still migration 201's.
update public.admin_message_templates
   set body = E'Assalam o Alaikum {first_name}, thank you for hiring {tutor_name} through TutorMint. We hope the lessons go well. Could you leave a short review of the tutor? It helps other parents.\nYou can leave it here:\n{review_link}\n\nNeed help? WhatsApp us on {support_whatsapp}'
 where key = 'pf_hired'
   and body = E'Assalam o Alaikum {first_name}, thank you for hiring {tutor_name} through TutorMint. We hope the lessons go well. Could you reply with a short review of the tutor? It helps other parents.\n\nNeed help? WhatsApp us on {support_whatsapp}';
