-- 41_tutor_slug_refresh.sql — one rule for when a tutor's address may move.
--
-- WHAT MIGRATION 40 MISSED. It gave every existing tutor a canonical address
-- and hooked ensureTutorSlug() into /api/profile/save. But that route is not
-- the only writer: /tutor/dashboard/settings upserts `tutor_profiles` straight
-- from the client with the Supabase key, and that is where `city` is actually
-- set. So a tutor who registered, then filled in their city on the settings
-- page, kept the address derived from a profile that had no city — which is
-- the one case the whole feature exists for.
--
-- The fix is a rule in the database rather than a call in each route, because
-- "each route" is exactly what was already wrong. `refresh_tutor_slug()` holds
-- the rule; a trigger applies it to any writer that touches the profile row,
-- and the API route calls the same function for the one case a trigger cannot
-- see (a subjects-only change never touches `tutor_profiles`).
--
-- THE RULE, in full:
--
--   * LISTED FREEZES IT. Once a tutor is in tutor_directory, browse, search,
--     the sitemap and every social post may already carry the link. From that
--     moment the address stops following the data — a tutor who moves city
--     keeps their URL, and the page updates from the row.
--   * AN ADMIN DECISION FREEZES IT. `slug_locked` is set the first time an
--     admin sets an address by hand. Without it, the next time the tutor
--     edited their city the trigger would quietly overwrite a deliberate
--     choice, which is worse than not having the feature.
--   * A SLUG CHANGE NEVER TRIGGERS A REFRESH. The trigger is scoped to
--     full_name and city, and returns immediately when the slug itself is what
--     changed — which is what stops set_tutor_slug() from re-entering it.
--
-- Every move still goes through set_tutor_slug(), so a redirect is left behind
-- whether the change was automatic or an admin's.

begin;

alter table public.tutor_profiles
  add column if not exists slug_locked boolean not null default false;

comment on column public.tutor_profiles.slug_locked is
  'An admin set this address by hand. Stops the automatic refresh from overwriting it.';

create or replace function public.refresh_tutor_slug(p_tutor uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_current text;
  v_locked  boolean;
  v_new     text;
begin
  select slug, slug_locked into v_current, v_locked
  from public.tutor_profiles where id = p_tutor;

  if not found or coalesce(v_locked, false) then
    return v_current;
  end if;

  -- Listed: somebody may already hold the link.
  if exists (select 1 from public.tutor_directory where id = p_tutor) then
    return v_current;
  end if;

  v_new := public.tutor_canonical_slug(p_tutor);
  if v_new is null or v_new = '' or v_new is not distinct from v_current then
    return v_current;
  end if;

  return public.set_tutor_slug(p_tutor, v_new);
end $fn$;

grant execute on function public.refresh_tutor_slug(uuid) to service_role;

create or replace function public.tutor_profiles_refresh_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- The address itself moving is not a reason to re-derive it. This is also
  -- what keeps set_tutor_slug()'s own UPDATE from re-entering here.
  if new.slug is distinct from old.slug then
    return null;
  end if;
  perform public.refresh_tutor_slug(new.id);
  return null;
end $fn$;

drop trigger if exists tutor_profiles_slug_refresh on public.tutor_profiles;
create trigger tutor_profiles_slug_refresh
  after update of full_name, city on public.tutor_profiles
  for each row execute function public.tutor_profiles_refresh_slug();

-- Existing tutors whose address predates a city or a subject list. No-op for
-- anybody listed, which is the great majority of the directory.
do $backfill$
declare r record;
begin
  for r in select id from public.tutor_profiles loop
    perform public.refresh_tutor_slug(r.id);
  end loop;
end $backfill$;

commit;
