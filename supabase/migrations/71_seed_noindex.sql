-- 71_seed_noindex.sql
--
-- Keep the seed cast and the fixture tuitions OUT of Google, while leaving them
-- visible and browsable on-site (owner, 10 Sep 2026). They are demo fixtures,
-- not real people or real vacancies; an indexed fixture tutor competes with a
-- real tutor for their own name, and an indexed fixture tuition (which carries
-- JobPosting structured data) can surface in Google's jobs listings as a real
-- vacancy.
--
-- IDENTIFICATION IS A STORED FACT, not a slug list. A new boolean
-- `profiles.is_seed` marks a fixture account, backfilled from the seed email
-- domain `@tutormint.dev` — every account on that domain is a fixture and
-- nothing else uses it (verified on the live DB: 7 seed tutors + the seed
-- parents, zero real accounts). Chosen over reading the email at every call site
-- because it is one indexed fact consumed by four surfaces (the tutor profile
-- noindex, the tutor sitemap, the tuition page noindex + JobPosting, and the
-- tuition sitemap), it is robust to an email or slug change, and it is
-- admin-flippable if a future fixture is created on another domain.
--
-- This composes with the completion rule from migration 70: a listed tutor under
-- 100% is already noindex; a seed tutor at 100% must STILL be noindex — seed
-- wins. Nothing here delists or deletes anything.
--
-- Backup: supabase/backups/public-20260910-225122.sql (from migration 70, same day).

-- ─────────────────────────────────────────────────────── profiles.is_seed ──
alter table public.profiles
  add column if not exists is_seed boolean not null default false;

comment on column public.profiles.is_seed is
  'Fixture/seed account (demo data). Rendered on-site but kept out of search '
  'engines: noindex + out of the sitemap for the tutor profile, and for any '
  'tuition the account posts. Backfilled from the @tutormint.dev seed domain.';

-- Backfill from the seed email domain. Idempotent (only flips rows not already
-- flagged), so a re-run is a no-op.
update public.profiles
   set is_seed = true
 where email ilike '%@tutormint.dev'
   and is_seed = false;

-- ───────────────────────────────────────────────────── listed_tutor_slugs ──
-- The TUTOR sitemap. Already 100%-only (migration 70); now also seed-free. A
-- seed tutor stays in tutor_directory (visible, searchable on-site) but is never
-- offered to a crawler.
create or replace function public.listed_tutor_slugs()
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select d.slug, greatest(d.created_at, coalesce(tp.updated_at, d.created_at))
  from tutor_directory d
  join tutor_profiles tp on tp.id = d.id
  join profiles p on p.id = d.id
  where d.slug is not null
    and d.profile_completion >= 100
    and coalesce(p.is_seed, false) = false;
$fn$;
revoke all on function public.listed_tutor_slugs() from public;
grant execute on function public.listed_tutor_slugs() to anon, authenticated, service_role;

-- ───────────────────────────────────────────────────── indexable_job_slugs ──
-- The TUITION sitemap. `jobs` is public-read but `profiles` is not, so the
-- sitemap (publishable key) cannot itself join the parent to tell a fixture from
-- a real post. This SECURITY DEFINER function encapsulates the fixture rule
-- (mirrored in lib/fixtures.ts) so the sitemap only ever asks for the slugs it
-- may list. A genuine team post is kept; every other seed/bulk-import fixture is
-- dropped.
create or replace function public.indexable_job_slugs()
returns table (public_slug text, city text, created_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select j.public_slug, j.city, j.created_at
  from jobs j
  join profiles p on p.id = j.parent_id
  where j.status = 'open'
    and j.public_slug is not null
    and (
      -- A genuine team post overrides every fixture signal and stays indexable.
      coalesce(p.is_team_account, false) = true
      or (
        coalesce(p.is_seed, false) = false
        and j.job_tx_id not ilike 'JOB-TRK%'
        and j.job_tx_id not ilike 'SEED-JOB%'
      )
    );
$fn$;
revoke all on function public.indexable_job_slugs() from public;
grant execute on function public.indexable_job_slugs() to anon, authenticated, service_role;
