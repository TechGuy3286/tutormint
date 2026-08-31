-- 16_tutor_directory_listing_rule.sql
--
-- Corrects who appears in the public tutor directory.
--
-- 06_rls_policies.sql built the view on verification_status = 'verified',
-- which is an ADMIN approval flag. CLAUDE.md's business rules say otherwise:
--
--   "A tutor appears in /browse/tutors when profile_completion = 100%
--    (regardless of plan). Admin moderation is reactive: Approve | Hold |
--    Suspend on any tutor; Suspend removes them from listings."
--
-- So listing is driven by completion, and moderation only takes people OUT.
-- Under the old rule a tutor who finished their profile stayed invisible until
-- an admin touched them, which inverts the intended flow and would have made
-- the directory look empty at launch.
--
-- Contact columns are still absent from the view: it is the public read
-- surface and must never expose phone_number, whatsapp_number or email.

create or replace view public.tutor_directory
with (security_invoker = false) as
select
  tp.id, tp.slug, tp.full_name, tp.headline, tp.bio, tp.avatar_url,
  tp.subjects, tp.class_levels, tp.degrees, tp.teaching_mode,
  tp.online_platforms, tp.city, tp.area, tp.hourly_rate_pkr,
  tp.experience_years, tp.video_youtube_id, tp.video_status,
  tp.verification_status, tp.rating_avg, tp.rating_count, tp.is_featured,
  tp.created_at,
  -- Appended at the END on purpose: CREATE OR REPLACE VIEW cannot reorder or
  -- insert columns, and adding them here avoids having to DROP the view.
  tp.gender,
  p.profile_completion
from public.tutor_profiles tp
join public.profiles p on p.id = tp.id
where p.profile_completion >= 100
  -- Reactive moderation: these two states remove a tutor from listings.
  and tp.verification_status not in ('suspended', 'rejected');

grant select on public.tutor_directory to anon, authenticated;
