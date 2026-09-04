-- 43_viewer_identity_verified.sql
--
-- THREE THINGS. One moves a plan power, one repairs stale notification links,
-- one removes a SECURITY DEFINER function whose last caller has gone.
--
-- ============================================================================
-- 1. SEEING WHO LOOKED AT YOU BECOMES A VERIFIED POWER
--
-- Owner decision, 4 Sep 2026. Migration 21 gave `can_see_viewer_identity` to
-- premium and featured, and the profile-view teaser -- the tutor dashboard's
-- primary upsell surface, and the thing the whole Rs 199 funnel is built
-- around -- therefore had to sell Premium at Rs 499. The teaser was arguing
-- for one plan and the conversion rules were written for another.
--
-- The COLUMN moves rather than the button, and that ordering matters. The rule
-- in lib/gate.ts is that a gate never offers a plan whose row does not carry
-- the power; `REQUIRES.tutor_viewer_identity` reads 'verified' as of this
-- migration, and it would have been a lie the day before it. Change the
-- product, then change the price tag.
--
-- Premium keeps three arguments of its own and loses none: 25 applications
-- against 10, WhatsApp to parents, and a higher search rank.
--
-- ============================================================================
-- 2. job_matched LINKS WRITTEN BEFORE THE TUITION PAGE EXISTED
--
-- Until migration 40 a tuition had no address of its own, so this
-- notification's href was `/browse/tuitions?job=<job_tx_id>` -- a query
-- parameter nothing on that page reads, so the button landed the tutor on the
-- unfiltered board and left them to find the job it was about. lib/jobs.ts
-- writes tuitionPath() now; these are the rows written before it did.
--
-- Matched on job_tx_id, so a row whose job has since been deleted is LEFT
-- ALONE rather than pointed at some other parent's tuition. Idempotent: after
-- this runs there is nothing left matching the pattern that also resolves.
--
-- ============================================================================
-- 3. job_page_status() IS DROPPED
--
-- Added in migration 40 so the tuition page could tell "closed" from "filled"
-- from "never existed" for a caller who cannot read the row. All three answers
-- led to the same page, and the page is a plain 404 now (notFound(), rendered
-- by app/(site)/tuitions/[city]/[slug]/not-found.tsx), so the second query is
-- gone and so is its only caller. A SECURITY DEFINER function granted to anon
-- with nothing calling it is a surface kept for no reason.

begin;

-- ---------------------------------------------------------------- 1. plans --
update public.plans
   set can_see_viewer_identity = true
 where code = 'verified';

-- --------------------------------------------------------- 2. notifications --
update public.notifications n
   set href = '/tuitions/'
            || coalesce(nullif(public.tm_slugify(j.city), ''), 'pakistan')
            || '/' || j.public_slug
  from public.jobs j
 where n.href like '/browse/tuitions?job=%'
   and j.job_tx_id = substring(n.href from '\?job=(.*)$')
   and j.public_slug is not null;

-- ------------------------------------------------------------- 3. the drop --
drop function if exists public.job_page_status(text);

commit;
