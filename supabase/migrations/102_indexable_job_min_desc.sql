-- 102_indexable_job_min_desc.sql (PR43 §3)
--
-- Keep genuinely THIN tuition pages out of the sitemap, so the page's own
-- noindex and the sitemap never contradict each other. A tuition with almost no
-- requirement text is not worth indexing on its own; below MIN_TUITION_DESC (40)
-- characters of description it is dropped from indexable_job_slugs() exactly as
-- the page sets robots:noindex for the same rule (lib/seo/indexable.ts).
--
-- This is additive in effect: every one of the 48 currently-indexable open
-- tuitions has a 200–500 character description, so this changes 0 rows today. It
-- codifies the rule for any future one-line post.

create or replace function public.indexable_job_slugs()
returns table (public_slug text, city text, created_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select j.public_slug, j.city, j.created_at
  from jobs j
  join profiles p on p.id = j.parent_id
  where j.status = 'open'
    and j.public_slug is not null
    -- Too thin to stand alone as an indexed page (PR43 §3).
    and char_length(btrim(coalesce(j.description, ''))) >= 40
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
